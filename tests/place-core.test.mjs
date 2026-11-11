import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {stationPlace,formatPlaceTime,CITY_EVIDENCE_RADIUS_KM} from '../site/assets/place-core.js';
import {CURATED_PLACES} from '../site/assets/curated-places.js';

const seoul={stationuuid:'fixture-seoul',name:'CBS JOY4U',countrycode:'KR',state:'Seoul',geo_lat:37.5683,geo_long:126.9978};
const city=(id,name,countrycode,point,timeZone)=>({id:`ne-${id}`,naturalEarthId:id,name,countrycode,point,timeZone,aliases:[name]});

test('city requires corroborated real coordinates and keeps the original directory point and input unchanged',()=>{
 const input=structuredClone(seoul),before=structuredClone(input),place=stationPlace(input);
 assert.equal(place.confidence,'city');assert.equal(place.cityId,'ne-1159151523');assert.equal(place.city,'Seoul');assert.equal(place.countrycode,'KR');assert.equal(place.timeZone,'Asia/Seoul');
 assert.equal(place.provenance,'directory-coordinate-and-city-name');assert.deepEqual(place.point,[seoul.geo_lat,seoul.geo_long]);assert.deepEqual(input,before);
 assert.deepEqual(stationPlace({...input,geo_lat:String(input.geo_lat),geo_long:String(input.geo_long)}),place);
});

test('country-only and invalid coordinate values never turn a centroid into a city',()=>{
 for(const pair of [[undefined,undefined],[null,null],['','126.99'],['  ',126.99],[true,126.99],[[37.56],126.99],[{value:37.56},126.99],[0,0],[91,126.99],[37.56,181],[NaN,126.99],[37.56,Infinity]]){
  const value=stationPlace({...seoul,geo_lat:pair[0],geo_long:pair[1]});assert.equal(value.confidence,'country');assert.equal(value.countrycode,'KR');assert.equal(value.city,undefined);assert.equal(value.timeZone,undefined);assert.equal(value.point,undefined);
 }
 for(const input of [null,undefined,[],{...seoul,countrycode:''},{...seoul,countrycode:'ZZ'},{...seoul,countrycode:'KR;US'}])assert.equal(stationPlace(input),null);
 assert.notEqual(stationPlace({...seoul,countrycode:'US'}).confidence,'city');
});

test('real coordinates alone preserve supplied-coordinate confidence without inventing a city or zone',()=>{
 const result=stationPlace({...seoul,state:'',city:'',name:'Music FM'});
 assert.deepEqual(result,{confidence:'exact',countrycode:'KR',point:[seoul.geo_lat,seoul.geo_long],provenance:'directory-coordinates'});
 assert.equal(formatPlaceTime(result,'2026-01-15T12:00:00Z'),null);
});

test('city name matching uses folded complete tokens and a documented conservative radius',()=>{
 assert.equal(CITY_EVIDENCE_RADIUS_KM,25);
 assert.equal(stationPlace({...seoul,state:'',name:'FEBC SEOUL 106.9 FM'}).city,'Seoul');
 assert.equal(stationPlace({...seoul,state:'',name:'Seoulville FM'}).confidence,'exact');
 assert.equal(stationPlace({...seoul,state:'',name:'Music fromseoul'}).confidence,'exact');
 const delta=km=>km*180/(Math.PI*6371);
 assert.equal(stationPlace({...seoul,geo_lat:seoul.geo_lat+delta(24)}).confidence,'city');
 assert.equal(stationPlace({...seoul,geo_lat:seoul.geo_lat+delta(26)}).confidence,'exact');
});

test('conflicting explicit city evidence is not repaired by a name or a nearby point',()=>{
 assert.equal(stationPlace({...seoul,city:'Busan',name:'Seoul FM'}).confidence,'exact');
 const ny={name:'New York FM',countrycode:'US',city:'Chicago',state:'New York',geo_lat:40.72156,geo_long:-73.99572};
 assert.equal(stationPlace(ny).confidence,'exact');
 assert.equal(stationPlace({...seoul,city:{label:'Seoul'}}).confidence,'exact');
 // Station brands can name another city; a corroborated explicit city remains
 // authoritative over a genre/brand name, but not over conflicting city/state.
 assert.equal(stationPlace({...ny,city:'New York',name:'Chicago Jazz'}).city,'New York');
});

test('two different curated city labels in one explicit field stay unresolved at either city',()=>{
 for(const point of [[40.72156,-73.99572],[41.84796,-87.63524]])for(const state of ['','New York','Chicago']){
  const value=stationPlace({name:'Radio',countrycode:'US',city:'New York / Chicago',state,geo_lat:point[0],geo_long:point[1]});
  assert.equal(value.confidence,'exact');assert.equal(value.city,undefined);assert.equal(value.timeZone,undefined);
 }
});

