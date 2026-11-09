import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildDirectoryGeneration} from '../scripts/build-directory-snapshot.mjs';
import {validateSnapshotManifest,snapshotDescriptor,snapshotRepresentation,SNAPSHOT_ACCEPT} from '../site/assets/snapshot-protocol.js';

const row=(id,extra={})=>({stationuuid:id,name:'BBC Radio 4',country:'United Kingdom',countrycode:'GB',url:`https://radio.example/${id}`,tags:'radio,pop music',lastcheckok:1,...extra});
const options={generatedAt:'2026-11-08T20:17:00.000Z',producerSourceSha:'a'.repeat(40),minimumRecords:1,minimumCountries:1,globalLimit:10000,countryLimit:1000};

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
