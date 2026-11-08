// Radio Browser discovery. Only provider-owned HTTPS names can enter the pool.
export const DIRECTORY_SEEDS=Object.freeze(['https://de1.api.radio-browser.info','https://de2.api.radio-browser.info','https://all.api.radio-browser.info']);
export function directoryHosts(rows){
  if(!Array.isArray(rows)||rows.length>64)return [];
  return [...new Set(rows.map(row=>String(row?.name||'').toLowerCase()).filter(name=>/^[a-z0-9][a-z0-9-]{0,30}\.api\.radio-browser\.info$/.test(name)).map(name=>'https://'+name))].sort();
}
export async function directoryJson(response,maxBytes=16*1024*1024){
  if(!response.ok||Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('Directory unavailable or too large');}
  if(!response.body)throw Error('Missing directory body');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw Error('Directory too large');}chunks.push(next.value);}}
  finally{reader.releaseLock();}
  const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(data));
}
export function createDirectoryHosts({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=4000,ttlMs=3600000,storage=null}={}){
  let cached=[],savedAt=0,pending=null;const failed=new Map(),key='earthRadio.directoryHosts.v1';
  try{const value=JSON.parse(storage?.getItem(key)||'null');cached=directoryHosts(value?.hosts?.map(name=>({name:new URL(name).hostname})));savedAt=Number(value?.savedAt)||0;}catch{/* Untrusted cache is optional. */}
  const available=values=>values.filter((host,index,all)=>all.indexOf(host)===index&&(failed.get(host)||0)<=now());
  const ordered=()=>available(cached.length?cached:DIRECTORY_SEEDS);
  async function discover(){
    if(cached.length&&now()>=savedAt&&now()-savedAt<ttlMs)return ordered().length?ordered():available(DIRECTORY_SEEDS);
    if(pending)return pending;
    pending=(async()=>{
      for(const base of available([...cached,...DIRECTORY_SEEDS]).slice(0,3)){
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
        try{
          const data=await directoryJson(await fetchImpl(base+'/json/servers',{signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json'}}),65536);
          const hosts=directoryHosts(data);if(!hosts.length)throw Error('Empty host discovery');
          cached=hosts;savedAt=now();try{storage?.setItem(key,JSON.stringify({savedAt,hosts}));}catch{/* Best effort. */}
          return ordered();
        }catch{failed.set(base,now()+120000);}finally{clearTimeout(timer);}
      }
      return ordered().length?ordered():[...DIRECTORY_SEEDS];
    })().finally(()=>{pending=null;});return pending;
  }
  return {discover,failed(host){failed.set(host,now()+120000);},healthy(host){failed.delete(host);if(cached.includes(host))cached=[host,...cached.filter(value=>value!==host)];}};
}
let storage;try{storage=globalThis.localStorage;}catch{/* Storage can be disabled. */}
export const browserDirectoryHosts=createDirectoryHosts({storage,fetchImpl:(...args)=>globalThis.fetch(...args)});
