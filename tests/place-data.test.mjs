import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {curatePlaces,renderPlaceModule,PLACE_INPUTS} from '../scripts/build-place-data.mjs';
import {CURATED_PLACES} from '../site/assets/curated-places.js';

const feature=(id,name='Seoul',countrycode='KR',point=[126.997785,37.568295])=>({type:'Feature',properties:{ne_id:id,name,nameascii:name,iso_a2:countrycode},geometry:{type:'Point',coordinates:point}});
const collection=features=>({type:'FeatureCollection',features});
const zones='# public domain fixture\nKR\t+3733+12658\tAsia/Seoul\nUS\t+404251-0740023\tAmerica/New_York\n';
const selected=[{naturalEarthId:1159151523,timeZone:'Asia/Seoul'}];

test('curation preserves selection order and source identity, reverses coordinate order once and does not mutate inputs',()=>{
 const input=collection([feature(1159151523)]),before=structuredClone(input),choice=structuredClone(selected);
 const result=curatePlaces(input,zones,choice);
 assert.deepEqual(result,[{id:'ne-1159151523',naturalEarthId:1159151523,name:'Seoul',countrycode:'KR',point:[37.568295,126.997785],timeZone:'Asia/Seoul',aliases:['Seoul']}]);
 assert.deepEqual(input,before);assert.deepEqual(choice,selected);
 assert.deepEqual(curatePlaces(input,zones,choice),result);
 const two=collection([feature(10,'New York','US',[-73.995718,40.721562]),feature(20)]);
 assert.deepEqual(curatePlaces(two,zones,[{naturalEarthId:20,timeZone:'Asia/Seoul'},{naturalEarthId:10,timeZone:'America/New_York'}]).map(city=>city.naturalEarthId),[20,10]);
});

test('an IANA name must belong to the Natural Earth country rather than merely be a supported zone',()=>{
 assert.throws(()=>curatePlaces(collection([feature(1159151523)]),zones,[{naturalEarthId:1159151523,timeZone:'America/New_York'}]),/country|zone/i);
 assert.throws(()=>curatePlaces(collection([feature(1159151523)]),zones,[{naturalEarthId:1159151523,timeZone:'Asia/Imaginary'}]),/zone/i);
});

test('duplicate or absent source IDs fail instead of silently picking another feature',()=>{
 assert.throws(()=>curatePlaces(collection([feature(1159151523)]),zones,[...selected,...selected]),/duplicate/i);
 assert.throws(()=>curatePlaces(collection([feature(1159151523),feature(1159151523)]),zones,selected),/duplicate/i);
 assert.throws(()=>curatePlaces(collection([feature(2)]),zones,selected),/missing|absent|found/i);
});

test('malformed geometry and source identity cannot generate a plausible city point',()=>{
 for(const point of [[181,0],[126,91],[NaN,37],[126,'37'],[126,null],[126,37,5]])assert.throws(()=>curatePlaces(collection([feature(1159151523,'Seoul','KR',point)]),zones,selected),/point|geometry|coordinate/i);
 const wrongGeometry=feature(1159151523);wrongGeometry.geometry.type='LineString';assert.throws(()=>curatePlaces(collection([wrongGeometry]),zones,selected),/point|geometry/i);
 for(const name of ['',null,'Seoul\nInjected'])assert.throws(()=>curatePlaces(collection([feature(1159151523,name)]),zones,selected),/name/i);
 for(const code of ['',null,'ZZ','KOR'])assert.throws(()=>curatePlaces(collection([feature(1159151523,'Seoul',code)]),zones,selected),/country/i);
});

test('curator bounds source, selection and timezone input and rejects ambiguous zone rows',()=>{
 const input=collection([feature(1159151523)]);
 assert.throws(()=>curatePlaces(collection(Array(10001).fill(feature(1))),zones,selected),/limit|budget|bounded/i);
 for(const selection of [[],Array(65).fill(selected[0]),null])assert.throws(()=>curatePlaces(input,zones,selection),/selection|limit|budget/i);
 assert.throws(()=>curatePlaces(input,'x'.repeat(128*1024+1),selected),/limit|budget|zone/i);
 assert.throws(()=>curatePlaces(input,zones+'US\t+4000-07400\tAsia/Seoul\n',selected),/duplicate|zone/i);
});

test('generated module is deterministic, data-only and freezes all shared city values',async()=>{
 const cities=curatePlaces(collection([feature(1159151523)]),zones,selected),source=renderPlaceModule(cities);
 assert.equal(renderPlaceModule(cities),source);assert.equal(source.includes('\r'),false);
 const {CURATED_PLACES}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 assert.deepEqual(CURATED_PLACES,cities);
 for(const value of [CURATED_PLACES,CURATED_PLACES[0],CURATED_PLACES[0].point,CURATED_PLACES[0].aliases])assert.equal(Object.isFrozen(value),true);
 assert.throws(()=>CURATED_PLACES[0].point.push(4),TypeError);
 assert.ok(Buffer.byteLength(source)<12*1024);
});

test('committed places, selection and pinned-source provenance agree without downloading raw data',async()=>{
 const root=new URL('../',import.meta.url),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const [moduleBytes,selectionBytes,provenanceBytes,mapBytes]=await Promise.all(['site/assets/curated-places.js','docs/provenance/place-selection.json','docs/provenance/place-data.json','docs/provenance/map-data.json'].map(relative=>readFile(new URL(relative,root))));
 const provenance=JSON.parse(provenanceBytes),selection=JSON.parse(selectionBytes),map=JSON.parse(mapBytes);
 assert.equal(CURATED_PLACES.length,11);assert.equal(provenance.schemaVersion,1);assert.equal(provenance.license,'Public domain');
 assert.deepEqual(provenance.sources,PLACE_INPUTS);
 const ne=map.sources.find(row=>row.name==='ne_10m_populated_places_simple');
 for(const key of ['url','bytes','sha256'])assert.equal(PLACE_INPUTS[0][key],ne[key]);
 assert.equal(provenance.output.path,'site/assets/curated-places.js');assert.equal(provenance.output.bytes,moduleBytes.length);assert.equal(provenance.output.sha256,hash(moduleBytes));assert.equal(provenance.output.records,11);
 assert.equal(provenance.selection.path,'docs/provenance/place-selection.json');assert.equal(provenance.selection.bytes,selectionBytes.length);assert.equal(provenance.selection.sha256,hash(selectionBytes));
 assert.equal(renderPlaceModule(CURATED_PLACES),moduleBytes.toString('utf8'));
 assert.deepEqual(CURATED_PLACES.map(({naturalEarthId,timeZone})=>({naturalEarthId,timeZone})),selection.places);
 for(const city of CURATED_PLACES){assert.equal(Object.isFrozen(city),true);assert.equal(city.id,`ne-${city.naturalEarthId}`);assert.equal(new Intl.DateTimeFormat('en',{timeZone:city.timeZone}).resolvedOptions().timeZone.length>0,true);}
});
