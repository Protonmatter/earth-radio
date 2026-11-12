import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRadioMediaMetadata,mediaArtworkSource,MEDIA_ARTWORK_SIZES,BRAND_MEDIA_ARTWORK} from '../site/assets/media-session-core.js';

const station={stationuuid:'00000000-0000-4000-8000-000000000001',name:'Berlin Signal',countrycode:'DE',country:'Federal Republic of Germany',state:'Berlin',geo_lat:52.52,geo_long:13.405};
const song={stationUuid:station.stationuuid,artist:'IU',title:'Blueming',album:'A song album',confidence:78};

test('a current promoted song uses track/artist with station as album and keeps Unicode',()=>{
 const value=buildRadioMediaMetadata(station,{...song,artist:'아이유',title:'라망'});
 assert.equal(value.title,'라망');assert.equal(value.artist,'아이유');assert.equal(value.album,'Berlin Signal');
});
test('station fallback uses corroborated city and short country, never raw directory country copy',()=>{
 const value=buildRadioMediaMetadata(station,null);
 assert.equal(value.title,'Berlin Signal');assert.equal(value.artist,'Berlin, Germany');assert.equal(value.album,'Earth Radio');
 assert.deepEqual(value.artwork,[BRAND_MEDIA_ARTWORK]);
});
test('country-only and unknown places do not manufacture city precision',()=>{
 assert.equal(buildRadioMediaMetadata({stationuuid:'country',name:'National Radio',countrycode:'DE'},null).artist,'Germany');
 assert.equal(buildRadioMediaMetadata({stationuuid:'unknown',name:'Unlocated',countrycode:'ZZ',geo_lat:0,geo_long:0},null).artist,'');
});
test('raw title-only, malformed and another station song use station fallback',()=>{
 for(const value of [{title:'Raw broadcast line'},null,[],{...song,stationUuid:'another'},{...song,title:'x'.repeat(201)}]){
  assert.equal(buildRadioMediaMetadata(station,value).title,'Berlin Signal');
 }
});
test('UUID casing is identity-equivalent while different aliases are not inferred as equal',()=>{
 const mixed={...station,stationuuid:'aaaaaaaa-0000-4000-8000-000000000001'};
 assert.equal(buildRadioMediaMetadata(mixed,{...song,stationUuid:mixed.stationuuid.toUpperCase()}).title,'Blueming');
 assert.equal(buildRadioMediaMetadata(mixed,{...song,stationUuid:'aaaaaaaa-0000-4000-8000-000000000002'}).title,'Berlin Signal');
});
test('safe cover source is normalized but native metadata waits for bounded raster output',()=>{
 const url='https://is1-ssl.mzstatic.com/image/thumb/Music/fixture/512x512bb.jpg';
 assert.equal(mediaArtworkSource(url),url);
 assert.deepEqual(buildRadioMediaMetadata(station,{...song,artworkUrl:url}).artwork,[BRAND_MEDIA_ARTWORK]);
 assert.deepEqual(MEDIA_ARTWORK_SIZES,[96,256,512]);
 assert.equal(BRAND_MEDIA_ARTWORK.sizes,'512x512');assert.equal(BRAND_MEDIA_ARTWORK.type,'image/png');
});
test('only trusted HTTPS cover origins without credentials or custom ports are admitted',()=>{
 for(const value of ['javascript:alert(1)','data:image/svg+xml,x','http://i.scdn.co/a','https://i.scdn.co.evil.example/a','https://127.0.0.1/a','https://user:pass@i.scdn.co/a','https://i.scdn.co:444/a','https://evil.example/a',null])assert.equal(mediaArtworkSource(value),'');
 for(const value of ['https://i.scdn.co/image/fixture','https://cdn.listen.moe/cover.png','https://is1-ssl.mzstatic.com/a'])assert.equal(mediaArtworkSource(value),value);
});
test('invalid cover cannot replace otherwise valid song text or use a directory favicon',()=>{
 const value=buildRadioMediaMetadata({...station,favicon:'https://untrusted.example/large.jpg'},{...song,artworkUrl:'https://i.scdn.co:444/a'});
 assert.equal(value.title,'Blueming');assert.deepEqual(value.artwork,[BRAND_MEDIA_ARTWORK]);
});
test('generated cover descriptors accept only the exact bounded PNG size set',()=>{
 const artwork=MEDIA_ARTWORK_SIZES.map(size=>({src:'data:image/png;base64,aA==',sizes:`${size}x${size}`,type:'image/png'}));
 assert.deepEqual(buildRadioMediaMetadata(station,song,{artwork}).artwork,artwork);
 assert.deepEqual(buildRadioMediaMetadata(station,{...song,stationUuid:'another'},{artwork}).artwork,[BRAND_MEDIA_ARTWORK]);
 for(const invalid of [[{src:'javascript:x',sizes:'512x512',type:'image/png'}],artwork.map(x=>({...x,type:'image/svg+xml'})),[...artwork,...artwork]])assert.deepEqual(buildRadioMediaMetadata(station,song,{artwork:invalid}).artwork,[BRAND_MEDIA_ARTWORK]);
});
test('projection and output mutation leave source station, song and fallback artwork intact',()=>{
 const before=structuredClone({station,song}),first=buildRadioMediaMetadata(station,song);first.artwork[0].src='fixture-changed';
 assert.deepEqual({station,song},before);assert.deepEqual(buildRadioMediaMetadata(station,song).artwork,[BRAND_MEDIA_ARTWORK]);
 assert.equal(buildRadioMediaMetadata(null,song),null);assert.equal(buildRadioMediaMetadata([],song),null);
});
test('metadata text removes control characters and station names have a bounded length',()=>{
 const value=buildRadioMediaMetadata({...station,name:'x'.repeat(1000)},{...song,artist:'I\u0000U',title:'Blue\nming'});
 assert.equal(value.album.length,200);assert.doesNotMatch(value.artist+value.title,/[\u0000-\u001f]/);
});
