import test from 'node:test';import assert from 'node:assert/strict';
import {publishedStationRows} from '../server/desktop-proxy.mjs';
import {serializeVariantGroups} from '../site/assets/station-variants.js';
const station=(id,name,clickcount,countrycode='FR')=>({stationuuid:id,name,clickcount,countrycode,url:'https://radio.example/'+id,lastcheckok:1});
const popular=station('popular','ZZZ Popular',10000),low=Array.from({length:25},(_,index)=>station('low-'+index,'AAA Station '+index,1));
const response=rows=>Response.json({schemaVersion:2,groups:serializeVariantGroups(rows)},{headers:{'x-directory-generated-at':'2026-11-09T00:00:00.000Z','x-directory-producer-sha':'a'.repeat(40)}});
test('native root and country record limits retain popular late-alphabet stations',async()=>{
  const deadlines=[];
  const result=await publishedStationRows(async(_path,_representation,options)=>{deadlines.push(options.deadlineAt);return response([...low,popular]);},{limit:1,countryCodes:['FR'],countryLimit:25});
  assert.equal(result.stations[0].stationuuid,'popular');assert.equal(result.stations[1].stationuuid,'popular');assert.equal(result.stations.length,26);
  assert.equal(result.directorySnapshot.producerSourceSha,'a'.repeat(40));assert.equal(new Set(deadlines).size,1);
});
test('native partial country outage preserves root and discloses missing coverage',async()=>{
  const result=await publishedStationRows(async path=>{if(path.includes('/country/'))throw Error('country unavailable');return response([popular]);},{limit:1,countryCodes:['FR','JP'],countryLimit:25});
  assert.equal(result.stations.length,1);assert.deepEqual(result.missingCountries.sort(),['FR','JP']);
});
test('native publication limits reject invalid caller input before IO',async()=>{
  await assert.rejects(publishedStationRows(()=>{throw Error('must not read');},{limit:Infinity,countryCodes:[],countryLimit:25}),/limits/);
});
