import test from 'node:test';import assert from 'node:assert/strict';
import {publishedStationRows,mergeStationRecords} from '../server/desktop-proxy.mjs';
import {serializeVariantGroups} from '../site/assets/station-variants.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CURATED_PLACES} from '../site/assets/curated-places.js';
import {cityProgramChoices} from '../site/assets/today-core.js';
const station=(id,name,clickcount,countrycode='FR')=>({stationuuid:id,name,clickcount,countrycode,url:'https://radio.example/'+id,lastcheckok:1});
const popular=station('popular','ZZZ Popular',10000),low=Array.from({length:25},(_,index)=>station('low-'+index,'AAA Station '+index,1));
const response=rows=>Response.json({schemaVersion:2,groups:serializeVariantGroups(rows)},{headers:{'x-directory-generated-at':'2026-11-09T00:00:00.000Z','x-directory-producer-sha':'a'.repeat(40)}});
test('native root and country record limits retain popular late-alphabet stations',async()=>{
  const deadlines=[];
  const result=await publishedStationRows(async(_path,_representation,options)=>{deadlines.push(options.deadlineAt);return response([...low,popular]);},{limit:1,countryCodes:['FR'],countryLimit:25});
  assert.equal(result.stations[0].stationuuid,'popular');assert.equal(result.stations[1].stationuuid,'popular');assert.equal(result.stations.length,26);
  assert.equal(result.directorySnapshot.producerSourceSha,'a'.repeat(40));assert.equal(new Set(deadlines).size,1);
  // Root and country publications overlap. Source claims are optional in the
  // compact wire format; merging them must not throw and trigger live fallback.
  const merged=mergeStationRecords(result.stations);assert.equal(merged.length,25);assert.equal(merged[0].stationuuid,'popular');
});
test('duplicate identities tolerate missing or malformed optional source claims',()=>{
  for(const sourceClaims of [undefined,null,'bad',[null,'bad',{}]]){
    const merged=mergeStationRecords([popular,{...popular,sourceClaims}]);assert.equal(merged.length,1);assert.deepEqual(merged[0].sourceClaims,[]);
  }
  const claim={source:'radio-browser',confidence:.85};
  assert.deepEqual(mergeStationRecords([{...popular,sourceClaims:[claim]},popular])[0].sourceClaims,[claim]);
});
test('native partial country outage preserves root and discloses missing coverage',async()=>{
  const result=await publishedStationRows(async path=>{if(path.includes('/country/'))throw Error('country unavailable');return response([popular]);},{limit:1,countryCodes:['FR','JP'],countryLimit:25});
  assert.equal(result.stations.length,1);assert.deepEqual(result.missingCountries.sort(),['FR','JP']);
});
test('native publication limits reject invalid caller input before IO',async()=>{
  await assert.rejects(publishedStationRows(()=>{throw Error('must not read');},{limit:Infinity,countryCodes:[],countryLimit:25}),/limits/);
});

test('native city enrichment is opt-in, prefix preserving and uses only the existing catalog read',async()=>{
 const root=CURATED_PLACES.flatMap((city,index)=>Array.from({length:6},(_,number)=>({...station(`city-${index}-${number}`,`${city.name} Radio ${number}`,1000-index*10-number,city.countrycode),state:city.name,geo_lat:city.point[0],geo_long:city.point[1]})));
 const calls=[],read=async path=>{calls.push(path);return response(root);};
 const defaults=await publishedStationRows(read,{limit:1,countryCodes:[],countryLimit:25});
 assert.equal(defaults.stations.length,1);assert.deepEqual(calls,['/directory/snapshot']);calls.length=0;
 const enriched=await publishedStationRows(read,{limit:1,countryCodes:[],countryLimit:25,placeSeeds:true});
 assert.deepEqual(enriched.stations.slice(0,1).map(({nativeProgram:_evidence,...row})=>row),defaults.stations);assert.ok(enriched.stations.length<=56);
 assert.deepEqual(calls,['/directory/snapshot']);assert.equal(new Set(enriched.stations.map(row=>row.stationuuid)).size,enriched.stations.length);
 for(const city of CURATED_PLACES)assert.equal(cityProgramChoices(enriched.stations,city.id).length,5,city.name);
});

test('invalid native opt-in values fail before a published directory read',async()=>{
 for(const placeSeeds of [null,'1',1,'false',{}])await assert.rejects(publishedStationRows(()=>{throw Error('unexpected read');},{limit:1,countryCodes:[],countryLimit:25,placeSeeds}),/flag|option|limits/i);
});

test('native sampling retains omitted transitive bridges and conflicting place evidence',async()=>{
 const seoul=CURATED_PLACES.find(city=>city.name==='Seoul'),vienna=CURATED_PLACES.find(city=>city.name==='Vienna');
 const local=(id,name,stream,clickcount,city=seoul)=>({...station(id,name,clickcount,city.countrycode),url:`https://radio.example/${stream}`,state:city.name,geo_lat:city.point[0],geo_long:city.point[1]});
 const prefix=[local('a','Alpha','a',100),local('b','Beta','b',99)];
 for(const conflict of [false,true]){
  const root=[...prefix,local('bridge','Alpha','b',1),...Array.from({length:3},(_,i)=>local('p'+i,'Distinct '+i,'p'+i,20-i))];
  if(conflict)root.push(local('conflict','Other place','b',0,vienna));
  let reads=0;const result=await publishedStationRows(async()=>{reads++;return response(root);},{limit:2,countryCodes:[],countryLimit:25,placeSeeds:true});
  assert.deepEqual(result.stations.slice(0,2).map(row=>row.stationuuid),['a','b']);
  assert.equal(reads,1);assert.ok(result.stations.length<=57);
  assert.equal(cityProgramChoices(result.stations,seoul.id).length,conflict?3:4);
 }
});

test('the actual federated route rejects malformed flag values and forwards only explicit opt-in',async()=>{
 const source=await readFile(new URL('../server/desktop-proxy.mjs',import.meta.url),'utf8'),calls=[];
 const context={URL,handleMetadataApi:async()=>false,applyCors:()=>true,clampInt:(_value,fallback)=>fallback,parseCountryCodes:(_value,fallback)=>fallback,FEATURED_COUNTRY_CODES:['KR'],FEATURED_COUNTRY_LIMIT:300,
  getStations:async(...args)=>{calls.push(args);return{stations:[]};},sendJson:(_res,status,body)=>({status,body})};
 vm.runInNewContext(source.slice(source.indexOf('async function route('),source.indexOf('function applyCors(')),context);
 const request=query=>context.route({method:'GET',url:'/owned/api/stations/federated'+query},{},'/owned');
 for(const bad of ['true','0','','2']){const result=await request('?placeSeeds='+bad);assert.equal(result.status,400);assert.equal(calls.length,0);}
 assert.equal((await request('?placeSeeds=1&placeSeeds=1')).status,400);assert.equal(calls.length,0);
 assert.equal((await request('')).status,200);assert.equal(calls.at(-1)[3],false);
 assert.equal((await request('?placeSeeds=1')).status,200);assert.equal(calls.at(-1)[3],true);
});
