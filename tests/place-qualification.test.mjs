import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,unlink,rmdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {qualifyPlaceData,qualifyPlaceFile,MAX_PLACE_INPUT_BYTES} from '../scripts/qualify-place-data.mjs';
import {serializeVariantGroups} from '../site/assets/station-variants.js';
import {CURATED_PLACES} from '../site/assets/curated-places.js';

const station=(number,patch={})=>({stationuuid:`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`,name:`Seoul Radio ${number}`,countrycode:'KR',state:'Seoul',geo_lat:37.5683,geo_long:126.9978,url:`https://example.com/${number}`,codec:'MP3',bitrate:128,...patch});
const count=(report,name)=>report.cities.find(city=>city.name===name).programs;

test('stream variants and UUID aliases count once toward a city, not once per directory identity',()=>{
 const rows=[station(1,{name:'Seoul Radio'}),station(2,{name:'Seoul Radio',codec:'AAC',bitrate:320}),station(3,{name:'Seoul Radio',url:'https://example.com/2'})];
 const before=structuredClone(rows),report=qualifyPlaceData({schemaVersion:2,groups:serializeVariantGroups(rows)});
 assert.equal(report.inputRecords,3);assert.equal(report.directoryGroups,1);assert.equal(report.programs,1);assert.equal(report.confidenceCounts.city,1);assert.equal(count(report,'Seoul'),1);
 assert.equal(report.cities.find(city=>city.name==='Seoul').exampleStationIds.length,1);assert.deepEqual(rows,before);
});

test('shared streams join differently named directory groups transitively for conservative counting',()=>{
 const rows=[station(1,{name:'Seoul Radio'}),station(2,{name:'Seoul Radio'}),station(3,{name:'Different label',url:'https://example.com/2'}),station(4)];
 const report=qualifyPlaceData(rows);assert.equal(report.directoryGroups,3);assert.equal(report.programs,2);assert.equal(count(report,'Seoul'),2);
 assert.deepEqual(qualifyPlaceData([...rows].reverse()),report);
});

test('conflicting duplicate identities fail closed before they can manufacture a five-program minimum',()=>{
 const bridge=[station(1,{stationuuid:'one',name:'Alpha',url:'https://example.com/a'}),station(1,{stationuuid:'one',name:'Beta',url:'https://example.com/b'}),station(2,{stationuuid:'two',name:'Beta',url:'https://example.com/c'})];
 const threshold=[...bridge,station(3,{name:'Gamma'}),station(4,{name:'Delta'}),station(5,{name:'Epsilon'})];
 for(const rows of [bridge,[...bridge].reverse(),threshold,[...threshold].reverse()])assert.throws(()=>qualifyPlaceData(rows),/duplicate.*identity|single.generation/i);
});

test('identical repeated UUID observations, including case variants, still count once without rewriting inputs',()=>{
 const row=station(1,{stationuuid:'abcdefab-1234-4000-8000-000000000001'}),rows=[row,{...row,stationuuid:row.stationuuid.toUpperCase()}],before=structuredClone(rows),report=qualifyPlaceData(rows);
 assert.equal(report.programs,1);assert.equal(report.duplicateIdentityRows,1);assert.equal(count(report,'Seoul'),1);assert.deepEqual(rows,before);
});

test('conflicting supported cities or countries exclude a shared-stream component from city totals',()=>{
 const row=station(1),newYork=station(2,{name:'New York Radio',countrycode:'US',state:'New York',geo_lat:40.72156,geo_long:-73.99572,url:row.url});
 const report=qualifyPlaceData([row,newYork]);assert.equal(report.programs,1);assert.equal(report.confidenceCounts.ambiguous,1);assert.equal(count(report,'Seoul'),0);assert.equal(count(report,'New York'),0);
 const countryConflict=qualifyPlaceData([row,{...newYork,geo_lat:null,geo_long:null}]);assert.equal(countryConflict.confidenceCounts.ambiguous,1);
});

test('five means five program components and raw coordinate confidence is distinct from city evidence',()=>{
 const rows=Array.from({length:5},(_,index)=>station(index+1));
 const report=qualifyPlaceData(rows),seoul=report.cities.find(city=>city.name==='Seoul');assert.equal(seoul.programs,5);assert.equal(seoul.meetsFiveProgramMinimum,true);assert.equal(seoul.exampleStationIds.length,5);
 const mixed=qualifyPlaceData([station(1),station(2,{name:'Music',state:''}),station(3,{geo_lat:null,geo_long:null}),station(4,{countrycode:'',geo_lat:null,geo_long:null})]);
 assert.deepEqual(mixed.confidenceCounts,{city:1,exact:1,country:1,unknown:1,ambiguous:0});
});

