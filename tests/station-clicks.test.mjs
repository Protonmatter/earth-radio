import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationClickReporter,isRadioBrowserUuid} from '../site/assets/station-clicks.js';
const uuid='fbbccfc2-a610-44ec-bd43-7a356a247b54';

test('only complete directory UUIDs are eligible for reporting',()=>{
  assert.equal(isRadioBrowserUuid(uuid),true);assert.equal(isRadioBrowserUuid(uuid.toUpperCase()),true);
  for(const value of [null,1,'','earth-radio:listen.moe:jpop',uuid+'!',uuid+' ',uuid.slice(0,-1),'/'+uuid,uuid.replaceAll('-',''),uuid.replace('a610','a6zz')])assert.equal(isRadioBrowserUuid(value),false,String(value));
});
test('a session reserves the canonical UUID before asynchronous sending',async()=>{
  const calls=[];let release;
  const reporter=createStationClickReporter(station=>{calls.push(station.stationuuid);return new Promise(done=>{release=done;});});
  const first=reporter({stationuuid:uuid});await reporter({stationuuid:uuid.toUpperCase()});assert.deepEqual(calls,[uuid]);
  release({ok:true});assert.deepEqual(await first,{ok:true});assert.equal(await reporter({stationuuid:uuid}),null);assert.equal(calls.length,1);
});
test('invalid identities and a failed counter cannot delay or break subsequent playback',async()=>{
  let calls=0;const reporter=createStationClickReporter(async()=>{calls++;throw Error('network failure');});
  await reporter({stationuuid:'earth-radio:direct'});await reporter(null);assert.equal(calls,0);
  assert.equal(await reporter({stationuuid:uuid}),null);await reporter({stationuuid:uuid});assert.equal(calls,1);
  await reporter({stationuuid:'00000000-0000-4000-8000-000000000202'});assert.equal(calls,2);
  const nextSession=createStationClickReporter(()=>++calls);await nextSession({stationuuid:uuid});assert.equal(calls,3);
});
