import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDirectory} from '../server/directory-normalize.mjs';
import {serializeVariantGroups,expandVariantGroups} from '../site/assets/station-variants.js';

const row=(id,extra={})=>({stationuuid:id,name:'FIP',country:'France',countrycode:'FR',url:`https://stream.radiofrance.fr/${id}`,homepage:'https://www.radiofrance.fr/fip',tags:'pop music,radio,music,80 s,pop',language:'French,fr',codec:'aac',bitrate:'128',lastcheckok:1,...extra});

test('normalization cleans metadata before publication and is independent of input order',()=>{
  const rows=[row('a'),row('b',{name:'fip'})],before=structuredClone(rows),a=normalizeDirectory(rows),b=normalizeDirectory([...rows].reverse());
  assert.deepEqual(a,b);assert.deepEqual(rows,before);
  assert.equal(a.stations[0].tags,'80s,pop');assert.equal(a.stations[0].language,'french');assert.equal(a.stations[0].codec,'AAC');assert.equal(a.stations[0].countrycode,'FR');
  assert.equal(a.stats.validRows,2);assert.equal(serializeVariantGroups(a.stations).length,1);
});

test('missing codes are inferred from directory names or unambiguous matching stream/homepage evidence',()=>{
  const data=normalizeDirectory([row('known'),row('by-name',{countrycode:''}),row('by-stream',{country:'',countrycode:'',url:'https://stream.radiofrance.fr/known'}),row('by-home',{country:'',countrycode:''}),row('unknown',{name:'Unrelated',homepage:'',country:'',countrycode:''})]);
  for(const id of ['by-name','by-stream','by-home'])assert.equal(data.stations.find(r=>r.stationuuid===id).countrycode,'FR');
  assert.equal(data.stations.find(r=>r.stationuuid==='unknown').countrycode,'');assert.equal(data.stats.countryInferred,3);
});

test('conflicting sibling countries remain unknown instead of being guessed',()=>{
  const data=normalizeDirectory([row('fr'),row('be',{country:'Belgium',countrycode:'BE'}),row('unknown',{country:'',countrycode:''})]);
  assert.equal(data.stations.find(r=>r.stationuuid==='unknown').countrycode,'');
});
test('same-name station on a country-owned provider domain has corroborated country evidence',()=>{
  const data=normalizeDirectory([row('known',{name:'FIP',homepage:'https://www.radiofrance.fr',url:'https://stream.radiofrance.fr/fip'}),row('missing',{name:'FIP',country:'',countrycode:'',homepage:'https://www.fip.fr',url:'https://icecast.radiofrance.fr/fip'}),row('generic',{name:'FIP',country:'',countrycode:'',homepage:'',url:'https://stream.zeno.fm/fip'})]);
  assert.equal(data.stations.find(row=>row.stationuuid==='missing').countrycode,'FR');
  assert.equal(data.stations.find(row=>row.stationuuid==='generic').countrycode,'');
});

test('HTTP streams are retained with explicit transport rather than silently upgraded',()=>{
  const data=normalizeDirectory([row('http',{url:'http://radio.example/live'})]);
  assert.equal(data.stations[0].url,'http://radio.example/live');assert.equal(data.stations[0].transport,'http-only');assert.equal(data.stats.httpStreams,1);
});

test('private targets, credentials and credential-like URL parameters never enter public snapshots',()=>{
  const urls=['http://127.1/live','http://2130706433/live','http://[::ffff:127.0.0.1]/live','http://10.0.0.1/live','https://localhost/live','https://radio.local/live','https://user:password@radio.example/live','https://radio.example/live?access_token=fixture-secret','https://radio.example/live?api_key=fixture-secret','javascript:alert(1)'];
  const data=normalizeDirectory([row('safe'),...urls.map((url,i)=>row('bad-'+i,{url}))]);
  assert.deepEqual(data.stations.map(r=>r.stationuuid),['safe']);assert.equal(data.stats.rejectedRows,urls.length);assert.doesNotMatch(JSON.stringify(data),/fixture-secret|user:password/);
});

test('invalid coordinate fields are discarded without turning reference locations into raw coordinates',()=>{
  const data=normalizeDirectory([row('zero',{geo_lat:0,geo_long:0}),row('ocean',{geo_lat:15,geo_long:-160}),row('valid',{geo_lat:48.85,geo_long:2.27}),row('absent')]);
  for(const id of ['zero','ocean','absent']){const station=data.stations.find(r=>r.stationuuid===id);assert.equal(station.geo_lat,undefined);assert.equal(station.geo_long,undefined);}
  assert.equal(data.stations.find(r=>r.stationuuid==='valid').geo_lat,48.85);
});

test('duplicate UUIDs select the newest checked record deterministically',()=>{
  const rows=[row('same',{url:'https://radio.example/old',lastchecktime:'2026-01-01 12:00:00'}),row('same',{url:'https://radio.example/new',lastchecktime:'2026-01-02 12:00:00'})];
  assert.equal(normalizeDirectory(rows).stations[0].url,'https://radio.example/new');assert.deepEqual(normalizeDirectory(rows),normalizeDirectory([...rows].reverse()));
});

test('exact stream aliases survive normalized grouped round-trip',()=>{
  const data=normalizeDirectory([row('a'),row('b',{url:'https://stream.radiofrance.fr/a'})]),wire=serializeVariantGroups(data.stations),flat=expandVariantGroups(wire);
  assert.equal(wire.length,1);assert.equal(wire[0].variants.length,1);assert.deepEqual(flat.map(r=>r.stationuuid).sort(),['a','b']);
});

test('record and field budgets bound hostile upstream metadata',()=>{
  for(const maxRecords of [NaN,Infinity,0,-1,75001])assert.throws(()=>normalizeDirectory([],{maxRecords}),/budget/);
  assert.throws(()=>normalizeDirectory(Array.from({length:5},(_,i)=>row('id-'+i)),{maxRecords:4}),/limit/i);
  const data=normalizeDirectory([row('a',{name:'x'.repeat(10000),tags:Array.from({length:100},(_,i)=>'genre'+i).join(','),bitrate:Infinity})]);
  assert.ok(data.stations[0].name.length<=160);assert.ok(data.stations[0].tags.split(',').length<=24);assert.equal(data.stations[0].bitrate,0);
});
test('reserved trailing-dot and dotless hosts are not publishable stream targets',()=>{
  for(const url of ['https://localhost./live','http://radio.local./live','http://intranet/live'])assert.equal(normalizeDirectory([row('bad',{url})]).stations.length,0);
});
test('provider timestamps without an explicit timezone always mean UTC',()=>{
  const value=normalizeDirectory([row('utc',{lastchecktime:'2026-11-08T12:00:00'})]).stations[0];
  assert.equal(value.lastchecktime,'2026-11-08T12:00:00.000Z');
});
