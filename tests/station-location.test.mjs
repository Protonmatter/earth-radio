import test from 'node:test';
import assert from 'node:assert/strict';
import {stationLocation} from '../site/assets/station-location.js';
test('country fallback is explicit, deterministic and never changes directory records',()=>{
  const station={countrycode:'KR',geo_lat:null,geo_long:null};const before=structuredClone(station),location=stationLocation(station);
  assert.equal(location.approximate,true);assert.ok(location.point[0]>33&&location.point[0]<39);assert.deepEqual(station,before);
  assert.deepEqual(stationLocation(station),location);assert.equal(stationLocation({countrycode:'XX'}),null);
});
test('plausibility rejects Null Island, Antarctica and distant ocean points for a known country',()=>{
  for(const point of [[0,0],[-77,0],[15,-160]])assert.equal(stationLocation({countrycode:'DE',geo_lat:point[0],geo_long:point[1]}).approximate,true);
  assert.deepEqual(stationLocation({countrycode:'GB',geo_lat:51.5074,geo_long:-0.1278}),{point:[51.5074,-0.1278],approximate:false});
  assert.deepEqual(stationLocation({countrycode:'FR',geo_lat:48.8566,geo_long:2.3522}),{point:[48.8566,2.3522],approximate:false});
  const france=stationLocation({countrycode:'FR'});assert.ok(france.point[0]>40&&france.point[0]<52,'an overseas territory must not replace the main country reference point');
  assert.deepEqual(stationLocation({geo_lat:0,geo_long:12}),{point:[0,12],approximate:false});
});

test('country fallback never creates a point outside the supported atlas latitude range',()=>{
  for(const station of [{countrycode:'AQ'},{countrycode:'AQ',geo_lat:-77,geo_long:35},{geo_lat:-80,geo_long:10}]){
    const before=structuredClone(station);assert.equal(stationLocation(station),null);assert.deepEqual(station,before);
  }
});
