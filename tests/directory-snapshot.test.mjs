import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectoryHosts,directoryHosts,directoryJson} from '../site/assets/directory-hosts.js';
import {loadDirectorySnapshot,snapshotCountryStatus} from '../site/assets/directory-client.js';
import {readFile} from 'node:fs/promises';
import {serializeVariantGroups} from '../site/assets/station-variants.js';

test('only directory and metadata routes invoke Functions; static assets keep their free delivery path',async()=>{
  const routes=JSON.parse(await readFile(new URL('../site/_routes.json',import.meta.url),'utf8'));
  assert.deepEqual(routes,{version:1,include:['/api/*','/directory/*'],exclude:[]});
});

async function browserProtocol(task){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{value:{protocol:'https:'},configurable:true});try{await task();}finally{if(descriptor)Object.defineProperty(globalThis,'location',descriptor);else delete globalThis.location;}}
test('invalid snapshots cannot replace the catalog with only pinned fallback stations',()=>browserProtocol(async()=>{
  for(const rows of [[],['invalid'],[{stationuuid:'bad',name:'Bad',url:'javascript:void(0)'}]])await assert.rejects(loadDirectorySnapshot({directorySnapshotUrl:'/directory/snapshot'},{fetchImpl:async()=>Response.json(rows)}),/Invalid snapshot/);
}));
test('targeted country loading honors the configured limit and rejects wrong-country batches',()=>browserProtocol(async()=>{
  const root={stationuuid:'root',name:'Root',url:'https://streams.example/root',countrycode:'US'},country=Array.from({length:40},(_,i)=>({...root,stationuuid:'target-'+i,countrycode:'KR'}));let wrong=false;
  const config={directorySnapshotUrl:'/directory/snapshot',directoryRequestedCountries:['KR'],featuredCountryLimit:25};
  const options={fetchImpl:async path=>Response.json(path==='/directory/snapshot'?[root]:wrong?[root]:country)};
  const first=await loadDirectorySnapshot(config,options);assert.equal(first.stations.filter(row=>row.stationuuid.startsWith('target-')).length,25);assert.equal(snapshotCountryStatus('KR'),'loaded');
  wrong=true;await loadDirectorySnapshot(config,options);assert.equal(snapshotCountryStatus('KR'),'failed');
}));

test('targeted limits apply after eligible country records are selected',()=>browserProtocol(async()=>{
  const root={stationuuid:'root',name:'Root',url:'https://streams.example/root',countrycode:'US'};
  const foreign=Array.from({length:25},(_,i)=>({...root,stationuuid:'foreign-'+i}));
  const own=Array.from({length:30},(_,i)=>({...root,stationuuid:'target-'+i,countrycode:'KR'}));
  const invalid={...root,stationuuid:'invalid',countrycode:'KR',url:'javascript:void(0)'};
  const result=await loadDirectorySnapshot({directorySnapshotUrl:'/directory/snapshot',directoryRequestedCountries:['KR'],featuredCountryLimit:25},{fetchImpl:async path=>Response.json(path==='/directory/snapshot'?[root]:[...foreign,invalid,...own])});
  assert.equal(result.stations.filter(row=>row.stationuuid.startsWith('target-')).length,25);
  assert.equal(result.stations.some(row=>row.stationuuid==='invalid'||row.stationuuid.startsWith('foreign-')),false);
  assert.equal(snapshotCountryStatus('KR'),'loaded');
}));
test('grouped country limits retain popular late-alphabet stations',()=>browserProtocol(async()=>{
  const popular={stationuuid:'popular-fr',name:'ZZZ Popular France',url:'https://radio.example/popular',clickcount:10000,countrycode:'FR'};
  const low=Array.from({length:25},(_,index)=>({...popular,stationuuid:'low-'+index,name:'AAA France '+index,url:'https://radio.example/low-'+index,clickcount:1}));
  const root={...popular,stationuuid:'root-us',countrycode:'US'};
  const result=await loadDirectorySnapshot({directorySnapshotUrl:'/directory/snapshot',directoryRequestedCountries:['FR'],featuredCountryLimit:25},{fetchImpl:async path=>Response.json({schemaVersion:2,groups:serializeVariantGroups(path==='/directory/snapshot'?[root]:[popular,...low])})});
  const france=result.stations.filter(row=>row.countrycode==='FR');assert.equal(france.length,25);assert.ok(france.some(row=>row.stationuuid==='popular-fr'));
}));

test('discovery accepts only provider HTTPS names and caches one healthy set',async()=>{
  assert.deepEqual(directoryHosts([{name:'de2.api.radio-browser.info'},{name:'de2.api.radio-browser.info'},{name:'evil.example'},{name:'de1.api.radio-browser.info.evil.example'},{name:'https://de1.api.radio-browser.info'}]),['https://de2.api.radio-browser.info']);
  let calls=0,clock=1000;const discovery=createDirectoryHosts({now:()=>clock,fetchImpl:async()=>{calls++;return Response.json([{name:'de2.api.radio-browser.info'}]);}});
  const [a,b]=await Promise.all([discovery.discover(),discovery.discover()]);assert.deepEqual(a,b);assert.equal(calls,1);
  assert.equal((await discovery.discover())[0],'https://de2.api.radio-browser.info');assert.equal(calls,1);
  discovery.failed(a[0]);assert.ok(!(await discovery.discover()).includes(a[0]));clock+=3600001;await discovery.discover();assert.equal(calls,2);
});
test('directory parser enforces streamed and declared byte budgets',async()=>{
  await assert.rejects(directoryJson(new Response('[1,2,3]'),3),/large/);
  await assert.rejects(directoryJson(new Response('[]',{headers:{'content-length':'99'}}),3),/large/);
  await assert.rejects(directoryJson(new Response('not json')),SyntaxError);
});

// Published-generation behavior is exercised separately from provider discovery.
