import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStationVariants,chooseGroupStation,projectVariantResults,expandFavoriteIds,serializeVariantGroups,expandVariantGroups} from '../site/assets/station-variants.js';

const station=(id,extra={})=>({stationuuid:id,name:'BBC Radio 4',country:'United Kingdom',countrycode:'GB',state:'',url:`https://radio.example/${id}`,codec:'AAC',bitrate:128,lastcheckok:1,...extra});

test('case variants group once, identical URLs collapse, and every original UUID remains addressable',()=>{
  const rows=[station('a'),station('b',{name:'bbc radio 4',url:'https://radio.example/a'}),station('c',{codec:'MP3',bitrate:320})];
  const before=structuredClone(rows),groups=groupStationVariants(rows);
  assert.equal(groups.length,1);assert.equal(groups[0].variants.length,2);assert.deepEqual(groups[0].memberIds,['a','b','c']);
  assert.equal(groups[0].name,'BBC Radio 4');assert.deepEqual(rows,before);
  assert.deepEqual(groupStationVariants([...rows].reverse()),groups);
});

test('different countries, programs and conflicting regional services remain distinct',()=>{
  const rows=[station('gb'),station('ca',{countrycode:'CA'}),station('extra',{name:'BBC Radio 4 Extra'}),station('berlin',{name:'City Radio',state:'Berlin',countrycode:'DE'}),station('hamburg',{name:'City Radio',state:'Hamburg',countrycode:'DE'}),station('unknown',{name:'City Radio',state:'',countrycode:'DE'})];
  assert.equal(groupStationVariants(rows).length,6);
});
test('conflicting cities within the same state retain separate metadata and UUIDs',()=>{
  const rows=[station('albany',{name:'City Radio',countrycode:'US',state:'New York',city:'Albany'}),station('nyc',{name:'City Radio',countrycode:'US',state:'New York',city:'New York City'})];
  const groups=serializeVariantGroups(rows);assert.equal(groups.length,2);
  const flat=expandVariantGroups(groups);assert.equal(flat.find(row=>row.stationuuid==='nyc').city,'New York City');
  assert.equal(flat.find(row=>row.stationuuid==='albany').city,'Albany');
});

test('a technical zstream alias joins a matching family only with the same exact stream',()=>{
  const groups=groupStationVariants([station('base',{name:'KBS Classic FM',countrycode:'KR'}),station('proxy',{name:'KBS Classic FM zstream',countrycode:'KR',url:'https://radio.example/base'}),station('unrelated',{name:'KBS Classic FM zstream',countrycode:'KR',url:'https://other.example/live'})]);
  assert.equal(groups.length,2);assert.ok(groups.some(group=>group.name==='KBS Classic FM'&&group.memberIds.includes('proxy')));
});

test('quality suffixes collapse but FM/program names are preserved',()=>{
  const groups=groupStationVariants([station('a',{name:'Jazz (128 kbps)'}),station('b',{name:'Jazz | FLAC',codec:'FLAC'}),station('c',{name:'Jazz FM'}),station('d',{name:'Jazz Classics'})]);
  assert.equal(groups.length,3);assert.ok(groups.some(group=>group.name==='Jazz'&&group.memberIds.length===2));
});

test('selection honors explicit choice, current alias and saved identity before default quality',()=>{
  const group=groupStationVariants([station('a'),station('b',{url:'https://radio.example/a'}),station('c',{codec:'FLAC',bitrate:960})])[0];
  assert.equal(chooseGroupStation(group).stationuuid,'c');
  assert.equal(chooseGroupStation(group,{selectedId:'a',currentId:'c'}).stationuuid,'a');
  assert.equal(chooseGroupStation(group,{currentId:'b'}).stationuuid,'b');
  assert.equal(chooseGroupStation(group,{favoriteIds:new Set(['b'])}).stationuuid,'b');
});

test('secure preference chooses HTTPS while retaining HTTP choices',()=>{
  const group=groupStationVariants([station('a',{url:'http://radio.example/flac',codec:'FLAC',bitrate:960}),station('b')])[0];
  assert.equal(chooseGroupStation(group,{securePreferred:true}).stationuuid,'b');
  assert.equal(chooseGroupStation(group,{securePreferred:false}).stationuuid,'a');
  assert.equal(group.variants.length,2);
});

test('ranked projection groups after matching and keeps the highest-ranked group position',()=>{
  const rows=[station('a'),station('b'),station('other',{name:'Another Station'})],groups=groupStationVariants(rows);
  const result=projectVariantResults([{station:rows[1],score:9,reasons:['name']},{station:rows[0],score:8,reasons:[]},{station:rows[2],score:7,reasons:[]}],groups,{selectedId:'a'});
  assert.equal(result.length,2);assert.equal(result[0].station.stationuuid,'a');assert.equal(result[0].score,9);assert.equal(result[0].variants.length,2);
});

test('a matching URL alias cannot be replaced by a nonmatching UUID in projection',()=>{
  const rows=[station('a'),station('b',{url:'https://radio.example/a'})];
  const result=projectVariantResults([{station:rows[1],score:1,reasons:[]}],groupStationVariants(rows));
  assert.equal(result[0].station.stationuuid,'b');
});

test('favorite expansion changes only the view set and preserves unknown saved IDs',()=>{
  const rows=[station('a'),station('b')],groups=groupStationVariants(rows),saved=new Set(['b','retired']);
  assert.deepEqual([...expandFavoriteIds(groups,saved)].sort(),['a','b','retired']);assert.deepEqual([...saved],['b','retired']);
});

test('wire grouping round-trip retains all UUIDs and stream identities without repeated shared metadata',()=>{
  const rows=[station('a'),station('b',{url:'https://radio.example/a'}),station('c',{codec:'FLAC',bitrate:960})];
  const wire=serializeVariantGroups(rows),expanded=expandVariantGroups(wire);
  assert.equal(wire.length,1);assert.equal(wire[0].variants.length,2);assert.deepEqual(expanded.map(row=>row.stationuuid).sort(),['a','b','c']);
  for(const row of rows)assert.equal(expanded.find(item=>item.stationuuid===row.stationuuid).url,row.url);
  assert.equal(wire[0].variants[0].country,undefined);assert.equal(wire[0].variants[0].name,undefined);
});
test('shared wire tags and languages retain the union of matching program metadata',()=>{
  const wire=serializeVariantGroups([station('a',{tags:'jazz,news',language:'english'}),station('b',{tags:'classical,jazz',language:'french'})]);
  assert.equal(wire[0].tags,'classical,jazz,news');assert.equal(wire[0].language,'english,french');
});

test('malformed grouped data fails closed instead of overwriting unrelated IDs',()=>{
  for(const groups of [null,[{key:'x',name:'x',variants:[]}],[{key:'x',name:'x',variants:[{stationuuid:'a',url:'javascript:alert(1)'}]}],[{key:'x',name:'x',variants:[{stationuuid:'a',url:'https://radio.example/a',aliases:[' a ']}]}]])assert.throws(()=>expandVariantGroups(groups));
});
