import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDirectoryGeneration} from '../scripts/build-directory-snapshot.mjs';
import {createDirectorySnapshot,directoryPath} from '../functions/_shared/directory-snapshot.js';
import {createPublishedCatalog} from '../site/assets/published-catalog.js';
import {SNAPSHOT_ACCEPT,SNAPSHOT_ROOT} from '../site/assets/snapshot-protocol.js';
const start=Date.parse('2026-11-09T00:00:00Z');
const row={stationuuid:'one',name:'Test Station',countrycode:'GB',url:'https://radio.example/live',lastcheckok:1};
function fixture(options={}){
  let clock=start,outage=false,generation=make(),mode='normal';const calls=[],entries=new Map(),work=[];
  function make(extra={}){return buildDirectoryGeneration([row,...options.rows||[]],{generatedAt:new Date(clock).toISOString(),producerSourceSha:'a'.repeat(40),minimumRecords:1,minimumCountries:1,...extra});}
  const fetchImpl=async(url,init)=>{
    calls.push(url);assert.ok(url.startsWith(SNAPSHOT_ROOT));assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
    if(outage)return new Response('outage',{status:503});
    const name=new URL(url).pathname.replace('/earth-radio/','');
    if(name==='manifest.json')return Response.json(generation.manifest);
    const data=generation.files.get(name);if(!data)return new Response(null,{status:404});
    if(mode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}});
    if(mode==='corrupt')return Response.json({wrong:true});
    if(mode==='reset')return new Response(new ReadableStream({start(controller){controller.error(Error('reset'));}}),{headers:{'content-type':'application/json'}});
    if(mode==='oversize')return new Response('[]',{headers:{'content-type':'application/json','content-length':String(17*1024*1024)}});
    return new Response(data,{headers:{'content-type':'application/json'}});
  };
  const cache={match:async key=>entries.get(key.url)?.clone(),put:async(key,response)=>entries.set(key.url,new Response(await response.arrayBuffer(),response))};
  const handler=createDirectorySnapshot({fetchImpl,cacheImpl:cache,now:()=>clock,...options});
  const request=(path='snapshot',headers={},method='GET')=>handler({request:new Request('https://app.example/directory/'+path,{headers,method}),waitUntil:p=>work.push(p)});
  return{request,calls,entries,work,fetchImpl,make,get generation(){return generation;},set generation(value){generation=value;},set mode(value){mode=value;},set outage(value){outage=value;},get clock(){return clock;},set clock(value){clock=value;}};
}
test('finite route validation refuses arbitrary targets, methods and query fragmentation',async()=>{
  assert.equal(directoryPath('/directory/country/KR'),'/directory/country/KR');
  for(const value of ['/directory/country/kr','/directory/country/AAA','/directory/http://evil.example'])assert.equal(directoryPath(value),null);
  const f=fixture();assert.equal((await f.request('snapshot?url=evil')).status,400);assert.equal((await f.request('snapshot',{},'POST')).status,405);assert.equal(f.calls.length,0);
});
test('one normalized published source serves v2 and legacy clients with independent stable ETags',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.request(),f.request()]);assert.equal(a.status,200);assert.equal(f.calls.length,2);assert.deepEqual(await a.json(),await b.json());
  const etag=a.headers.get('etag');assert.equal(a.headers.get('x-directory-generated-at'),new Date(start).toISOString());assert.equal(a.headers.get('vary'),'Accept');
  assert.equal((await f.request('snapshot',{'if-none-match':'W/'+etag})).status,304);
  assert.equal((await f.request('snapshot',{},'HEAD')).status,200);assert.equal(f.calls.length,2);
  const legacy=await f.request('snapshot',{Accept:'application/json'});assert.ok(Array.isArray(await legacy.json()));assert.notEqual(legacy.headers.get('etag'),etag);
});
test('generation timestamp changes do not change unchanged payload ETags',async()=>{
  const f=fixture(),a=await f.request();f.clock+=3600001;f.generation=f.make();
  const stale=await f.request();assert.equal(stale.headers.get('x-directory-state'),'stale');await Promise.all(f.work);
  const fresh=await f.request();assert.equal(fresh.headers.get('etag'),a.headers.get('etag'));assert.equal(fresh.headers.get('x-directory-generated-at'),new Date(f.clock).toISOString());
});
test('provider outage makes no provider request and a publication outage retains last-good cached data',async()=>{
  const f=fixture();const a=await f.request();f.clock+=3600001;f.outage=true;
  const stale=await f.request();assert.equal(stale.status,200);assert.equal(stale.headers.get('x-directory-state'),'stale');assert.equal(await stale.text(),await a.text());await Promise.all(f.work);
  const before=f.calls.length;assert.equal((await f.request()).status,200);assert.equal(f.calls.length,before);
  f.clock+=7*86400000+1;assert.equal((await f.request()).status,503);
});
test('cached old manifest refreshes once when atomic publication removed its blob',async()=>{
  const f=fixture(),read=createPublishedCatalog({fetchImpl:f.fetchImpl,now:()=>f.clock});await read('/directory/snapshot','catalog');
  f.generation=buildDirectoryGeneration([{...row,url:'https://radio.example/new'}],{generatedAt:new Date(start).toISOString(),producerSourceSha:'b'.repeat(40),minimumRecords:1,minimumCountries:1});
  const response=await read('/directory/snapshot','catalog');assert.match(await response.text(),/radio.example\/new/);
  assert.equal(f.calls.filter(url=>url.includes('manifest.json?refresh=')).length,1);
});
for(const mode of ['redirect','corrupt','reset','oversize'])test(`invalid published ${mode} cannot enter cache or replace last-good data`,async()=>{
  const f=fixture();f.mode=mode;const response=await f.request();assert.equal(response.status,503);assert.equal(f.entries.size,0);
  const before=f.calls.length;assert.equal((await f.request()).status,503);assert.equal(f.calls.length,before);
});
for(const failed of ['match','put'])test(`Cache API ${failed} failure cannot hide valid publication`,async()=>{
  const f=fixture({cacheImpl:{match:async()=>{if(failed==='match')throw Error('cache');},put:async()=>{if(failed==='put')throw Error('cache');}}});
  const response=await f.request();assert.equal(response.status,200);assert.equal(response.headers.get('x-directory-cache'),'unavailable');
});
for(const stalled of ['match','put'])test(`stalled Cache API ${stalled} has an independent deadline`,async()=>{
  const f=fixture({cacheTimeoutMs:10,cacheImpl:{match:()=>stalled==='match'?new Promise(()=>{}):undefined,put:()=>stalled==='put'?new Promise(()=>{}):undefined}});
  assert.equal((await f.request()).status,200);
});
test('stalled fetch/body obey the shared absolute timeout',async()=>{
  for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})]){
    const read=createPublishedCatalog({fetchImpl,timeoutMs:20});await assert.rejects(read('/directory/snapshot'),/deadline/);
  }
});
test('a caller deadline bounds a multi-read native batch without a new request after expiry',async()=>{
  let calls=0;const read=createPublishedCatalog({fetchImpl:async()=>{calls++;return new Promise(()=>{});},timeoutMs:15000});
  const deadlineAt=Date.now()+20;await assert.rejects(read('/directory/snapshot','catalog',{deadlineAt}),/deadline/);
  await assert.rejects(read('/directory/country/GB','catalog',{deadlineAt}),/deadline/);assert.equal(calls,1);
});
test('country routes default to legacy arrays, explicit v2 expands separately and unknown country is stable empty',async()=>{
  const f=fixture();assert.ok(Array.isArray(await(await f.request('country/GB')).json()));
  assert.equal((await(await f.request('country/GB',{Accept:SNAPSHOT_ACCEPT})).json()).schemaVersion,2);
  assert.deepEqual(await(await f.request('country/ZZ')).json(),[]);
});
test('distinct cold routes cannot exceed four in-flight refreshes',async()=>{
  const f=fixture();const results=await Promise.all(['snapshot','countries','servers','country/GB','country/US'].map(path=>f.request(path)));
  assert.equal(results.filter(response=>response.status===503).length,1);await Promise.all(results.map(response=>response.text()));
});
