import test from 'node:test';
import assert from 'node:assert/strict';
import {createRadioMediaSession} from '../site/assets/media-session.js';
import {BRAND_MEDIA_ARTWORK} from '../site/assets/media-session-core.js';

const station={stationuuid:'one',name:'Berlin Signal',countrycode:'DE',state:'Berlin',geo_lat:52.52,geo_long:13.405,url:'https://example.com/live'};
const song={stationUuid:'one',artist:'Artist',title:'First song',confidence:78};
const pixels=letter=>[96,256,512].map(size=>({src:`data:image/png;base64,${letter}Q==`,sizes:`${size}x${size}`,type:'image/png'}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 let snapshot={station:structuredClone(station),status:'playing',played:true},current=structuredClone(song),notify,locale='en',unsubscribed=false,artDisposed=0;
 const handlers={},calls=[],errors=[],requests=[];
 const session={metadata:null,playbackState:'none',setActionHandler(action,handler){handlers[action]=handler;}};
 class Metadata{constructor(value){Object.assign(this,structuredClone(value));}}
 const commands=Object.fromEntries(['play','pause','stop','previous','next'].map(action=>[action,()=>{calls.push(action);} ]));
 const controller=createRadioMediaSession({snapshot:()=>snapshot,...commands,...options.adapter},{session,Metadata,
  getLocale:()=>locale,getSong:()=>current,subscribeSong:listener=>{notify=listener;listener();return()=>{unsubscribed=true;};},
  artworkLoader:{load:async(url,{signal})=>{requests.push({url,signal});return null;},dispose(){artDisposed++;}},
  onError:action=>errors.push(action),...options.dependencies});
 return{controller,session,handlers,calls,errors,requests,
  snapshot:()=>snapshot,setSnapshot(value){snapshot=value;},setSong(value){current=value;},publish(){notify?.();},setLocale(value){locale=value;},
  unsubscribed:()=>unsubscribed,artDisposed:()=>artDisposed};
}

test('controller projects current song and registers five independent owned actions without autoplay',()=>{
 const h=fixture();assert.deepEqual(Object.keys(h.handlers).sort(),['nexttrack','pause','play','previoustrack','stop']);
 assert.deepEqual([h.session.metadata.title,h.session.metadata.artist,h.session.metadata.album],['First song','Artist','Berlin Signal']);
 assert.equal(h.session.playbackState,'playing');assert.deepEqual(h.calls,[]);h.controller.dispose();
});
test('selection/loading suppresses earlier song, then actual played state admits the new promoted song',()=>{
 const h=fixture();h.controller.selectStation();assert.equal(h.session.metadata.title,'Berlin Signal');
 h.setSnapshot({...h.snapshot(),status:'loading',played:false});h.controller.refresh();assert.equal(h.session.metadata.title,'Berlin Signal');
 h.setSong({...song,title:'New song'});h.publish();assert.equal(h.session.metadata.title,'Berlin Signal');
 h.setSnapshot({...h.snapshot(),status:'playing',played:true});h.controller.refresh();assert.equal(h.session.metadata.title,'New song');h.controller.dispose();
});
test('a different station snapshot cannot provide title or cover and a locale refresh uses place labels',()=>{
 const h=fixture();h.setSong({...song,stationUuid:'another',artworkUrl:'https://i.scdn.co/art'});h.publish();
 assert.equal(h.session.metadata.title,'Berlin Signal');assert.equal(h.requests.length,0);
 h.setLocale('ar');h.controller.refresh();assert.equal(h.session.metadata.artist,'Berlin, ألمانيا');h.controller.dispose();
});
test('pause and error state transitions never leave a playing Media Session state',()=>{
 const h=fixture();h.setSnapshot({...h.snapshot(),status:'paused'});h.controller.refresh();assert.equal(h.session.playbackState,'paused');assert.equal(h.session.metadata.title,'First song');
 h.setSnapshot({...h.snapshot(),status:'error'});h.controller.refresh();assert.equal(h.session.playbackState,'none');assert.equal(h.session.metadata.title,'Berlin Signal');
 h.setSnapshot({...h.snapshot(),status:'idle'});h.controller.refresh();assert.equal(h.session.metadata,null);h.controller.dispose();
});
test('transport invokes current callbacks rather than keeping a stale list or starting on refresh',async()=>{
 let list=['A','B'],heard=[];const h=fixture({adapter:{next:()=>heard.push(list[1]),previous:()=>heard.push(list[0])}});
 list=['C','D'];await h.handlers.nexttrack();await h.handlers.previoustrack();await h.handlers.play();await h.handlers.pause();
 assert.deepEqual(heard,['D','C']);assert.deepEqual(h.calls,['play','pause']);h.controller.refresh();assert.deepEqual(h.calls,['play','pause']);h.controller.dispose();
});
test('Stop blocks late song refresh until a new owned selection and never invokes Play',async()=>{
 const h=fixture();await h.handlers.stop();assert.deepEqual(h.calls,['stop']);assert.equal(h.session.metadata,null);assert.equal(h.session.playbackState,'none');
 h.setSong({...song,title:'Late'});h.publish();h.controller.refresh();assert.equal(h.session.metadata,null);
 h.controller.selectStation();assert.equal(h.session.metadata.title,'Berlin Signal');h.controller.refresh();assert.equal(h.session.metadata.title,'Late');h.controller.dispose();
});
test('an unsupported action does not prevent later actions or metadata',()=>{
 const handlers={};const session={metadata:null,setActionHandler(action,handler){if(action==='stop')throw new DOMException('unsupported','NotSupportedError');handlers[action]=handler;}};
 const h=fixture({dependencies:{session}});assert.equal(typeof handlers.nexttrack,'function');assert.equal(typeof handlers.previoustrack,'function');assert.equal(session.metadata.title,'First song');h.controller.dispose();
});
test('missing Media Session is inert and a missing metadata constructor still permits supported actions',async()=>{
 const absent=fixture({dependencies:{session:null}});absent.controller.selectStation();absent.controller.refresh();assert.equal(absent.requests.length,0);assert.deepEqual(absent.calls,[]);absent.controller.dispose();
 const h=fixture({dependencies:{Metadata:null}});await h.handlers.play();assert.deepEqual(h.calls,['play']);assert.equal(h.session.metadata,null);h.controller.dispose();
});
test('action failures are contained without changing station or invoking another transport',async()=>{
 const h=fixture({adapter:{next:async()=>{throw Error('fixture command error');}}});await h.handlers.nexttrack();
 assert.deepEqual(h.calls,[]);assert.deepEqual(h.errors,['nexttrack']);assert.equal(h.snapshot().station.stationuuid,'one');h.controller.dispose();
});
test('an optional metadata projection failure cannot escape into the audio owner',async()=>{
 const h=fixture({dependencies:{getLocale:()=>{throw Error('fixture metadata failure');}}});
 assert.doesNotThrow(()=>h.controller.refresh());assert.doesNotThrow(()=>h.controller.selectStation());
 await h.handlers.play();assert.deepEqual(h.calls,['play']);assert.equal(h.session.metadata,null);h.controller.dispose();
});
test('same-track notifications do not refetch a cover and late artwork cannot replace a newer track',async()=>{
 const pending=[];const h=fixture({dependencies:{artworkLoader:{load:(url,{signal})=>new Promise(resolve=>pending.push({url,signal,resolve})),dispose(){}}}});
 h.setSong({...song,artworkUrl:'https://i.scdn.co/first'});h.publish();h.publish();assert.equal(pending.length,1);
 h.setSong({...song,title:'Second song',artworkUrl:'https://i.scdn.co/second'});h.publish();assert.equal(pending.length,2);assert.equal(pending[0].signal.aborted,true);
 pending[0].resolve(pixels('Y'));await flush();assert.equal(h.session.metadata.title,'Second song');assert.deepEqual(h.session.metadata.artwork,[BRAND_MEDIA_ARTWORK]);
 pending[1].resolve(pixels('Z'));await flush();assert.equal(h.session.metadata.title,'Second song');assert.deepEqual(h.session.metadata.artwork,pixels('Z'));h.controller.dispose();
});
test('artwork completion rechecks actual current station even if no notification reached the controller',async()=>{
 let resolve;const h=fixture({dependencies:{artworkLoader:{load:()=>new Promise(done=>{resolve=done;}),dispose(){}}}});
 h.setSong({...song,artworkUrl:'https://i.scdn.co/first'});h.publish();
 h.setSnapshot({...h.snapshot(),station:{...station,stationuuid:'two',name:'Different station'}});
 resolve(pixels('Y'));await flush();assert.equal(h.session.metadata.title,'Different station');assert.deepEqual(h.session.metadata.artwork,[BRAND_MEDIA_ARTWORK]);h.controller.dispose();
});
for(const boundary of ['stop','dispose'])test(`late image after ${boundary} cannot republish metadata`,async()=>{
 let resolve,signal;const h=fixture({dependencies:{artworkLoader:{load:(_url,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});},dispose(){}}}});
 h.setSong({...song,artworkUrl:'https://i.scdn.co/first'});h.publish();
 if(boundary==='stop')await h.handlers.stop();else h.controller.dispose();
 assert.equal(signal.aborted,true);resolve(pixels('Y'));await flush();assert.equal(h.session.metadata,null);assert.equal(h.session.playbackState,'none');h.controller.dispose();
});
test('artwork failure keeps bounded first-party fallback and never changes audio commands',async()=>{
 const h=fixture({dependencies:{artworkLoader:{load:async()=>{throw Error('fixture CORS failure');},dispose(){}}}});
 h.setSong({...song,artworkUrl:'https://i.scdn.co/first'});h.publish();await flush();
 assert.equal(h.session.metadata.title,'First song');assert.deepEqual(h.session.metadata.artwork,[BRAND_MEDIA_ARTWORK]);assert.deepEqual(h.calls,[]);h.controller.dispose();
});
test('a delayed Stop completion cannot clear a newer explicit station selection',async()=>{
 let finish;const h=fixture({adapter:{stop:()=>new Promise(resolve=>{finish=resolve;})}});
 const stopped=h.handlers.stop();h.setSnapshot({...h.snapshot(),station:{...station,stationuuid:'new',name:'New station'}});h.controller.selectStation();
 finish();await stopped;assert.equal(h.session.metadata.title,'New station');h.controller.dispose();
});
test('dispose releases subscriptions, artwork and handlers once; queued retired callbacks are inert',async()=>{
 const h=fixture(),oldPlay=h.handlers.play;h.controller.dispose();h.controller.dispose();await oldPlay();
 assert.ok(h.unsubscribed());assert.equal(h.artDisposed(),1);assert.ok(Object.values(h.handlers).every(x=>x===null));assert.deepEqual(h.calls,[]);assert.equal(h.session.metadata,null);
});
