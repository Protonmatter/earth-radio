import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildStationRecordIndex} from '../scripts/build-station-record-index.mjs';
import {validateStationRecordManifest,validateStationRecordShard,STATION_RECORD_FIELDS} from '../server/station-record-protocol.mjs';
import {buildDirectoryGeneration} from '../scripts/build-directory-snapshot.mjs';
import {normalizeDirectory} from '../server/directory-normalize.mjs';

const identity={generatedAt:'2026-11-12T13:22:34.584Z',producerSourceSha:'a'.repeat(40),producerVersion:'0.36.0'};
const row=(stationuuid,extra={})=>({stationuuid,name:'A public station',url:`https://radio.example/${stationuuid}`,country:'United Kingdom',countrycode:'GB',lastcheckok:1,...extra});
const bucket=id=>createHash('sha256').update(id).digest()[0];
function record(result,id){const descriptor=result.manifest.shards[bucket(id)];return JSON.parse(result.files.get(descriptor.path)).stations.find(value=>value.stationuuid===id);}

test('station records include every normalized identity independently of the boot and country cutoffs',()=>{
  const rows=[row('first',{clickcount:50}),row('sibling',{url:'https://radio.example/first',clickcount:40}),row('long-tail',{clickcount:1})];
  const result=buildDirectoryGeneration(rows,{...identity,globalLimit:1,countryLimit:1,minimumRecords:1,minimumCountries:1,minimumCityPrograms:0});
  assert.equal(result.manifest.totals.identities,1);
  assert.equal(result.stationManifest.identities,3);
  for(const input of rows)assert.equal(record({manifest:result.stationManifest,files:result.files},input.stationuuid).stationuuid,input.stationuuid);
});

test('index is deterministic, explicitly public, content addressed and bound to the same generation',()=>{
  const a=buildStationRecordIndex([row('alias'),row('primary',{privateField:'not public',password:'not public'})],identity);
  const b=buildStationRecordIndex([row('primary'),row('alias')],{...identity,generatedAt:'2026-11-12T14:22:34.584Z'});
  assert.equal(a.manifest.shards.length,256);assert.equal(a.manifest.identities,2);
  assert.deepEqual(a.manifest.shards,b.manifest.shards);
  assert.equal(a.manifest.producerSourceSha,identity.producerSourceSha);assert.equal(a.manifest.producerVersion,identity.producerVersion);
  assert.notEqual(a.manifest.generatedAt,b.manifest.generatedAt);
  assert.deepEqual(record(a,'primary'),row('primary'));assert.ok(STATION_RECORD_FIELDS.includes('url'));
  assert.ok(a.files.size<=3,'empty buckets share one payload');
  for(const descriptor of a.manifest.shards){
    const bytes=a.files.get(descriptor.path);assert.equal(bytes.length,descriptor.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),descriptor.sha256);
    assert.equal(descriptor.path,`station-records/${descriptor.sha256}.json`);
    assert.equal(bytes.at(-1),10);
    assert.equal(validateStationRecordShard(JSON.parse(bytes),descriptor).stations.length,descriptor.records);
  }
});

test('manifest rejects traversal, extra fields, excessive bytes/counts and inconsistent totals',()=>{
  const {manifest}=buildStationRecordIndex([row('valid')],identity);
  assert.equal(validateStationRecordManifest(manifest,{now:Date.parse(identity.generatedAt)}),manifest);
  for(const alter of [m=>m.shards.pop(),m=>{m.shards[0].path='../outside.json';},m=>{m.shards[0].bytes=262145;},m=>{m.shards[0].records=1025;},m=>{m.identities++;},m=>{m.producerSourceSha='bad';},m=>{m.generatedAt='2099-01-01T00:00:00.000Z';},m=>{m.extra=true;},m=>{m.shards[0].extra=true;}]){
    const changed=structuredClone(manifest);alter(changed);assert.throws(()=>validateStationRecordManifest(changed,{now:Date.parse(identity.generatedAt)}));
  }
});

test('one immutable path cannot claim two different lengths or record counts',()=>{
  const {manifest}=buildStationRecordIndex([row('valid')],identity),empty=manifest.shards.findIndex(item=>!item.records);
  const changed=structuredClone(manifest);changed.shards[empty].bytes++;
  assert.throws(()=>validateStationRecordManifest(changed,{now:Date.parse(identity.generatedAt)}),/inconsistent|descriptor/i);
});