test('supplied generation metadata is validated and labeled separately from source verification',()=>{
 const metadata={generatedAt:'2026-11-11T10:22:04.482Z',producerSourceSha:'a'.repeat(40)},snapshot={schemaVersion:2,groups:serializeVariantGroups([station(1)]),...metadata};
 assert.deepEqual(qualifyPlaceData(snapshot).suppliedMetadata,metadata);
 assert.equal(qualifyPlaceData([station(1)]).suppliedMetadata,null);
 for(const patch of [{generatedAt:'tomorrow'},{producerSourceSha:'wrong'},{generatedAt:'2026-02-30T00:00:00.000Z'},{producerSourceSha:undefined}])assert.throws(()=>qualifyPlaceData({...snapshot,...patch}),/metadata|generation|source/i);
});

test('malformed, empty and oversized inputs fail rather than reporting fabricated coverage',()=>{
 for(const value of [null,{},[],{schemaVersion:2,groups:[]},[{}],[station(1,{url:'javascript:alert(1)'})],[station(1,{url:'https://user:password@example.com/'})]])assert.throws(()=>qualifyPlaceData(value),/snapshot|station|empty|stream/i);
 assert.throws(()=>qualifyPlaceData(Array(10001).fill(station(1))),/limit|budget/i);
 assert.throws(()=>qualifyPlaceData([station(1,{name:'x'.repeat(MAX_PLACE_INPUT_BYTES+1)})]),/byte|budget/i);
});

test('qualification performs no default network operation',()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error('Unexpected network call');};
 try{assert.equal(qualifyPlaceData([station(1)]).programs,1);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});

test('file qualification bounds actual bytes, reports a digest and leaves source bytes unchanged',async t=>{
 const parent=path.resolve('.build');await mkdir(parent,{recursive:true});const directory=await mkdtemp(path.join(parent,'place-qualification-')),file=path.join(directory,'snapshot.json');
 t.after(async()=>{await unlink(file);await rmdir(directory);});
 const source=JSON.stringify([station(1)]);await writeFile(file,source);
 const report=await qualifyPlaceFile(file);assert.equal(report.input.bytes,Buffer.byteLength(source));assert.equal(report.input.sha256,createHash('sha256').update(source).digest('hex'));assert.equal(report.programs,1);assert.equal(await readFile(file,'utf8'),source);
 await writeFile(file,Buffer.alloc(MAX_PLACE_INPUT_BYTES+1,32));await assert.rejects(qualifyPlaceFile(file),/byte|budget|16/i);
 await writeFile(file,'invalid JSON');await assert.rejects(qualifyPlaceFile(file),/JSON|snapshot/i);
});

test('frozen coverage receipt binds the current model bytes and accounts for every program component',async()=>{
 const root=new URL('../',import.meta.url),report=JSON.parse(await readFile(new URL('docs/provenance/place-coverage.json',root),'utf8'));
 assert.equal(report.programs,Object.values(report.confidenceCounts).reduce((sum,count)=>sum+count,0));
 assert.equal(report.confidenceCounts.city,report.cities.reduce((sum,city)=>sum+city.programs,0));
 assert.deepEqual(report.cities.map(city=>city.id),CURATED_PLACES.map(city=>city.id));
 assert.equal(report.allCuratedCitiesMeetFiveProgramMinimum,true);
 for(const city of report.cities){assert.ok(city.programs>=5);assert.equal(city.exampleStationIds.length,5);assert.equal(new Set(city.exampleStationIds).size,5);}
 assert.equal(report.model.candidateRadiusKm,25);assert.equal(report.model.files.length,10);
 for(const file of report.model.files){const bytes=await readFile(new URL(file.path,root));assert.equal(bytes.length,file.bytes,file.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);}
 assert.match(report.suppliedMetadata.producerSourceSha,/^[a-f0-9]{40}$/);assert.match(report.input.sha256,/^[a-f0-9]{64}$/);assert.match(report.sourceAcquisition.raw.sha256,/^[a-f0-9]{64}$/);
});
