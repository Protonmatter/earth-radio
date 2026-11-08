import {createDirectoryHosts} from '../../site/assets/directory-hosts.js';

const HOUR=3600000,MAX_BYTES=16*1024*1024;
// Finite provider paths, never a visitor-supplied URL or general proxy. Streaming
// avoids parsing/stringifying multi-MB JSON against the Free plan's CPU budget.
export function directoryPath(pathname){
  if(pathname==='/directory/snapshot')return '/json/stations/topclick/10000?hidebroken=true';
  if(pathname==='/directory/countries')return '/json/countries';
  if(pathname==='/directory/servers')return '/json/servers';
  const country=pathname.match(/^\/directory\/country\/([A-Z]{2})$/);
  return country?'/json/stations/search?'+new URLSearchParams({countrycode:country[1],hidebroken:'true',order:'clickcount',reverse:'true',limit:'1000'}):null;
}
export function createDirectorySnapshot({fetchImpl=globalThis.fetch,cacheImpl=null,now=Date.now,timeoutMs=15000,cacheTimeoutMs=1000}={}){
  const hosts=createDirectoryHosts({fetchImpl,now});const pending=new Map(),failures=new Map(),bodyStates=new WeakMap();
  async function cacheOperation(operation,budget=cacheTimeoutMs){let timer;try{return await Promise.race([operation(),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Cache deadline exceeded')),budget);})]);}finally{clearTimeout(timer);}}
  async function upstream(path,deadline){
    for(const host of (await hosts.discover()).slice(0,3)){
      const remaining=deadline-now();if(remaining<=0)break;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remaining);
      try{
        const result=await fetchImpl(host+path,{signal:controller.signal,redirect:'manual',credentials:'omit',headers:{Accept:'application/json','User-Agent':'EarthRadio directory snapshot (+https://earthradio.stream)'}});
        if(!result.ok||!result.headers.get('content-type')?.includes('application/json')||Number(result.headers.get('content-length'))>MAX_BYTES){await result.body?.cancel();throw Error('Unavailable directory');}
        const reader=result.body?.getReader();if(!reader)throw Error('Missing directory body');let bytes=0;
        const state={deadline,error:null};
        const stream=new ReadableStream({
          async pull(target){try{const next=await reader.read();if(next.done){clearTimeout(timer);reader.releaseLock();target.close();return;}bytes+=next.value.byteLength;if(bytes>MAX_BYTES)throw Error('Directory exceeds byte limit');target.enqueue(next.value);}catch(error){state.error=error;hosts.failed(host);clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});target.error(error);}},
          async cancel(){clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});}
        });
        const snapshot=new Response(stream,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=604800','x-directory-saved-at':String(now()),etag:`W/"directory-${now()}"`}});
        bodyStates.set(snapshot,state);hosts.healthy(host);return snapshot;
      }catch{clearTimeout(timer);controller.abort();hosts.failed(host);}
    }
    throw Error('Directory snapshot unavailable');
  }
  return async context=>{
    const {request}=context,url=new URL(request.url),path=directoryPath(url.pathname);
    if(!path||url.search)return Response.json({error:'Unknown directory request'},{status:400,headers:{'cache-control':'no-store'}});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
    const cache=cacheImpl||globalThis.caches?.default,key=new Request(url.origin+url.pathname);
    let stored,cacheUnavailable=false;
    try{stored=await cacheOperation(()=>cache?.match(key));}catch{cacheUnavailable=true;}
    const age=stored?now()-Number(stored.headers.get('x-directory-saved-at')):Infinity;
    async function refresh(){
      if(pending.has(key.url))return (await pending.get(key.url)).clone();
      if(pending.size>=4)throw Error('Directory refresh capacity reached');
      const task=(async()=>{
        const deadline=now()+timeoutMs;
        for(let attempt=0;attempt<3;attempt++){
          const response=await upstream(path,deadline);
          if(cache){
            const copy=response.clone(),state=bodyStates.get(response);
            try{await cacheOperation(()=>cache.put(key,copy),Math.max(cacheTimeoutMs,deadline-now()+cacheTimeoutMs));}
            catch(error){
              void copy.body?.cancel().catch(()=>{});
              if(state?.error){
                void response.body?.cancel().catch(()=>{});
                if(now()>=deadline||attempt===2)throw error;
                continue;
              }
              cacheUnavailable=true;
            }
          }
          failures.delete(key.url);return response;
        }
        throw Error('Directory body retries exhausted');
      })().catch(error=>{failures.set(key.url,now()+60000);throw error;}).finally(()=>pending.delete(key.url));
      pending.set(key.url,task);return (await task).clone();
    }
    let response=stored;
    if(!response){try{if((failures.get(key.url)||0)>now())throw Error('Retry later');response=await refresh();}catch{return Response.json({error:'Directory temporarily unavailable'},{status:503,headers:{'cache-control':'no-store','retry-after':'60'}});}}
    else if(age>=HOUR&&(failures.get(key.url)||0)<=now())context.waitUntil(refresh().then(r=>{void r.body?.cancel().catch(()=>{});}).catch(()=>{}));
    const headers=new Headers(response.headers);headers.set('cache-control','public, max-age=300, stale-if-error=86400');headers.set('x-content-type-options','nosniff');headers.set('x-directory-state',stored?(age>=HOUR?'stale':'cached'):'fresh');headers.delete('x-directory-saved-at');
    if(cacheUnavailable)headers.set('x-directory-cache','unavailable');
    const notModified=request.headers.get('if-none-match')===headers.get('etag');
    // A cloned/teed body's cancellation promise can wait for the retained cache
    // branch. HEAD/304 must settle independently of that branch.
    if(request.method==='HEAD'||notModified){void response.body?.cancel().catch(()=>{});return new Response(null,{status:notModified?304:200,headers});}
    return new Response(response.body,{headers});
  };
}
