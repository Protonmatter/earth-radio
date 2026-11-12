import {mediaArtworkSource,MEDIA_ARTWORK_SIZES,MEDIA_ARTWORK_MAX_BYTES} from './media-session-core.js?v=0.37.0';

const MAX_PIXELS=4_194_304,MAX_EDGE=4096,MAX_CACHE_BYTES=8*1024*1024,MAX_CACHE_ENTRIES=4;
const rasterTypes=new Set(['image/png','image/jpeg','image/webp','image/avif']);
const failure=message=>Object.assign(new Error(message),{code:'MEDIA_ARTWORK_FAILED'});
const aborted=()=>new DOMException('Media artwork canceled','AbortError');
const clone=value=>value.map(item=>({...item}));

export function createMediaArtworkLoader({fetchImpl=globalThis.fetch,bitmapFactory=globalThis.createImageBitmap,
  canvasFactory=()=>globalThis.document?.createElement('canvas'),timeoutMs=4000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw failure('Invalid artwork deadline');
  const cache=new Map(),active=new Set();let cacheBytes=0,disposed=false,processing=0;
  const remember=(key,value,bytes)=>{
    cache.set(key,{value:clone(value),bytes});cacheBytes+=bytes;
    while(cache.size>MAX_CACHE_ENTRIES||cacheBytes>MAX_CACHE_BYTES){const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first);}
  };
  return{
    async load(value,{signal}={}){
      const source=mediaArtworkSource(value);if(disposed||!source)return null;
      if(signal?.aborted)throw aborted();
      const saved=cache.get(source);
      if(saved){cache.delete(source);cache.set(source,saved);return clone(saved.value);}
      // Aborted decoders count until their platform promise actually finishes.
      // Rapid station changes cannot accumulate detached decode jobs.
      if(processing>=2)return null;
      if(typeof fetchImpl!=='function'||typeof bitmapFactory!=='function')return null;
      let canvas,context;
      try{canvas=canvasFactory();context=canvas?.getContext('2d');}catch{return null;}
      if(!context||typeof canvas.toDataURL!=='function')return null;
      const controller=new AbortController();active.add(controller);let timedOut=false,onCancel;
      const ensure=()=>{if(controller.signal.aborted||disposed)throw aborted();};
      const canceled=new Promise((_resolve,reject)=>{
        onCancel=()=>reject(timedOut?Object.assign(new Error('Media artwork deadline exceeded'),{code:'MEDIA_ARTWORK_TIMEOUT'}):aborted());
        controller.signal.addEventListener('abort',onCancel,{once:true});
      });
      const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      processing++;
      const work=(async()=>{
        let bitmap;
        try{
          const response=await fetchImpl(source,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',mode:'cors'});ensure();
          const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
          if(!response.ok||response.redirected||!rasterTypes.has(type)||Number(response.headers.get('content-length'))>MEDIA_ARTWORK_MAX_BYTES){
            void response.body?.cancel().catch(()=>{});throw failure('Media artwork response rejected');
          }
          const reader=response.body?.getReader();if(!reader)throw failure('Media artwork body unavailable');
          const chunks=[];let length=0;
          const cancelBody=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancelBody,{once:true});
          try{
            for(;;){ensure();const next=await reader.read();ensure();if(next.done)break;length+=next.value.byteLength;
              if(length>MEDIA_ARTWORK_MAX_BYTES){cancelBody();throw failure('Media artwork input exceeds limit');}chunks.push(next.value);
            }
          }finally{controller.signal.removeEventListener('abort',cancelBody);reader.releaseLock();}
          if(!length)throw failure('Media artwork body is empty');
          bitmap=await bitmapFactory(new Blob(chunks,{type}));ensure();
          const {width,height}=bitmap;
          if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MAX_EDGE||height>MAX_EDGE||width*height>MAX_PIXELS)throw failure('Media artwork dimensions exceed limit');
          const result=[];let bytes=0;
          for(const size of MEDIA_ARTWORK_SIZES){
            ensure();canvas.width=size;canvas.height=size;
            const scale=Math.min(size/width,size/height),drawWidth=Math.max(1,Math.round(width*scale)),drawHeight=Math.max(1,Math.round(height*scale));
            context.drawImage(bitmap,(size-drawWidth)/2,(size-drawHeight)/2,drawWidth,drawHeight);
            const src=canvas.toDataURL('image/png');
            if(typeof src!=='string'||src.length>MEDIA_ARTWORK_MAX_BYTES||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src))throw failure('Media artwork encoding failed');
            bytes+=src.length;if(bytes>MEDIA_ARTWORK_MAX_BYTES)throw failure('Media artwork output exceeds limit');
            result.push({src,sizes:`${size}x${size}`,type:'image/png'});
          }
          ensure();remember(source,result,bytes);return clone(result);
        }finally{
          try{if(typeof bitmap?.close==='function')bitmap.close();}catch{/* keep the original outcome */}
          canvas.width=canvas.height=1;
          processing--;
        }
      })();
      try{return await Promise.race([work,canceled]);}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onCancel);active.delete(controller);canvas.width=canvas.height=1;}
    },
    dispose(){if(disposed)return;disposed=true;for(const controller of active)controller.abort();active.clear();cache.clear();cacheBytes=0;}
  };
}
