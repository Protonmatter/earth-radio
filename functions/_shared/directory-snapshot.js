import {createPublishedCatalog} from '../../site/assets/published-catalog.js';
import {snapshotRepresentation,snapshotTagMatches} from '../../site/assets/snapshot-protocol.js';

const REFRESH=300000,MAX_STALE=7*86400000;
export function directoryPath(pathname){return /^\/directory\/(?:snapshot|countries|servers|country\/[A-Z]{2})$/.test(pathname)?pathname:null;}
export function createDirectorySnapshot({fetchImpl=globalThis.fetch,cacheImpl=null,now=Date.now,timeoutMs=15000,cacheTimeoutMs=1000}={}){
  const published=createPublishedCatalog({fetchImpl,now,timeoutMs}),pending=new Map(),failures=new Map();
  async function cacheOperation(operation,budget=cacheTimeoutMs){let timer;try{return await Promise.race([operation(),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Cache deadline exceeded')),budget);})]);}finally{clearTimeout(timer);}}
  return async context=>{
    const{request}=context,url=new URL(request.url),path=directoryPath(url.pathname);
    if(!path||url.search)return Response.json({error:'Unknown directory request'},{status:400,headers:{'cache-control':'no-store'}});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{allow:'GET, HEAD'}});
    const representation=snapshotRepresentation(request.headers,path),cache=cacheImpl||globalThis.caches?.default;
    const key=new Request(url.origin+path+'?representation='+representation);
    let stored,cacheUnavailable=false;
    try{stored=await cacheOperation(()=>cache?.match(key));}catch{cacheUnavailable=true;}
    const age=stored?now()-Number(stored.headers.get('x-directory-saved-at')):Infinity;
    if(age<0||age>MAX_STALE){void stored?.body?.cancel().catch(()=>{});stored=null;}
    async function refresh(){
      if(pending.has(key.url))return(await pending.get(key.url)).clone();
      if(pending.size>=4)throw Error('Directory refresh capacity reached');
      const task=(async()=>{
        const response=await published(path,representation),headers=new Headers(response.headers);
        headers.set('x-directory-saved-at',String(now()));headers.set('cache-control','public, max-age=604800');
        const value=new Response(response.body,{headers});
        if(cache){const copy=value.clone();try{await cacheOperation(()=>cache.put(key,copy));}catch{void copy.body?.cancel().catch(()=>{});cacheUnavailable=true;}}
        failures.delete(key.url);return value;
      })().catch(error=>{failures.set(key.url,now()+60000);throw error;}).finally(()=>pending.delete(key.url));
      pending.set(key.url,task);return(await task).clone();
    }
    let response=stored;
    if(!response){try{if((failures.get(key.url)||0)>now())throw Error('Retry later');response=await refresh();}catch{return Response.json({error:'Directory temporarily unavailable'},{status:503,headers:{'cache-control':'no-store','retry-after':'60'}});}}
    else if(age>=REFRESH&&(failures.get(key.url)||0)<=now())context.waitUntil?.(refresh().then(value=>{void value.body?.cancel().catch(()=>{});}).catch(()=>{}));
    const headers=new Headers(response.headers),generationAge=now()-Date.parse(headers.get('x-directory-generated-at'));
    headers.set('cache-control','public, max-age=300, stale-if-error=86400');headers.set('vary','Accept');headers.set('x-content-type-options','nosniff');
    headers.set('x-directory-state',stored&&age>=REFRESH||generationAge>7200000?'stale':stored?'cached':'fresh');headers.delete('x-directory-saved-at');
    if(cacheUnavailable)headers.set('x-directory-cache','unavailable');
    const notModified=snapshotTagMatches(request.headers.get('if-none-match'),headers.get('etag'));
    if(request.method==='HEAD'||notModified){void response.body?.cancel().catch(()=>{});return new Response(null,{status:notModified?304:200,headers});}
    return new Response(response.body,{headers});
  };
}
