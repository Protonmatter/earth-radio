import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildDirectoryGeneration} from '../scripts/build-directory-snapshot.mjs';
import {validateSnapshotManifest,snapshotDescriptor,snapshotRepresentation,SNAPSHOT_ACCEPT} from '../site/assets/snapshot-protocol.js';
import {CURATED_PLACES} from '../site/assets/curated-places.js';
import {cityProgramChoices} from '../site/assets/today-core.js';
import {normalizeDirectory} from '../server/directory-normalize.mjs';
import {snapshotRows} from '../site/assets/directory-client.js';

const row=(id,extra={})=>({stationuuid:id,name:'BBC Radio 4',country:'United Kingdom',countrycode:'GB',url:`https://radio.example/${id}`,tags:'radio,pop music',lastcheckok:1,...extra});
const options={generatedAt:'2026-11-08T20:17:00.000Z',producerSourceSha:'a'.repeat(40),minimumRecords:1,minimumCountries:1,globalLimit:10000,countryLimit:1000,minimumCityPrograms:0};

test('published generation has normalized grouped/legacy views with exact content hashes',()=>{
  const result=buildDirectoryGeneration([row('a'),row('b',{name:'bbc radio 4'}),row('c',{countrycode:'FR',country:'France',name:'FIP'})],options);
  const manifest=validateSnapshotManifest(result.manifest,{now:Date.parse(options.generatedAt)});
  assert.equal(manifest.schemaVersion,2);assert.equal(manifest.totals.identities,3);assert.equal(manifest.totals.stations,2);
  for(const descriptor of [manifest.files.catalog,manifest.files.legacy,manifest.files.countries,...Object.values(manifest.byCountry).flatMap(pair=>[pair.catalog,pair.legacy])]){
    const bytes=result.files.get(descriptor.path);assert.equal(bytes.length,descriptor.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),descriptor.sha256);
    assert.equal(descriptor.path,`snapshots/${descriptor.sha256}.json`);
  }
  const catalog=JSON.parse(result.files.get(manifest.files.catalog.path));assert.equal(catalog.groups.length,2);
  const legacy=JSON.parse(result.files.get(manifest.files.legacy.path));assert.deepEqual(legacy.map(r=>r.stationuuid).sort(),['a','b','c']);assert.ok(legacy.every(r=>r.tags==='pop'));
});

test('content ETags remain stable across request clocks and unchanged scheduled generations',()=>{
  const a=buildDirectoryGeneration([row('a'),row('b')],options),b=buildDirectoryGeneration([row('b'),row('a')],{...options,generatedAt:'2026-11-08T21:17:00.000Z'});
  assert.equal(a.manifest.files.catalog.sha256,b.manifest.files.catalog.sha256);assert.equal(a.manifest.files.legacy.sha256,b.manifest.files.legacy.sha256);assert.notEqual(a.manifest.generatedAt,b.manifest.generatedAt);
});

test('legacy clients keep their existing root/country shapes while v2 explicitly requests groups',()=>{
  assert.equal(snapshotRepresentation(new Headers({Accept:'application/json'}),'/directory/snapshot'),'legacy');
  assert.equal(snapshotRepresentation(new Headers(),'/directory/snapshot'),'catalog');
  assert.equal(snapshotRepresentation(new Headers(),'/directory/country/GB'),'legacy');
  assert.equal(snapshotRepresentation(new Headers({Accept:SNAPSHOT_ACCEPT}),'/directory/country/GB'),'catalog');
});

test('finite country routes use prepublished normalized files or stable empty data',()=>{
  const {manifest}=buildDirectoryGeneration([row('a')],options);
  assert.deepEqual(snapshotDescriptor(manifest,'/directory/snapshot','catalog'),manifest.files.catalog);
  assert.deepEqual(snapshotDescriptor(manifest,'/directory/country/GB','legacy'),manifest.byCountry.GB.legacy);
  assert.deepEqual(snapshotDescriptor(manifest,'/directory/country/NZ','catalog'),manifest.files.emptyCatalog);
  for(const path of ['/directory/country/gb','/directory/country/AAA','/directory/https://evil.example'])assert.equal(snapshotDescriptor(manifest,path,'catalog'),null);
});

test('invalid metadata cannot introduce arbitrary URLs, paths or oversized snapshots',()=>{
  const {manifest}=buildDirectoryGeneration([row('a')],options);
  for(const patch of [m=>{m.files.catalog.path='https://evil.example/payload';},m=>{m.files.catalog.path='snapshots/../payload.json';},m=>{m.files.catalog.bytes=17*1024*1024;},m=>{m.generatedAt='2099-01-01T00:00:00.000Z';},m=>{m.byCountry.xx=m.byCountry.GB;},m=>{m.schemaVersion=3;}]){
    const altered=structuredClone(manifest);patch(altered);assert.throws(()=>validateSnapshotManifest(altered,{now:Date.parse(options.generatedAt)}));
  }
});