test('record payload rejects duplicate identities, unexpected fields, invalid URLs and mismatched counts',()=>{
  const {manifest,files}=buildStationRecordIndex([row('valid')],identity),descriptor=manifest.shards[bucket('valid')];
  const original=JSON.parse(files.get(descriptor.path));
  for(const alter of [p=>{p.stations=[];},p=>{p.stations.push(p.stations[0]);},p=>{p.extra=true;},p=>{p.stations[0].privateField='bad';},p=>{p.stations[0].url='javascript:bad';},p=>{p.stations[0].stationuuid='__proto__';}]){
    const changed=structuredClone(original);alter(changed);assert.throws(()=>validateStationRecordShard(changed,descriptor));
  }
});

test('index rejects duplicate/excessive input and a large shard rather than weakening publication budgets',()=>{
  assert.throws(()=>buildStationRecordIndex([row('dup'),row('dup')],identity),/duplicate/i);
  assert.throws(()=>buildStationRecordIndex(Array(75001).fill(row('too-many')),identity),/record/i);
  assert.throws(()=>buildStationRecordIndex([row('large',{name:'X'.repeat(262144)})],identity),/byte|size|record/i);
});

test('adversarial bucket concentration fails the per-shard record budget',()=>{
  const rows=[];for(let i=0;rows.length<1025;i++){const id='collision-'+i;if(bucket(id)===0)rows.push(row(id));}
  assert.throws(()=>buildStationRecordIndex(rows,identity),/record.*limit|count/i);
});

test('percent-encoded Unicode URL outputs retain the existing normalizer contract',()=>{
  const url='https://radio.example/'+'界'.repeat(500),resolved='https://resolved.example/'+'音'.repeat(500);
  const source=row('unicode',{url,url_resolved:resolved,homepage:url, favicon:url});
  const normalized=normalizeDirectory([source]).stations[0];
  for(const field of ['url','url_resolved','homepage','favicon'])assert.ok(normalized[field].length>4096,field);
  const result=buildDirectoryGeneration([source],{...identity,minimumRecords:1,minimumCountries:1,minimumCityPrograms:0});
  assert.deepEqual(record({manifest:result.stationManifest,files:result.files},'unicode'),normalized);
});

test('the maximum accepted raw Unicode URL survives encoding, while unbounded outputs remain rejected',()=>{
  const prefix='https://radio.example/',url=prefix+'界'.repeat(4096-prefix.length);
  const normalized=normalizeDirectory([row('max-unicode',{homepage:url})]).stations[0];
  assert.ok(normalized.homepage.length>36000);
  const result=buildStationRecordIndex([normalized],identity);assert.equal(record(result,'max-unicode').homepage,normalized.homepage);
  assert.throws(()=>buildStationRecordIndex([row('too-long',{homepage:'https://radio.example/'+'%E7%95%8C'.repeat(5000)})],identity),/text field|URL|byte/i);
  assert.throws(()=>buildStationRecordIndex([row('non-url-text',{name:'X'.repeat(4097)})],identity),/text field/i);
});

test('retained-data proof binds the current producer bytes and preserves every existing view',async()=>{
  const receipt=JSON.parse(await readFile('docs/provenance/station-record-index-replay.json','utf8'));
  assert.equal(receipt.acceptedSource,'80e3ee014bae96dbb13b318cb1c82fb147d3af3d');
  assert.equal(receipt.input.normalizedRows,52630);assert.equal(receipt.index.identities,receipt.input.normalizedRows);
  assert.equal(receipt.comparison.existingManifestIdentical,true);assert.equal(receipt.comparison.existingPayloadsIdentical,451);
  assert.equal(receipt.comparison.allIdentitiesExactlyOnce,true);assert.equal(receipt.comparison.shardsStableWithReversedInputAndNewTimestamp,true);
  assert.ok(receipt.index.maxShardBytes<=256*1024);assert.ok(receipt.index.maxShardRecords<=1024);assert.ok(receipt.stage.bytes<128*1024*1024);
  assert.equal(receipt.cityCoverage.length,11);assert.ok(receipt.cityCoverage.every(city=>city.selectedPrograms>=5));
  assert.equal(receipt.algorithms.length,5);
  assert.ok(receipt.algorithms.some(item=>item.path==='site/assets/station-record-protocol.js'));
  assert.equal(receipt.sharedProtocolRequalification.all707PayloadsIdentical,true);
  for(const item of receipt.algorithms){const bytes=await readFile(item.path);assert.equal(bytes.length,item.bytes,item.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.path);}
});
