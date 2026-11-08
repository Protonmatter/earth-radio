import assert from 'node:assert/strict';
import test from 'node:test';
import {rankStations,buildFacetOptions} from '../site/assets/discovery-core.js';
import {canonicalGenre,canonicalLanguage,filterFacetOptions,matchesCountry,searchTerms} from '../site/assets/search-core.js';
const station=(id,extra={})=>({stationuuid:id,name:id,country:'France',countrycode:'FR',language:'english',tags:'jazz',bitrate:128,codec:'MP3',quality:{score:80},url_resolved:`https://example.org/${id}`, ...extra});
const ids=rows=>rows.map(r=>r.station.stationuuid);

test('common genre aliases share facet counts and generic directory tags stay out of the picker',()=>{
  const result=buildFacetOptions([station('a',{tags:'80 s,80s,pop music,radio,music,estacion'}),station('b',{tags:'80s,pop'})],'genre');
  assert.equal(result.find(row=>row.value==='80s').count,2);assert.equal(result.find(row=>row.value==='pop').count,2);
  assert.ok(result.every(row=>!['radio','music','estacion'].includes(row.value)));
});

test('exact titles lead Best match regardless of unrelated directory quality',()=>{
  const exact=station('exact',{name:'Jazz Paris',quality:{score:0}}),other=station('other',{name:'World station',country:'Jazz Paris',quality:{score:100}});
  assert.equal(ids(rankStations([other,exact],{query:'Jazz Paris'}))[0],'exact');
});
test('transpositions, location metadata and stream formats are searchable',()=>{
  const data=[station('a',{name:'Electronic Room',state:'Québec',city:'Montréal',codec:'AAC',bitrate:320})];
  for(const query of ['elecrtonic','quebec montreal','aac 320'])assert.deepEqual(ids(rankStations(data,{query})),['a']);
  assert.deepEqual(ids(rankStations(data,{query:'eleccrtonnic'})),[]);
});
test('country names/codes/aliases remain precise and never cross the Korean border',()=>{
  const south=station('south',{country:'The Republic Of Korea',countrycode:'KR'}),north=station('north',{country:'North Korea',countrycode:'KP'});
  for(const query of ['KR','South Korea','대한민국'])assert.equal(matchesCountry(south,query),true);
  assert.equal(matchesCountry(north,'South Korea'),false);assert.equal(matchesCountry(south,'North Korea'),false);
  assert.equal(matchesCountry(station('us',{country:'The United States Of America',countrycode:'US'}),'USA'),true);
  assert.deepEqual(ids(rankStations([station('us',{country:'The United States Of America',countrycode:'US'})],{query:'usa jazz'})),['us']);
});
test('language and punctuation aliases work in both queries and exact facets',()=>{
  assert.equal(canonicalLanguage('eng'),'english');assert.equal(canonicalLanguage('EN'),'english');
  assert.equal(canonicalGenre('hiphop'),canonicalGenre('hip-hop'));
  const data=[station('a',{language:'en',tags:'lo-fi,hip-hop'})];
  assert.deepEqual(ids(rankStations(data,{language:'english',genre:'hiphop',query:'english lofi'})),['a']);
});
test('connecting words are ignored only inside longer queries in their locale',()=>{
  assert.deepEqual(searchTerms('jazz in Japan','en'),['jazz','japan']);
  assert.deepEqual(searchTerms('jazz en España','es'),['jazz','espana']);
  assert.deepEqual(searchTerms('in','en'),['in']);assert.deepEqual(searchTerms('jazz from','en'),['jazz','from']);
  assert.deepEqual(ids(rankStations([station('a',{country:'Japan',countrycode:'JP'})],{query:'jazz in Japan'})),['a']);
});
test('normalized document cache observes mutations without mutating station records',()=>{
  const item=station('a',{name:'Old signal'});rankStations([item],{query:'old'});item.name='New signal';item.state='Osaka';
  assert.deepEqual(ids(rankStations([item],{query:'old'})),[]);assert.deepEqual(ids(rankStations([item],{query:'new osaka'})),['a']);
  item.tags='ambient';assert.deepEqual(ids(rankStations([item],{genre:'ambient'})),['a']);
  const snapshot=structuredClone(item);rankStations([item],{query:'new'});assert.deepEqual(item,snapshot);
});
test('facet options count each loaded station once and group canonical values',()=>{
  const pool=[station('a',{tags:'jazz,Jazz,hip-hop',language:'en,english'}),station('b',{tags:'hiphop',language:'eng'}),station('c',{tags:'ambient',language:'french'})];
  const genres=buildFacetOptions(pool,'genre'),languages=buildFacetOptions(pool,'language');
  assert.equal(genres.find(x=>x.value==='jazz').count,1);assert.equal(genres.find(x=>x.value==='hip hop').count,2);
  assert.equal(languages.find(x=>x.value==='english').count,2);
});
test('facet suggestions are bounded, deterministic and tolerate a spelling slip',()=>{
  const options=[{value:'jazz',label:'Jazz',count:10},{value:'classical',label:'Classical',count:20},{value:'ambient',label:'Ambient',count:3}];
  assert.equal(filterFacetOptions(options,'clasical')[0]?.value,'classical');
  assert.equal(filterFacetOptions(options,'')[0].value,'classical');
  assert.equal(filterFacetOptions(Array.from({length:100},(_,i)=>({value:'rock'+i,label:'Rock'+i,count:i})),'',999).length,24);
  assert.deepEqual(filterFacetOptions(options,'zzzz'),[]);
});