test('same-name cities need country and point agreement and never choose the first ambiguous match',()=>{
 const springfields=[city(1,'Springfield','US',[39.78,-89.65],'America/Chicago'),city(2,'Springfield','US',[42.1,-72.59],'America/New_York')];
 const station={name:'Springfield FM',countrycode:'US',geo_lat:39.78,geo_long:-89.65};
 assert.equal(stationPlace(station,springfields).cityId,'ne-1');
 assert.equal(stationPlace({...station,geo_lat:null,geo_long:null},springfields).confidence,'country');
 const overlapping=[springfields[0],{...springfields[1],point:[39.8,-89.66]}];
 assert.equal(stationPlace(station,overlapping).confidence,'exact');
 assert.equal(stationPlace(station,[...overlapping].reverse()).confidence,'exact');
 const sanJose=[city(3,'San José','CR',[9.93,-84.08],'America/Costa_Rica'),city(4,'San Jose','US',[37.33,-121.89],'America/Los_Angeles')];
 assert.equal(stationPlace({name:'San Jose radio',countrycode:'CR',geo_lat:9.93,geo_long:-84.08},sanJose).cityId,'ne-3');
 assert.equal(stationPlace({name:'San José radio',countrycode:'US',geo_lat:37.33,geo_long:-121.89},sanJose).cityId,'ne-4');
});

test('London and Melbourne cannot cross countries through familiar city names',()=>{
 const cities=[city(5,'London','GB',[51.5,-0.12],'Europe/London'),city(6,'Melbourne','AU',[-37.81,144.97],'Australia/Melbourne')];
 assert.equal(stationPlace({name:'London radio',countrycode:'CA',geo_lat:42.97,geo_long:-81.25},cities).confidence,'exact');
 assert.equal(stationPlace({name:'Melbourne radio',countrycode:'US',geo_lat:28.08,geo_long:-80.6},cities).confidence,'exact');
 assert.equal(stationPlace({name:'Melbourne radio',countrycode:'AU',geo_lat:-37.81,geo_long:144.97},cities).cityId,'ne-6');
});

test('an unsupported curated zone cannot produce a city with an unusable local time',()=>{
 const source=CURATED_PLACES.find(city=>city.name==='Seoul');
 assert.equal(stationPlace(seoul,[{...source,timeZone:'Imaginary/Timezone'}]).confidence,'exact');
 assert.throws(()=>stationPlace(seoul,Array(65).fill(source)),/64/);
});

test('explicit IANA zones handle DST and fractional offsets using an explicit instant',()=>{
 const place=name=>CURATED_PLACES.find(city=>city.name===name),winter='2026-01-15T12:00:00Z',summer='2026-07-15T12:00:00Z';
 assert.equal(formatPlaceTime(place('Seoul'),winter),'21:00');assert.equal(formatPlaceTime(place('London'),winter),'12:00');assert.equal(formatPlaceTime(place('London'),summer),'13:00');
 assert.equal(formatPlaceTime(place('New York'),winter),'07:00');assert.equal(formatPlaceTime(place('New York'),summer),'08:00');
 assert.equal(formatPlaceTime({timeZone:'Asia/Kathmandu'},winter),'17:45');
 assert.equal(formatPlaceTime({timeZone:'UTC'},new Date(winter)),'12:00');assert.equal(formatPlaceTime({timeZone:'UTC'},Date.parse(winter)),'12:00');
 assert.equal(formatPlaceTime({timeZone:'UTC'},'2026-01-15T21:00:00+09:00'),'12:00');
 assert.equal(formatPlaceTime({timeZone:'UTC'},'2026-01-15T00:00:00Z'),'00:00');
});

test('invalid or implicit date/zone/locale inputs do not fall back to the current device',()=>{
 const place={timeZone:'Asia/Seoul'};
 for(const instant of [undefined,null,false,NaN,Infinity,1e20,new Date(NaN),'today','2026-01-15T12:00:00','2026-02-30T12:00:00Z','2026-02-29T12:00:00Z','2026-01-15T24:00:00Z','2026-01-15T12:00:60Z','2026-01-15T12:00:00+25:00'])assert.equal(formatPlaceTime(place,instant),null,String(instant));
 for(const timeZone of ['',null,'Imaginary/Timezone','PST','GMT+9'])assert.equal(formatPlaceTime({timeZone},'2026-01-15T12:00:00Z'),null);
 for(const locale of ['',null,'not a locale','zz-ZZ'])assert.equal(formatPlaceTime(place,'2026-01-15T12:00:00Z',locale),null);
});

test('formatting is identical under different process-local timezone settings',()=>{
 const moduleUrl=new URL('../site/assets/place-core.js',import.meta.url).href;
 const code=`import {formatPlaceTime} from ${JSON.stringify(moduleUrl)};process.stdout.write(JSON.stringify([formatPlaceTime({timeZone:'Asia/Seoul'},'2026-01-15T12:00:00Z'),formatPlaceTime({timeZone:'Asia/Seoul'},'2026-01-15T12:00:00')]));`;
 for(const TZ of ['Pacific/Honolulu','Europe/Berlin']){
  const result=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,TZ},timeout:20000,windowsHide:true});assert.deepEqual(JSON.parse(result),['21:00',null]);
 }
});
