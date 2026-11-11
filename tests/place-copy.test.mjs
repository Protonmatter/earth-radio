import test from 'node:test';
import assert from 'node:assert/strict';
import {stationFacts} from '../site/assets/place-copy.js';
import {CURATED_PLACES} from '../site/assets/curated-places.js';

const berlin=CURATED_PLACES.find(place=>place.name==='Berlin');
const cityRow=(name,patch={})=>{
 const city=CURATED_PLACES.find(place=>place.name===name);
 return{stationuuid:'place-copy-fixture',name:name+' Radio',countrycode:city.countrycode,state:city.name,geo_lat:city.point[0],geo_long:city.point[1],tags:'radio,music,jazz,pop',...patch};
};
const now='2026-11-11T18:15:00.000Z';

test('corroborated city copy leads with place, a meaningful genre and explicit local time',()=>{
 const facts=stationFacts(cityRow('Berlin'),{locale:'en',now});
 assert.deepEqual(facts,{place:'Berlin, Germany',genre:'Jazz',time:'19:15',text:'Berlin, Germany · Jazz · 19:15',cityId:berlin.id});
 assert.equal(stationFacts(cityRow('London',{country:'The United Kingdom Of Great Britain And Northern Ireland',tags:'news'}),{locale:'en',now}).text,'London, UK · News · 18:15');
});

test('unknown city, conflicting name and absent coordinates fall back to Country alone',()=>{
 for(const patch of [{geo_lat:null,geo_long:null},{state:'Tokyo',name:'Music'},{city:'Chicago'}, {geo_lat:0,geo_long:0}]){
  assert.deepEqual(stationFacts(cityRow('Berlin',patch),{locale:'en',now}),{place:'Germany',genre:'',time:'',text:'Germany',cityId:null});
 }
 const tokyo={name:'Tokyo Music',countrycode:'JP',state:'Tokyo',geo_lat:35.68,geo_long:139.69,tags:'jazz'};
 assert.equal(stationFacts(tokyo,{locale:'en',now}).text,'Japan');
});

test('native component support restricts place copy but cannot confer missing city evidence',()=>{
 for(const nativeProgram of [null,{}, {id:'program',cityId:null},{id:'program',cityId:'ne-1159151523'}]){
  assert.equal(stationFacts(cityRow('Berlin',{nativeProgram}),{now}).text,'Germany');
 }
 assert.equal(stationFacts(cityRow('Berlin',{nativeProgram:{id:'program',cityId:berlin.id},geo_lat:null,geo_long:null}),{now}).text,'Germany');
 assert.equal(stationFacts(cityRow('Berlin',{nativeProgram:{id:'program',cityId:berlin.id}}),{now}).cityId,berlin.id);
});

test('country names and separators use the explicit supported locale',()=>{
 const expected={en:'Germany',es:'Alemania',ar:'ألمانيا',ko:'독일','zh-Hans':'德国','zh-Hant':'德國'};
 for(const [locale,country]of Object.entries(expected)){
  const facts=stationFacts(cityRow('Berlin'),{locale,now});
  assert.ok(facts.place.includes(country),locale);assert.ok(facts.time,locale);
 }
 assert.equal(stationFacts(cityRow('Berlin'),{locale:'ar',now}).place,'Berlin، ألمانيا');
 assert.equal(stationFacts({country:'The Republic Of Korea'},{locale:'en'}).text,'South Korea');
});

test('local clocks honor DST, omit invalid instants and never read an implicit clock',()=>{
 const row=cityRow('New York');
 assert.equal(stationFacts(row,{now:'2026-01-15T12:00:00Z'}).time,'07:00');
 assert.equal(stationFacts(row,{now:'2026-07-15T12:00:00Z'}).time,'08:00');
 assert.equal(stationFacts(row,{now:'2026-11-01T05:59:00Z'}).time,'01:59');
 assert.equal(stationFacts(row,{now:'2026-11-01T06:00:00Z'}).time,'01:00');
 const original=Date.now;Date.now=()=>{throw Error('implicit clock');};
 try{
  for(const value of [undefined,null,NaN,'2026-02-30T12:00:00Z','yesterday'])assert.equal(stationFacts(row,{now:value}).time,'');
  assert.equal(stationFacts(row).text,'New York, US · Jazz');
 }finally{Date.now=original;}
});

test('copy tolerates malformed fields, normalizes tags and leaves input unchanged',()=>{
 const row=cityRow('Berlin',{tagList:['music',{},'pop music']});const before=structuredClone(row);
 assert.equal(stationFacts(row,{now}).genre,'Pop');assert.deepEqual(row,before);
 for(const value of [null,undefined,[],false,{country:{bad:true},countrycode:{bad:true}},{country:'x'.repeat(513)}]){
  assert.deepEqual(stationFacts(value),{place:'Country unknown',genre:'',time:'',text:'Country unknown',cityId:null});
 }
 assert.equal(stationFacts(cityRow('Berlin',{tags:'<img src=x>,jazz'}),{now}).genre,'Jazz');
 assert.equal(stationFacts(cityRow('Berlin',{tags:'x'.repeat(513)}),{now}).genre,'');
});
