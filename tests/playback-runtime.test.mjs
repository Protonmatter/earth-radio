// Execute the shipped audio controller with deterministic media/module I/O.
// The bundle remains the product: the TypeScript recovery copy is not rebuilt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');
const name=html.match(/assets\/(index-[\w-]+\.js)/)[1];
const runtime=await readFile(new URL('../site/assets/'+name,import.meta.url),'utf8');
function between(start,end){const a=runtime.indexOf(start),b=runtime.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`Missing audio-controller boundary: ${start}`);return runtime.slice(a,b);}
const code=[between('async function er(','async function tr('),between('function nr(','function rr('),between('async function ur(','async function fr(')].join('\n').replaceAll('import.meta.url',"'file:///runtime-test.js'");
const station={stationuuid:'selected',name:'Chosen',url:'https://stream.example/live.m3u8'};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function fixture(){
  const instances=[],states=[];let fatal=0;
  class Hls {
    static Events={ERROR:'error'};
    static isSupported(){return true;}
    constructor(){instances.push(this);}
    on(_event,handler){this.error=handler;}
    loadSource(url){this.url=url;}
    attachMedia(){}
  }
  const audio={src:'',error:null,canPlayType:()=>'',pause(){},removeAttribute(){this.src='';},load(){},play:async()=>{}};
  const context={U:audio,G:null,qn:false,Qn:0,K:false,Jn:0,W:null,Gn:{},
    Tr(){},Dr:state=>states.push(state),xr(){},wr(){context.W=null;},fr:async row=>row.url,
    wn:url=>url.endsWith('.m3u8'),Fn:async()=>({default:Hls}),hr(){fatal++;},gr:error=>{throw error;},
    Cr(){},Sr(){},Er(){}};
  vm.runInNewContext(code,context);
  return{context,audio,Hls,instances,states,fatal:()=>fatal};
}

test('an attached HLS fatal handler survives pause/resume but cannot act while paused or after replacement',async()=>{
  const f=fixture();assert.equal(await f.context.er(station),true);const first=f.instances[0];
  first.error(null,{fatal:true});assert.equal(f.fatal(),1);
  f.context.nr();first.error(null,{fatal:true});assert.equal(f.fatal(),1);
  assert.equal(await f.context.er(station),true);assert.equal(f.instances.length,1);
  first.error(null,{fatal:true});assert.equal(f.fatal(),2);
  await f.context.er({...station,stationuuid:'other'});
  first.error(null,{fatal:true});assert.equal(f.fatal(),2);
  f.instances[1].error(null,{fatal:true});assert.equal(f.fatal(),3);
});

test('pause during playlist resolution allows same-station resume to attach a fresh source',async()=>{
  const f=fixture(),pending=deferred();let resolves=0;
  f.context.fr=()=>++resolves===1?pending.promise:Promise.resolve('https://stream.example/resumed.mp3');
  const old=f.context.er(station);f.context.nr();
  assert.equal(await f.context.er(station),true);assert.equal(resolves,2);
  assert.equal(f.audio.src,'https://stream.example/resumed.mp3');
  pending.resolve('https://stream.example/obsolete.mp3');assert.equal(await old,false);
  assert.equal(f.audio.src,'https://stream.example/resumed.mp3');
});

test('late HLS imports cannot attach over a resumed selection',async()=>{
  const f=fixture(),pending=deferred(),started=deferred();let imports=0;
  f.context.Fn=()=>{if(++imports===1){started.resolve();return pending.promise;}return Promise.resolve({default:f.Hls});};
  const old=f.context.er(station);await started.promise;f.context.nr();
  assert.equal(await f.context.er(station),true);
  pending.resolve({default:f.Hls});assert.equal(await old,false);
  assert.equal(f.instances.length,1);assert.equal(f.context.W,f.instances[0]);
});

test('a play promise resolved after pause cannot publish playing',async()=>{
  const f=fixture(),pending=deferred(),started=deferred();
  f.audio.play=()=>{started.resolve();return pending.promise;};
  const old=f.context.er({...station,url:'https://stream.example/live.mp3'});
  await started.promise;f.context.nr();pending.resolve();
  assert.equal(await old,false);assert.equal(f.states.at(-1),'paused');
  assert.equal(f.context.qn,false);
});
