import test from 'node:test';
import assert from 'node:assert/strict';
import {publicStationId,stationShareUrl,parseStationSharePath,stationSharePayload,stationPreviewMetadata} from '../site/assets/sharing-core.js';
import {LISTEN_MOE_STATIONS} from '../site/assets/pinned-stations.js';

const id='a1234567-1234-4abc-8abc-0123456789ab';
const station={stationuuid:id,name:'서울 & Radio',countrycode:'KR',url:'https://radio.example/private?not-shared=1'};

test('only public UUIDs and the two built-in identities have canonical share links',()=>{
  assert.equal(publicStationId(id.toUpperCase()),id.toUpperCase());
  assert.equal(stationShareUrl(id),`https://app.earthradio.stream/s/${id}`);
  for(const row of LISTEN_MOE_STATIONS){assert.equal(publicStationId(row.stationuuid),row.stationuuid);assert.equal(stationShareUrl(row.stationuuid),`https://app.earthradio.stream/s/${encodeURIComponent(row.stationuuid)}`);}
  for(const value of ['',null,{},'__proto__','test-id','../'+id,id+'?token=hidden',id+'#station=other','earth-radio:listen.moe:other','https://evil.example/'+id,'X'.repeat(10000)]){
    assert.equal(publicStationId(value),null);assert.equal(stationShareUrl(value),null);
  }
});

test('path parsing is bounded, decodes once and identifies canonical equivalents',()=>{
  assert.deepEqual(parseStationSharePath('/s/'+id),{id,canonicalPath:'/s/'+id});
  assert.deepEqual(parseStationSharePath('/s/'+id.toUpperCase()+'/'),{id:id.toUpperCase(),canonicalPath:'/s/'+id.toUpperCase()});
  const direct=LISTEN_MOE_STATIONS[0].stationuuid;
  assert.equal(parseStationSharePath('/s/'+encodeURIComponent(direct)).id,direct);
  for(const path of ['/','/s/','/S/'+id,'/s/'+id+'/extra','/s/%','/s/%252e%252e','/s/'+id+'?query=1','/s/'+id+'#hash','/s/'+encodeURIComponent(id+'/extra')])assert.equal(parseStationSharePath(path),null,path);
});

test('share payload contains only bounded public presentation and its canonical ID URL',()=>{
  const input={...station,profile:{email:'not-shared'},access_token:'not-shared',songHistory:['not-shared']};
  const payload=stationSharePayload(input);
  assert.deepEqual(Object.keys(payload).sort(),['text','title','url']);
  assert.equal(payload.url,stationShareUrl(id));assert.match(payload.title,/서울 & Radio/);assert.match(payload.text,/South Korea/);
  assert.doesNotMatch(JSON.stringify(payload),/private|not-shared|access_token|songHistory/);
  assert.deepEqual(input.profile,{email:'not-shared'});assert.ok(Object.isFrozen(payload));
  assert.equal(stationSharePayload({...station,stationuuid:'unpublished-id'}),null);
});

test('metadata uses a short country name, preserves Unicode and never invents a city',()=>{
  const meta=stationPreviewMetadata({...station,state:'Not a verified city',city:'Not a verified city'});
  assert.match(meta.title,/서울 & Radio/);assert.match(meta.description,/South Korea/);assert.doesNotMatch(meta.description,/verified city/);
  assert.equal(meta.url,stationShareUrl(id));assert.equal(meta.image,'https://earthradio.stream/images/earth-radio-og.png');
  assert.match(stationSharePayload(station,{locale:'ko'}).text,/대한민국|한국/);
  const unknown=stationPreviewMetadata({...station,countrycode:'',country:'Not corroborated'});
  assert.doesNotMatch(unknown.description,/Not corroborated|Unknown/);
});

test('empty, hostile and oversized presentation stays plain bounded data',()=>{
  const hostile={...station,name:'\u0000<script>" & \u202E'+'界'.repeat(1000)};
  const meta=stationPreviewMetadata(hostile);assert.ok(meta.title.length<220);assert.doesNotMatch(meta.title,/[\u0000\u202e]/);
  assert.equal(stationPreviewMetadata({...station,name:''}),null);
  assert.equal(stationPreviewMetadata(null),null);
  assert.equal(stationPreviewMetadata({...station,name:{toString(){throw Error('must not execute');}}}),null);
});
