import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildStationRecordIndex} from '../scripts/build-station-record-index.mjs';
import {createStationRecordReader} from '../functions/_shared/station-records.js';
import {LISTEN_MOE_STATIONS} from '../site/assets/direct-stations.js';
import {SNAPSHOT_ROOT} from '../site/assets/snapshot-protocol.js';

const id='a1234567-1234-4abc-8abc-0123456789ab';
const row=(stationuuid=id,extra={})=>({stationuuid,name:'A public station',url:'https://radio.example/live',countrycode:'GB',...extra});
function fixture(rows=[row()]){
  const clock={value:Date.parse('2026-11-12T16:00:00.000Z')};
  const generation=buildStationRecordIndex(rows,{generatedAt:new Date(clock.value).toISOString(),producerSourceSha:'a'.repeat(40),producerVersion:'0.37.0'});
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});const name=new URL(url).pathname.slice('/earth-radio/'.length);const body=name==='station-manifest.json'?JSON.stringify(generation.manifest):generation.files.get(name);return body===undefined?new Response('missing',{status:404}):new Response(body,{headers:{'content-type':'application/json'}});};
  return{clock,generation,calls,fetchImpl};
}

test('invalid and built-in IDs require no upstream request',async()=>{
  let calls=0;const reader=createStationRecordReader({fetchImpl:async()=>{calls++;throw Error('must not fetch');}});
  assert.equal(await reader.lookup('../private'),null);
  for(const direct of LISTEN_MOE_STATIONS){const found=await reader.lookup(direct.stationuuid);assert.equal(found.stationuuid,direct.stationuuid);assert.equal(found.url,direct.url);assert.ok(Object.isFrozen(found));}
  assert.equal(calls,0);
});

test('a cold public identity reads one manifest and only its hash-verified shard',async()=>{
  const f=fixture(),reader=createStationRecordReader({fetchImpl:f.fetchImpl,now:()=>f.clock.value});
  const found=await reader.lookup(id);assert.deepEqual(found,row());assert.ok(Object.isFrozen(found));assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].url,SNAPSHOT_ROOT+'station-manifest.json');
  for(const call of f.calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');assert.equal(call.options.redirect,'manual');assert.equal(new Headers(call.options.headers).has('cookie'),false);assert.equal(new Headers(call.options.headers).has('authorization'),false);}
  assert.equal(await reader.lookup(id),found);assert.equal(f.calls.length,2);
});

test('uppercase identity bytes and aliases are preserved rather than rewritten',async()=>{
  const upper=id.toUpperCase(),other='b1234567-1234-4abc-8abc-0123456789ab',f=fixture([row(upper),row(other)]);
  const reader=createStationRecordReader({fetchImpl:f.fetchImpl,now:()=>f.clock.value});
  assert.equal((await reader.lookup(upper)).stationuuid,upper);assert.equal((await reader.lookup(other)).stationuuid,other);
});

test('a well-formed absent station returns null without looking up live providers',async()=>{
  const f=fixture(),reader=createStationRecordReader({fetchImpl:f.fetchImpl,now:()=>f.clock.value});
  assert.equal(await reader.lookup('c1234567-1234-4abc-8abc-0123456789ab'),null);assert.equal(f.calls.length,2);
  assert.ok(f.calls.every(call=>call.url.startsWith(SNAPSHOT_ROOT)));
});

test('wrong hashes, extra bytes and invalid JSON never become a reusable record',async()=>{
  for(const fault of ['hash','tail','json']){
    const f=fixture();const fetchImpl=async(url,options)=>{const response=await f.fetchImpl(url,options);if(!url.includes('station-records/'))return response;const body=await response.text();return new Response(fault==='hash'?body.replace('A public','X public'):fault==='tail'?body+'x':'{',{headers:{'content-type':'application/json'}});};
    const reader=createStationRecordReader({fetchImpl,now:()=>f.clock.value});await assert.rejects(reader.lookup(id),/unavailable/i);await assert.rejects(reader.lookup(id),/unavailable/i);
  }
});

test('redirects and HTML responses cannot leave the fixed public publication boundary',async()=>{
  for(const response of [()=>new Response(null,{status:302,headers:{location:'https://evil.example/metadata'}}),()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}})]){
    let calls=0;const reader=createStationRecordReader({fetchImpl:async()=>{calls++;return response();}});await assert.rejects(reader.lookup(id),/unavailable/i);assert.equal(calls,1);
  }
});

test('manifest and shard bodies remain byte-bounded even with absent length headers',async()=>{
  const f=fixture();for(const manifestFault of [true,false]){
    const reader=createStationRecordReader({now:()=>f.clock.value,fetchImpl:async(url,options)=>{
      if(manifestFault||url.includes('station-records/'))return new Response(' '.repeat(manifestFault?65537:262145),{headers:{'content-type':'application/json'}});
      return f.fetchImpl(url,options);
    }});await assert.rejects(reader.lookup(id),/unavailable/i);
  }
});

