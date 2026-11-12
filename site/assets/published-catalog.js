import {SNAPSHOT_ROOT,SNAPSHOT_MAX_BYTES,validateSnapshotManifest,snapshotDescriptor,snapshotEtag} from './snapshot-protocol.js?v=0.36.0';

export async function boundedSnapshotBytes(response,maxBytes,signal){
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json')||Number(response.headers.get('content-length'))>maxBytes){void response.body?.cancel().catch(()=>{});throw Error('Published directory unavailable');}
  const reader=response.body?.getReader();if(!reader)throw Error('Missing published directory body');
  const chunks=[];let size=0;const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
  try{
    while(true){if(signal?.aborted)throw Error('Directory deadline exceeded');const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maxBytes)throw Error('Published directory byte limit exceeded');chunks.push(next.value);}
    if(signal?.aborted)throw Error('Directory deadline exceeded');
  }catch(error){void reader.cancel().catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');

// Shared by the edge and guarded native adapter. Origin and all payload paths are
// fixed by the validated protocol, never listener-supplied URLs. No provider calls.
export function createPublishedCatalog({fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=15000}={}){
  let manifest=null,savedAt=0;
  return async function read(pathname,representation='legacy',{deadlineAt=now()+timeoutMs}={}){
    const budget=Math.min(timeoutMs,deadlineAt-now());if(budget<=0)throw Error('Published directory deadline exceeded');
    const controller=new AbortController();let timer;
    const operation=(async()=>{
      async function loadManifest(force=false){
        if(!force&&manifest&&now()-savedAt<300000)return manifest;
        const response=await fetchImpl(SNAPSHOT_ROOT+'manifest.json'+(force?'?refresh='+now():''),{signal:controller.signal,redirect:'manual',credentials:'omit',headers:{Accept:'application/json',...(force?{'Cache-Control':'no-cache'}:{})}});
        const bytes=await boundedSnapshotBytes(response,128*1024,controller.signal);
        const value=validateSnapshotManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),{now:now()});
        manifest=value;savedAt=now();return value;
      }
      for(let attempt=0;attempt<2;attempt++){
        const current=await loadManifest(attempt===1),descriptor=snapshotDescriptor(current,pathname,representation);
        if(!descriptor)throw Error('Unknown published directory path');
        const response=await fetchImpl(SNAPSHOT_ROOT+descriptor.path,{signal:controller.signal,redirect:'manual',credentials:'omit',headers:{Accept:'application/json'}});
        // An old manifest can outlive blobs removed by atomic artifact replacement.
        if(response.status===404&&attempt===0){void response.body?.cancel().catch(()=>{});continue;}
        const bytes=await boundedSnapshotBytes(response,SNAPSHOT_MAX_BYTES,controller.signal);
        if(bytes.byteLength!==descriptor.bytes||await sha256(bytes)!==descriptor.sha256)throw Error('Published directory integrity mismatch');
        return new Response(bytes,{headers:{'content-type':'application/json; charset=utf-8',etag:snapshotEtag(descriptor),'x-directory-generated-at':current.generatedAt,'x-directory-producer-sha':current.producerSourceSha,'x-directory-schema':representation==='catalog'?'2':'1','x-directory-identities':String(current.totals.identities),'x-directory-stations':String(current.totals.stations)}});
      }
      throw Error('Published generation changed repeatedly');
    })();
    const deadline=new Promise((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Published directory deadline exceeded'));},budget);});
    try{return await Promise.race([operation,deadline]);}finally{clearTimeout(timer);controller.abort();}
  };
}
