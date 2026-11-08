import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectoryHosts,directoryHosts,directoryJson} from '../site/assets/directory-hosts.js';
import {createDirectorySnapshot,directoryPath} from '../functions/_shared/directory-snapshot.js';
import {loadDirectorySnapshot,snapshotCountryStatus} from '../site/assets/directory-client.js';
import {readFile} from 'node:fs/promises';

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
test('snapshot exposes finite paths and refuses arbitrary targets, methods and query fragmentation',async()=>{
  assert.equal(directoryPath('/directory/country/KR').includes('countrycode=KR'),true);
  for(const path of ['/directory/http://evil.example','/directory/country/kr','/directory/country/AAA'])assert.equal(directoryPath(path),null);
  const handler=createDirectorySnapshot({fetchImpl:async()=>{throw Error('must not fetch');}});
  assert.equal((await handler({request:new Request('https://radio.example/directory/snapshot?url=https://evil.example')})).status,400);
  assert.equal((await handler({request:new Request('https://radio.example/directory/snapshot',{method:'POST'})})).status,405);
});

test('directory fetches use Workers-supported manual redirects without following a different origin',async()=>{
  const handler=createDirectorySnapshot({fetchImpl:async(url,options)=>{
    if(options.redirect==='error')throw new TypeError('Unsupported redirect mode: error');
    assert.equal(options.redirect,'manual');
    return url.endsWith('/json/servers')?Response.json([{name:'de1.api.radio-browser.info'}]):Response.json([{stationuuid:'one',name:'One'}]);
  }});
  const response=await handler({request:new Request('https://radio.example/directory/snapshot')});
  assert.equal(response.status,200);assert.match(await response.text(),/One/);
});
test('directory redirects are rejected at each finite provider hop',async()=>{
  const calls=[];
  const handler=createDirectorySnapshot({fetchImpl:async(url,options)=>{
    calls.push({url,redirect:options.redirect});
    if(url.endsWith('/json/servers'))return Response.json([{name:'de1.api.radio-browser.info'}]);
    return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});
  }});
  assert.equal((await handler({request:new Request('https://radio.example/directory/snapshot')})).status,503);
  assert.ok(calls.length>0&&calls.every(({url,redirect})=>redirect==='manual'&&/^https:\/\/[a-z0-9-]+\.api\.radio-browser\.info\//.test(url)));
});
test('snapshot cache supports ETags, one-hour refresh, stale fallback and single-flight misses',async()=>{
  let clock=1000,calls=0,outage=false;const data=new Map(),work=[];
  const cache={async match(key){return data.get(key.url)?.clone();},async put(key,response){data.set(key.url,new Response(await response.text(),response));}};
  const handler=createDirectorySnapshot({now:()=>clock,cacheImpl:cache,fetchImpl:async url=>{
    calls++;if(url.endsWith('/json/servers'))return Response.json([{name:'de1.api.radio-browser.info'}]);
    return outage?new Response('outage',{status:503}):Response.json([{stationuuid:'one',name:'One'}]);
  }});
  const context=(headers={})=>({request:new Request('https://radio.example/directory/snapshot',{headers}),waitUntil:p=>work.push(p)});
  const [a,b]=await Promise.all([handler(context()),handler(context())]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,2);assert.equal(await a.text(),await b.text());
  const etag=a.headers.get('etag');assert.equal((await handler(context({'if-none-match':etag}))).status,304);assert.equal(calls,2);
  clock+=3600001;outage=true;const stale=await handler(context());assert.equal(stale.headers.get('x-directory-state'),'stale');assert.match(await stale.text(),/One/);await Promise.all(work);
  const after=calls;assert.equal((await handler(context())).status,200);assert.equal(calls,after,'negative cooldown prevents repeated upstream outage fan-out');
});
for(const failed of ['match','put'])test(`a Cache API ${failed} failure cannot hide a valid fresh directory`,async()=>{
  const handler=createDirectorySnapshot({cacheImpl:{async match(){if(failed==='match')throw Error('cache unavailable');},async put(){if(failed==='put')throw Error('cache unavailable');}},fetchImpl:async url=>url.endsWith('/json/servers')?Response.json([{name:'de1.api.radio-browser.info'}]):Response.json([{stationuuid:'one',name:'One'}])});
  const response=await handler({request:new Request('https://radio.example/directory/snapshot')});assert.equal(response.status,200);assert.match(await response.text(),/One/);assert.equal(response.headers.get('x-directory-cache'),'unavailable');
});
for(const stalled of ['match','put'])test(`a stalled Cache API ${stalled} cannot hold a request forever`,async()=>{
  const handler=createDirectorySnapshot({timeoutMs:20,cacheTimeoutMs:10,cacheImpl:{match:()=>stalled==='match'?new Promise(()=>{}):undefined,put:()=>stalled==='put'?new Promise(()=>{}):undefined},fetchImpl:async url=>url.endsWith('/json/servers')?Response.json([{name:'de1.api.radio-browser.info'}]):Response.json([{stationuuid:'one',name:'One'}])});
  const result=await handler({request:new Request('https://radio.example/directory/snapshot')});assert.equal(result.status,200);assert.match(await result.text(),/One/);
});
test('a healthy slow body gets the full download budget and warms one shared cache entry',async()=>{
  const entries=new Map();let catalogs=0;
  const cache={async match(key){return entries.get(key.url)?.clone();},async put(key,response){entries.set(key.url,new Response(await response.text(),response));}};
  const handler=createDirectorySnapshot({timeoutMs:200,cacheTimeoutMs:5,cacheImpl:cache,fetchImpl:async url=>{
    if(url.endsWith('/json/servers'))return Response.json([{name:'de1.api.radio-browser.info'}]);catalogs++;
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('[{"name":'));setTimeout(()=>{controller.enqueue(new TextEncoder().encode('"slow"}]'));controller.close();},30);}}),{headers:{'content-type':'application/json'}});
  }});
  const context={request:new Request('https://radio.example/directory/snapshot')};
  const first=await handler(context),second=await handler(context);assert.equal(await first.text(),await second.text());assert.equal(catalogs,1);assert.equal(second.headers.get('x-directory-state'),'cached');
});
for(const mode of ['reset','oversize'])test(`a provider body ${mode} is an outage, not a cache-backend failure`,async()=>{
  let catalogs=0;
  const handler=createDirectorySnapshot({cacheImpl:{match:async()=>undefined,put:async(_key,response)=>{await response.text();}},fetchImpl:async url=>{
    if(url.endsWith('/json/servers'))return Response.json([{name:'de1.api.radio-browser.info'}]);catalogs++;
    return new Response(new ReadableStream({start(controller){if(mode==='reset')controller.error(Error('provider connection reset'));else{controller.enqueue(new Uint8Array(16*1024*1024+1));controller.close();}}}),{headers:{'content-type':'application/json'}});
  }});
  const context={request:new Request('https://radio.example/directory/snapshot')};
  assert.equal((await handler(context)).status,503);const before=catalogs;assert.equal((await handler(context)).status,503);assert.equal(catalogs,before,'body failures use the same bounded outage cooldown');
});
test('distinct cold keys cannot exceed the four-refresh isolate budget',async()=>{
  let catalogs=0;
  const handler=createDirectorySnapshot({fetchImpl:async url=>{
    if(url.endsWith('/json/servers'))return Response.json([{name:'de1.api.radio-browser.info'}]);catalogs++;
    await new Promise(resolve=>setTimeout(resolve,20));return Response.json([{stationuuid:'one',name:'One'}]);
  }});
  const paths=['snapshot','countries','country/FR','country/US','country/JP'];
  const results=await Promise.all(paths.map(path=>handler({request:new Request('https://radio.example/directory/'+path)})));
  assert.equal(results.filter(result=>result.status===503).length,1);assert.equal(catalogs,4);await Promise.all(results.map(result=>result.text()));
});