test('a removed content-addressed shard refreshes the manifest once within one request budget',async()=>{
  const f=fixture(),next=fixture([row(id,{name:'New metadata'})]);let manifestCalls=0;
  const reader=createStationRecordReader({now:()=>f.clock.value,fetchImpl:async(url,options)=>{
    if(url.endsWith('station-manifest.json')){manifestCalls++;return (manifestCalls===1?f:next).fetchImpl(url,options);}
    if(f.generation.files.has(new URL(url).pathname.slice('/earth-radio/'.length)))return new Response('removed',{status:404});
    return next.fetchImpl(url,options);
  }});
  assert.equal((await reader.lookup(id)).name,'New metadata');assert.equal(manifestCalls,2);
});

test('one shared wall-clock deadline bounds a non-cooperating fetch',async()=>{
  const reader=createStationRecordReader({fetchImpl:()=>new Promise(()=>{}),timeoutMs:20});const start=Date.now();await assert.rejects(reader.lookup(id),/unavailable/i);assert.ok(Date.now()-start<1000);
});

test('a stalled crypto operation cannot keep the request open beyond its deadline',async()=>{
  const reader=createStationRecordReader({cryptoImpl:{subtle:{digest:()=>new Promise(()=>{})}},timeoutMs:20});
  const start=Date.now();await assert.rejects(reader.lookup(id),/unavailable/i);assert.ok(Date.now()-start<1000);
});

test('cached public data has an explicit refresh and maximum stale age',async()=>{
  const f=fixture();let down=false;const reader=createStationRecordReader({now:()=>f.clock.value,fetchImpl:(...args)=>down?Promise.reject(Error('offline')):f.fetchImpl(...args)});
  assert.equal((await reader.lookup(id)).name,'A public station');down=true;f.clock.value+=6*60*1000;
  assert.equal((await reader.lookup(id)).name,'A public station');f.clock.value+=8*86400000;
  await assert.rejects(reader.lookup(id),/unavailable/i);
});

test('only four parsed public shards are retained, with deterministic least-recently-used eviction',async()=>{
  const rows=[],buckets=new Set();
  for(let i=0;rows.length<5;i++){const key=i.toString(16).padStart(8,'0')+'-1234-4abc-8abc-0123456789ab',bucket=createHash('sha256').update(key).digest()[0];if(!buckets.has(bucket)){buckets.add(bucket);rows.push(row(key));}}
  const f=fixture(rows),reader=createStationRecordReader({fetchImpl:f.fetchImpl,now:()=>f.clock.value});
  for(const value of rows)assert.equal((await reader.lookup(value.stationuuid)).stationuuid,value.stationuuid);
  assert.equal(f.calls.length,6);await reader.lookup(rows[0].stationuuid);assert.equal(f.calls.length,7);
});

test('an altered descriptor cannot reinterpret an already cached immutable shard',async()=>{
  const f=fixture();let changed=false;const reader=createStationRecordReader({now:()=>f.clock.value,fetchImpl:async(url,options)=>{
    if(changed&&url.endsWith('station-manifest.json')){
      const value=structuredClone(f.generation.manifest),bucket=createHash('sha256').update(id).digest()[0];value.shards[bucket].bytes++;
      return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
    }
    return f.fetchImpl(url,options);
  }});
  await reader.lookup(id);changed=true;f.clock.value+=6*60*1000;await assert.rejects(reader.lookup(id),/unavailable/i);
});

test('a stalled body is canceled at the shared deadline and never cached',async()=>{
  let canceled=false;const reader=createStationRecordReader({timeoutMs:25,fetchImpl:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){canceled=true;}}),{headers:{'content-type':'application/json'}})});
  await assert.rejects(reader.lookup(id),/unavailable/i);assert.equal(canceled,true);
});

test('overlapping cold requests keep response bodies request-owned and cap active fetch work',async()=>{
  const f=fixture(),releases=[];let manifests=0;
  const reader=createStationRecordReader({now:()=>f.clock.value,fetchImpl:(url,options)=>{
    if(url.endsWith('station-manifest.json')){manifests++;return new Promise(resolve=>releases.push(async()=>resolve(await f.fetchImpl(url,options))));}
    return f.fetchImpl(url,options);
  }});
  const result=Promise.allSettled(Array.from({length:8},()=>reader.lookup(id)));
  const limit=Date.now()+1000;while(releases.length<4&&Date.now()<limit)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(manifests,4);await Promise.all(releases.map(release=>release()));
  const outcomes=await result;assert.equal(outcomes.filter(r=>r.status==='fulfilled'&&r.value.stationuuid===id).length,4);assert.equal(outcomes.filter(r=>r.status==='rejected').length,4);
});

test('the requested raw ID selects the same bucket as the producer',()=>{
  const f=fixture(),bucket=createHash('sha256').update(id).digest()[0];assert.equal(f.generation.manifest.shards[bucket].records,1);
});
