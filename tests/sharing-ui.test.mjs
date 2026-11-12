import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationSharingController} from '../site/assets/sharing-ui.js';
import {stationSharePayload} from '../site/assets/sharing-core.js';

const station={stationuuid:'a1234567-1234-4abc-8abc-0123456789ab',name:'Seoul Radio',countrycode:'KR'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(options={}){
  const log=[],view=Object.fromEntries(['open','close','manual','copied'].map(name=>[name,(...args)=>log.push({view:name,args})]));
  let payload=stationSharePayload(station);
  const controller=createStationSharingController({getPayload:()=>payload,view,notify:value=>log.push({notify:value}),text:key=>key,...options});
  return{controller,log,setPayload:value=>{payload=value;}};
}

test('native Web Share is invoked synchronously from the tap without opening a second UI',async()=>{
  const calls=[],h=fixture({share:value=>{calls.push(value);return Promise.resolve();}}),pending=h.controller.shareStation();
  assert.equal(calls.length,1);assert.deepEqual(calls[0],stationSharePayload(station));assert.equal(await pending,true);assert.deepEqual(h.log,[]);
});

test('copy fallback freezes the tapped public station even after the current selection changes',async()=>{
  const copied=[],h=fixture({copy:async value=>copied.push(value)});assert.equal(await h.controller.shareStation(),true);
  const first=h.log.find(x=>x.view==='open').args[0];h.setPayload(stationSharePayload({...station,stationuuid:'b1234567-1234-4abc-8abc-0123456789ab'}));
  assert.equal(await h.controller.copyLink(),true);assert.deepEqual(copied,[first.url]);assert.ok(h.log.some(x=>x.notify==='sharing.copied'));
});

test('native cancellation is quiet, while an actual API failure opens copy fallback',async()=>{
  const canceled=fixture({share:async()=>{throw new DOMException('cancel','AbortError');}});assert.equal(await canceled.controller.shareStation(),false);assert.deepEqual(canceled.log,[]);
  const failed=fixture({share:async()=>{throw new DOMException('denied','NotAllowedError');}});assert.equal(await failed.controller.shareStation(),true);assert.equal(failed.log.filter(x=>x.view==='open').length,1);
});

test('copy reports success only after the clipboard operation completes',async()=>{
  const work=deferred(),h=fixture({copy:()=>work.promise});await h.controller.shareStation();const result=h.controller.copyLink();
  assert.equal(h.log.some(x=>x.notify),false);work.resolve();assert.equal(await result,true);assert.equal(h.log.filter(x=>x.notify==='sharing.copied').length,1);
});

test('absent or denied clipboard leaves an honest manual-copy path without success',async()=>{
  for(const copy of [null,async()=>{throw Error('clipboard denied');}]){
    const h=fixture({copy});await h.controller.shareStation();assert.equal(await h.controller.copyLink(),false);assert.ok(h.log.some(x=>x.view==='manual'));assert.equal(h.log.some(x=>x.notify),false);
  }
});

test('concurrent taps cannot accumulate native sheets or clipboard jobs',async()=>{
  const native=deferred();let shares=0;const h=fixture({share:()=>{shares++;return native.promise;}});
  const first=h.controller.shareStation();assert.equal(await h.controller.shareStation(),false);assert.equal(shares,1);native.resolve();await first;
  const clipboard=deferred();let copies=0;const c=fixture({copy:()=>{copies++;return clipboard.promise;}});await c.controller.shareStation();const pending=c.controller.copyLink();assert.equal(await c.controller.copyLink(),false);assert.equal(copies,1);clipboard.resolve();await pending;
});

test('dismissal or disposal fences late native and clipboard outcomes',async()=>{
  const native=deferred(),h=fixture({share:()=>native.promise});const pending=h.controller.shareStation();h.controller.dispose();native.reject(Error('late'));assert.equal(await pending,false);assert.equal(h.log.some(x=>x.view==='open'),false);
  const clipboard=deferred(),c=fixture({copy:()=>clipboard.promise});await c.controller.shareStation();const copy=c.controller.copyLink();c.controller.dismiss();clipboard.resolve();assert.equal(await copy,false);assert.equal(c.log.some(x=>x.notify),false);
});

test('malformed or external payloads never reach native APIs or clipboard',async()=>{
  let calls=0;for(const payload of [null,{title:'x',text:'x',url:'https://evil.example/?token=not-shared'},{title:'x',text:'x',url:'https://app.earthradio.stream/s/not-an-id'}]){
    const h=fixture({getPayload:()=>payload,share:async()=>{calls++;},copy:async()=>{calls++;}});assert.equal(await h.controller.shareStation(),false);assert.equal(await h.controller.copyLink(),false);
  }assert.equal(calls,0);
});

test('a failing optional view cannot escape into the player owner',async()=>{
  const h=fixture({view:{open(){throw Error('unavailable');},close(){throw Error('unavailable');}}});assert.equal(await h.controller.shareStation(),false);assert.doesNotThrow(()=>h.controller.dispose());
});
