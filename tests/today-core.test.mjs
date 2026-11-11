import test from 'node:test';
import assert from 'node:assert/strict';
import {CURATED_PLACES} from '../site/assets/curated-places.js';
import {programComponents} from '../site/assets/program-components.js';
import {TODAY_CALENDAR_V1,todayPlaceForUTCDate,cityProgramChoices,appendCitySeeds} from '../site/assets/today-core.js';
import {loadDirectorySnapshot} from '../site/assets/directory-client.js';
import {mergeMappedStations} from '../site/assets/map-directory.js';

const seoul=CURATED_PLACES.find(city=>city.name==='Seoul');
const row=(number,patch={})=>({stationuuid:`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`,name:`Seoul Radio ${number}`,countrycode:'KR',state:'Seoul',geo_lat:seoul.point[0],geo_long:seoul.point[1],url:`https://radio.example/${number}`,codec:'MP3',lastcheckok:1,quality:{score:80},...patch});

test('Today accepts the bounded root, twenty country shards and disjoint mapped sample',async()=>{
 // Existing readers admit 10k root +20x1k requested-country rows +2 pins +10k map.
 const countries=['AT','IE','ID','ES','TR','BR','AU','NZ','PL','PT','SE','NO','DK','FI','GR','IT','CH','BE','CZ','HU'];
 const batch=(offset,count,countrycode)=>Array.from({length:count},(_,index)=>row(offset+index+1,{state:'',name:`Program ${offset+index+1}`,countrycode,geo_lat:null,geo_long:null}));
 const previous=globalThis.location;globalThis.location={protocol:'https:'};
 try{
  const snapshot=await loadDirectorySnapshot({directorySnapshotUrl:'/directory/snapshot',featuredCountryCodes:countries,featuredCountryLimit:1000},{fetchImpl:async path=>Response.json(path==='/directory/snapshot'?batch(0,10000,'DE'):batch(10000+countries.indexOf(path.split('/').at(-1))*1000,1000,path.split('/').at(-1)))});
  const mapped=batch(30000,10000,'DE');mapped[9999]=row(40000);
  const rows=mergeMappedStations(snapshot.stations,mapped);
  assert.equal(snapshot.stations.length,30002);assert.equal(rows.length,40002);
  assert.deepEqual(cityProgramChoices(rows,seoul.id).map(station=>station.stationuuid),[mapped[9999].stationuuid]);
  assert.equal(programComponents(rows).identityCount,40002);
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
 assert.throws(()=>programComponents(new Array(50001)),/at most/);
});

test('frozen UTC calendar is independent of mutable place order and validates real date keys',()=>{
 assert.equal(TODAY_CALENDAR_V1.length,11);assert.ok(Object.isFrozen(TODAY_CALENDAR_V1));
 assert.equal(todayPlaceForUTCDate('1970-01-01').name,'Berlin');
 assert.equal(todayPlaceForUTCDate('1970-01-11').name,'Seoul');
 assert.equal(todayPlaceForUTCDate('1970-01-12').name,'Berlin');
 assert.equal(todayPlaceForUTCDate('1969-12-31').name,'Seoul');
 assert.equal(todayPlaceForUTCDate('2026-11-11').name,'Berlin');
 for(const day of ['2026-11-11','2024-02-29','2100-03-01'])assert.deepEqual(todayPlaceForUTCDate(day,[...CURATED_PLACES].reverse()),todayPlaceForUTCDate(day));
 for(const bad of ['',null,0,'2026-2-01','2026-02-30','2100-02-29','2026-11-11T00:00:00Z','0000-01-01'])assert.equal(todayPlaceForUTCDate(bad),null,String(bad));
 const id=todayPlaceForUTCDate('2026-11-11').id;
 assert.equal(todayPlaceForUTCDate('2026-11-11',CURATED_PLACES.filter(city=>city.id!==id)),null);
});

test('shared streams, family variants and case-equivalent UUIDs conservatively join transitively',()=>{
 const rows=[row(1,{stationuuid:'abcdefab-1234-4000-8000-000000000001',name:'Seoul Live'}),row(2,{name:'Seoul Live'}),row(3,{name:'Alias',url:'https://radio.example/2'}),row(4)];
 rows.push({...rows[0],stationuuid:rows[0].stationuuid.toUpperCase()});
 const before=structuredClone(rows),model=programComponents(rows);
 assert.equal(model.identityCount,4);assert.equal(model.components.length,2);
 assert.deepEqual(model.components.map(component=>component.length).sort(),[1,4]);
 assert.equal(cityProgramChoices(rows,seoul.id).length,2);assert.deepEqual(rows,before);
 assert.deepEqual(cityProgramChoices([...rows].reverse(),seoul.id),cityProgramChoices(rows,seoul.id));
});

test('city recommendations choose only corroborated variants and exclude conflicting components',()=>{
 const rows=[row(1,{name:'Seoul Live',quality:{score:30}}),row(2,{name:'Seoul Live',state:'',geo_lat:null,geo_long:null,quality:{score:100}})];
 assert.deepEqual(cityProgramChoices(rows,seoul.id).map(station=>station.stationuuid),[rows[0].stationuuid]);
 const ny=CURATED_PLACES.find(city=>city.name==='New York');
 const conflict=row(3,{countrycode:'US',state:'New York',geo_lat:ny.point[0],geo_long:ny.point[1],url:rows[0].url});
 assert.equal(cityProgramChoices([...rows,conflict],seoul.id).length,0);
 assert.equal(cityProgramChoices([row(4,{state:'Tokyo',name:'Music'})],seoul.id).length,0);
 assert.equal(cityProgramChoices(rows,'unknown').length,0);
 for(const nativeProgram of [null,{}, {id:'oversized'.repeat(30),cityId:seoul.id},{id:'component',cityId:'ne-1159151529'}])assert.equal(cityProgramChoices([row(12,{nativeProgram})],seoul.id).length,0);
 assert.equal(cityProgramChoices([row(13,{state:'',geo_lat:null,geo_long:null,nativeProgram:{id:'component',cityId:seoul.id}})],seoul.id).length,0);
});

test('recommendations use existing reliable rank and explicit health time without applying search filters',()=>{
 const rows=[row(1,{quality:{score:20}}),row(2,{quality:{score:90}}),row(3,{url:'http://radio.example/3',quality:{score:100}})];
 const originalNow=Date.now;Date.now=()=>{throw Error('implicit clock');};
 try{
  assert.equal(cityProgramChoices(rows,seoul.id)[0].stationuuid,rows[1].stationuuid);
  assert.equal(cityProgramChoices(rows,seoul.id).length,2);
  assert.equal(cityProgramChoices(rows,seoul.id,{secureOnly:false}).length,3);
  const badStations=new Map([[rows[1].stationuuid,{failures:1,lastFailureAt:'2026-11-11T00:00:00.000Z'}]]);
  assert.equal(cityProgramChoices(rows,seoul.id,{badStations,now:Date.parse('2026-11-11T00:01:00Z')})[0].stationuuid,rows[0].stationuuid);
 }finally{Date.now=originalNow;}
});

test('native city seeds preserve prefix and identities, add no more than five per city or 55 total',()=>{
 const root=CURATED_PLACES.flatMap((city,index)=>Array.from({length:7},(_,number)=>row(1000+index*10+number,{name:`${city.name} Program ${number}`,state:city.name,countrycode:city.countrycode,geo_lat:city.point[0],geo_long:city.point[1]})));
 const prefix=[row(99,{state:'',geo_lat:null,geo_long:null}),root[0]],before=structuredClone([prefix,root]);
 const enriched=appendCitySeeds(prefix,root);
 const originalFields=({nativeProgram:_evidence,...station})=>station;
 assert.deepEqual(enriched.slice(0,prefix.length).map(originalFields),prefix);assert.ok(enriched.length<=prefix.length+55);
 assert.equal(new Set(enriched.map(station=>station.stationuuid)).size,enriched.length);
 for(const city of CURATED_PLACES)assert.equal(cityProgramChoices(enriched,city.id).length,5,city.name);
 assert.deepEqual([prefix,root],before);assert.deepEqual(appendCitySeeds(enriched,root),enriched);
 assert.deepEqual(appendCitySeeds(prefix,[]),prefix);
 for(const addition of enriched.slice(prefix.length))assert.deepEqual(originalFields(addition),root.find(row=>row.stationuuid===addition.stationuuid));
});

test('aliases cannot manufacture a five-program seed cohort and unsupported cities degrade honestly',()=>{
 const roots=[row(1,{name:'Seoul Live'}),...Array.from({length:6},(_,index)=>row(index+2,{name:'Seoul Live'})),row(10)];
 const enriched=appendCitySeeds([],roots);assert.equal(enriched.length,2);assert.equal(cityProgramChoices(enriched,seoul.id).length,2);
});