test('a severely truncated or empty producer response cannot replace last-good publication',()=>{
  assert.throws(()=>buildDirectoryGeneration([],options),/minimum|empty/i);
  assert.throws(()=>buildDirectoryGeneration([row('a')],{...options,minimumRecords:1000}),/minimum/i);
});

function placeFixture(){
  const dublin=CURATED_PLACES.find(city=>city.name==='Dublin');
  const make=(city,i,offset,clickcount)=>row(`00000000-0000-4000-8000-${String(offset+i).padStart(12,'0')}`,{
    name:`${city.name} Programme ${i+1}`,country:city.countrycode,countrycode:city.countrycode,state:city.name,
    geo_lat:city.point[0],geo_long:city.point[1],clickcount,codec:'MP3',bitrate:128
  });
  const rest=CURATED_PLACES.filter(city=>city!==dublin).flatMap((city,c)=>Array.from({length:5},(_,i)=>make(city,i,c*10,100000-i)));
  const ireland=Array.from({length:5},(_,i)=>make(dublin,i,500,i<3?50000-i:1));
  const filler=Array.from({length:7},(_,i)=>row('filler-'+i,{name:'Filler '+i,country:'New Zealand',countrycode:'NZ',state:'Wellington',geo_lat:-41.2865,geo_long:174.7762,clickcount:1000-i}));
  return{dublin,rows:[...rest,...ireland,...filler]};
}
const programs=(rows,city)=>cityProgramChoices(rows,city.id,{secureOnly:false}).length;

test('curated place programs survive the production global cutoff',()=>{
  const{dublin,rows}=placeFixture();assert.equal(programs(normalizeDirectory(rows).stations.slice(0,60),dublin),3);
  const result=buildDirectoryGeneration(rows,{...options,globalLimit:60,minimumCityPrograms:5});
  const root=JSON.parse(result.files.get(result.manifest.files.legacy.path));
  assert.equal(root.length,60);for(const city of CURATED_PLACES)assert.ok(programs(root,city)>=5,city.name);
  const web=snapshotRows(JSON.parse(result.files.get(result.manifest.files.catalog.path)));
  assert.equal(web.length,60);for(const city of CURATED_PLACES)assert.ok(programs(web,city)>=5,city.name+' grouped');
  assert.equal(result.report.placeSelection.addedForPlaces,2);
  assert.ok(result.report.placeSelection.coverage.every(row=>row.selectedPrograms>=5));
});

test('production city policy fails closed by default when witnesses are unavailable',()=>{
  const strict={...options};delete strict.minimumCityPrograms;
  assert.throws(()=>buildDirectoryGeneration([row('unlocated')],strict),/qualified programs|minimum 5/);
});

test('place selection preserves country views and stable hashes across input ordering',()=>{
  const{rows}=placeFixture(),opts={...options,globalLimit:60};
  const a=buildDirectoryGeneration(rows,{...opts,minimumCityPrograms:5}),b=buildDirectoryGeneration([...rows].reverse(),{...opts,minimumCityPrograms:5,generatedAt:'2026-11-08T21:17:00.000Z'});
  const previous=buildDirectoryGeneration(rows,{...opts,minimumCityPrograms:0});
  for(const key of ['catalog','legacy'])assert.equal(a.manifest.files[key].sha256,b.manifest.files[key].sha256);
  assert.deepEqual(a.manifest.byCountry,previous.manifest.byCountry);assert.deepEqual(a.manifest.files.countries,previous.manifest.files.countries);
});

test('grouped representation cannot publish a lost city witness as a satisfied minimum',()=>{
  const{rows,dublin}=placeFixture(),witness=rows.find(row=>row.name==='Dublin Programme 5');
  const alias={...witness,stationuuid:'00000000-0000-4000-8000-000000000999',geo_lat:null,geo_long:null,clickcount:1000000};
  const input=[...rows,alias],plain=buildDirectoryGeneration(input,{...options,minimumCityPrograms:0});
  const legacy=JSON.parse(plain.files.get(plain.manifest.files.legacy.path)),web=snapshotRows(JSON.parse(plain.files.get(plain.manifest.files.catalog.path)));
  assert.equal(programs(legacy,dublin),5);assert.equal(programs(web,dublin),4);
  assert.throws(()=>buildDirectoryGeneration(input,{...options,minimumCityPrograms:5}),/grouped.*Dublin|Dublin.*grouped/i);
});
