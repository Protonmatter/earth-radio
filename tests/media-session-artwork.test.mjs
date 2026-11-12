import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaArtworkLoader} from '../site/assets/media-session-artwork.js';
import {MEDIA_ARTWORK_MAX_BYTES} from '../site/assets/media-session-core.js';

const url='https://i.scdn.co/image/fixture';
function fixture(overrides={}){
 const calls=[],draws=[],bitmaps=[];
 const loader=createMediaArtworkLoader({fetchImpl:async(value,options)=>{
  calls.push({value,options});return new Response('fixture-raster',{headers:{'content-type':'image/png'}});
 },bitmapFactory:async()=>{const bitmap={width:800,height:400,closed:false,close(){this.closed=true;}};bitmaps.push(bitmap);return bitmap;},
 canvasFactory:()=>({width:0,height:0,getContext:()=>({drawImage(...args){draws.push(args.slice(1));}}),toDataURL:()=> 'data:image/png;base64,aA=='}),...overrides});
 return{loader,calls,draws,bitmaps};
}
test('cover fetch omits credentials/referrer, forbids redirects and creates actual square raster sizes',async()=>{
 const h=fixture(),result=await h.loader.load(url);
 assert.deepEqual(result.map(x=>[x.sizes,x.type]),[['96x96','image/png'],['256x256','image/png'],['512x512','image/png']]);
 assert.deepEqual(h.draws,[[0,24,96,48],[0,64,256,128],[0,128,512,256]]);
 assert.equal(h.calls[0].options.credentials,'omit');assert.equal(h.calls[0].options.referrerPolicy,'no-referrer');assert.equal(h.calls[0].options.redirect,'error');
 assert.equal(h.bitmaps[0].closed,true);h.loader.dispose();
});
test('invalid origins and unsupported bitmap/canvas capabilities do not fetch',async()=>{
 const h=fixture();assert.equal(await h.loader.load('https://evil.example/art.png'),null);assert.equal(h.calls.length,0);h.loader.dispose();
 const missing=fixture({bitmapFactory:null});assert.equal(await missing.loader.load(url),null);assert.equal(missing.calls.length,0);missing.loader.dispose();
 const canvas=fixture({canvasFactory:()=>null});assert.equal(await canvas.loader.load(url),null);assert.equal(canvas.calls.length,0);canvas.loader.dispose();
});
test('same cover uses a cloned cache entry and bounded LRU evicts the least recently used URL',async()=>{
 const h=fixture();const first=await h.loader.load(url);first[0].src='caller-mutated';
 assert.notEqual((await h.loader.load(url))[0].src,'caller-mutated');assert.equal(h.calls.length,1);
 for(let index=1;index<=4;index++)await h.loader.load(url+index);
 await h.loader.load(url);assert.equal(h.calls.length,6);h.loader.dispose();
});
test('bad HTTP, SVG content and oversized declared data are rejected before decoding',async()=>{
 for(const response of [new Response('bad',{status:503}),new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}),new Response('tiny',{headers:{'content-type':'image/png','content-length':String(MEDIA_ARTWORK_MAX_BYTES+1)}})]){
  let decoded=false;const h=fixture({fetchImpl:async()=>response,bitmapFactory:async()=>{decoded=true;throw Error('should not decode');}});
  await assert.rejects(h.loader.load(url));assert.equal(decoded,false);h.loader.dispose();
 }
});
test('streamed byte limit cancels the body rather than allocating an oversized image',async()=>{
 let canceled=false,decoded=false;
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(MEDIA_ARTWORK_MAX_BYTES+1));},cancel(){canceled=true;}});
 const h=fixture({fetchImpl:async()=>new Response(body,{headers:{'content-type':'image/png'}}),bitmapFactory:async()=>{decoded=true;}});
 await assert.rejects(h.loader.load(url));assert.equal(canceled,true);assert.equal(decoded,false);h.loader.dispose();
});
test('invalid, excessive pixel count and excessive edge length close their decoded bitmap',async()=>{
 for(const dimensions of [[0,2],[4096,4096],[8192,1],[NaN,20]]){
  let closed=false;const h=fixture({bitmapFactory:async()=>({width:dimensions[0],height:dimensions[1],close(){closed=true;}})});
  await assert.rejects(h.loader.load(url));assert.equal(closed,true);h.loader.dispose();
 }
});
test('invalid or oversized output never enters the cache and decoded memory is closed',async()=>{
 for(const encoded of ['data:,','data:image/svg+xml,x','data:image/png;base64,'+'A'.repeat(MEDIA_ARTWORK_MAX_BYTES)]){
  const h=fixture({canvasFactory:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>encoded})});
  await assert.rejects(h.loader.load(url));assert.equal(h.bitmaps[0].closed,true);h.loader.dispose();
 }
});
test('already canceled and subsequently aborted requests cannot publish artwork',async()=>{
 const h=fixture(),before=new AbortController();before.abort();
 await assert.rejects(h.loader.load(url,{signal:before.signal}),error=>error.name==='AbortError');assert.equal(h.calls.length,0);h.loader.dispose();
 let started,seenSignal;const ready=new Promise(resolve=>{started=resolve;});
 const during=fixture({fetchImpl:async(_value,{signal})=>{seenSignal=signal;started();return new Promise(()=>{});}}),controller=new AbortController();
 const pending=during.loader.load(url,{signal:controller.signal});await ready;controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(seenSignal.aborted,true);during.loader.dispose();
});
test('deadline resolves a non-cooperating decoder and closes a late bitmap',async()=>{
 let resolveBitmap,started;const ready=new Promise(resolve=>{started=resolve;});
 const h=fixture({timeoutMs:20,bitmapFactory:()=>{started();return new Promise(resolve=>{resolveBitmap=resolve;});}});
 const pending=h.loader.load(url);await ready;await assert.rejects(pending,error=>error.code==='MEDIA_ARTWORK_TIMEOUT');
 let closed=false;resolveBitmap({width:100,height:100,close(){closed=true;}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,true);h.loader.dispose();
});
test('dispose aborts outstanding work, clears the cache and makes future loads inert',async()=>{
 let started,signal;const ready=new Promise(resolve=>{started=resolve;});
 const h=fixture({fetchImpl:async(_value,options)=>{signal=options.signal;started();return new Promise(()=>{});}});
 const pending=h.loader.load(url);await ready;h.loader.dispose();await assert.rejects(pending,error=>error.name==='AbortError');
 assert.equal(signal.aborted,true);assert.equal(await h.loader.load(url),null);
});
test('canceled non-cooperating decoders cannot accumulate unbounded parallel work',async()=>{
 const finishes=[];let started,decoded=0,fetches=0,closed=0;
 const bitmap=()=>({width:100,height:100,close(){closed++;}});
 const h=fixture({fetchImpl:async()=>{fetches++;return new Response('fixture-raster',{headers:{'content-type':'image/png'}});},bitmapFactory:()=>{
  decoded++;if(decoded>2)return Promise.resolve(bitmap());
  started();return new Promise(resolve=>finishes.push(()=>resolve(bitmap())));
 }});
 try{
  for(let index=0;index<2;index++){
   const ready=new Promise(resolve=>{started=resolve;}),controller=new AbortController();
   const pending=h.loader.load(url+index,{signal:controller.signal});await ready;controller.abort();
   await assert.rejects(pending,error=>error.name==='AbortError');
  }
  assert.equal(await h.loader.load(url+'third'),null);assert.equal(fetches,2);
  finishes.splice(0).forEach(finish=>finish());await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await h.loader.load(url+'fourth')).length,3);assert.equal(fetches,3);assert.equal(closed,3);
 }finally{finishes.splice(0).forEach(finish=>finish());h.loader.dispose();}
});
