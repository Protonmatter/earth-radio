import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedStationEntry} from '../site/assets/sharing-entry.js';
import {SHARED_STATION_BOOTSTRAP_MAX_BYTES} from '../site/assets/sharing-core.js';

const id='a1234567-1234-4abc-8abc-0123456789ab';
const row={stationuuid:id,name:'Shared Seoul',countrycode:'KR',url:'https://radio.example/live',codec:'MP3'};
function fixture({url='https://app.earthradio.stream/s/'+id,json=JSON.stringify({schemaVersion:1,station:row})}={}){
  const calls=[],node={textContent:json,remove(){calls.push({remove:true});}},doc={getElementById(value){return value==='er-shared-station'&&json!==null?node:null;}};
  const location={href:url,replace(value){calls.push({navigate:value});}},history={replaceState(...args){calls.push({history:args});}};
  return{calls,doc,location,history,entry:createSharedStationEntry({documentImpl:doc,locationImpl:location,historyImpl:history})};
}

test('a verified shared entry preserves the exact record and selects through the legacy route without playback',()=>{
  const f=fixture({url:'https://app.earthradio.stream/s/'+id+'?private=not-forwarded#station=another'}),state=f.entry.read();
  assert.equal(state.kind,'ready');assert.deepEqual(state.station,row);assert.ok(Object.isFrozen(state.station));
  assert.deepEqual(f.calls.filter(c=>c.history),[{history:[null,'','/#station='+id]}]);
  assert.deepEqual(f.calls.filter(c=>c.navigate),[]);assert.equal(f.entry.read(),state);
  assert.ok(f.calls.some(c=>c.remove));assert.doesNotMatch(JSON.stringify(f.calls),/not-forwarded|another/);
});

test('ordinary root, OAuth query, legacy hash and native file entry are untouched',()=>{
  for(const url of ['https://app.earthradio.stream/?code=owned-callback#station='+id,'https://app.earthradio.stream/#station='+id,'file:///C:/EarthRadio/site/index.html#station='+id]){
    const f=fixture({url});assert.equal(f.entry.read().kind,'none');assert.deepEqual(f.calls,[]);
  }
});

test('missing, malformed, mismatched and oversized shared bootstrap cannot fall back to another station',()=>{
  const bad=[null,'{',JSON.stringify({schemaVersion:2,station:row}),JSON.stringify({schemaVersion:1,station:{...row,stationuuid:'b1234567-1234-4abc-8abc-0123456789ab'}}),JSON.stringify({schemaVersion:1,station:{...row,url:'javascript:bad'}}),' '.repeat(SHARED_STATION_BOOTSTRAP_MAX_BYTES+1)];
  for(const json of bad){const f=fixture({json});assert.equal(f.entry.read().kind,'invalid');assert.deepEqual(f.calls.filter(c=>c.navigate),[{navigate:'/404'}]);assert.equal(f.calls.some(c=>c.history),false);assert.equal(f.entry.read().kind,'invalid');assert.equal(f.calls.filter(c=>c.navigate).length,1);}
});

test('history failure is contained and navigates to the static error document',()=>{
  const f=fixture();f.history.replaceState=()=>{throw Error('denied');};assert.equal(f.entry.read().kind,'invalid');assert.deepEqual(f.calls.filter(c=>c.navigate),[{navigate:'/404'}]);
});

test('identity case and safe Unicode survive the bootstrap without rewriting saved identifiers',()=>{
  const upper=id.toUpperCase(),record={...row,stationuuid:upper,name:'音楽 & Radio'};
  const f=fixture({url:'https://app.earthradio.stream/s/'+upper,json:JSON.stringify({schemaVersion:1,station:record})});
  assert.deepEqual(f.entry.read().station,record);assert.equal(f.calls.find(c=>c.history).history[2],'/#station='+upper);
});

test('root-fragment reload retains an explicitly requested station from the existing catalog cache',()=>{
  const f=fixture({url:'https://app.earthradio.stream/?code=owned-callback#station='+id,json:null});
  assert.equal(f.entry.read().kind,'none');
  const cached={...row,url:undefined,url_resolved:row.url,lastcheckok:true,hls:false,geo_lat:null,geo_long:null,quality:{score:90}};
  assert.equal(f.entry.restoreCachedStations([cached]),true);assert.equal(f.entry.read().kind,'cached');
  assert.equal(f.entry.read().station.stationuuid,id);assert.equal(f.entry.read().station.url,row.url);assert.equal(f.entry.read().station.lastcheckok,1);
  assert.equal(f.entry.read().station.quality,undefined);assert.deepEqual(f.calls,[]);assert.equal(cached.lastcheckok,true);
});

test('cache restoration cannot substitute a different ID, infer a selection or alter native entry',()=>{
  for(const url of ['https://app.earthradio.stream/','https://app.earthradio.stream/#station=b1234567-1234-4abc-8abc-0123456789ab','file:///C:/app/site/index.html#station='+id]){
    const f=fixture({url,json:null});assert.equal(f.entry.restoreCachedStations([row]),false);assert.deepEqual(f.calls,[]);
  }
  const f=fixture({url:'https://app.earthradio.stream/#station='+id,json:null});assert.equal(f.entry.restoreCachedStations([{...row,url:'javascript:bad'}]),false);assert.equal(f.entry.read().kind,'none');
});

test('a verified entry can provide only its exact normalized public row when the directory fails',()=>{
  const f=fixture(),normalized={...row,quality:{score:80},secureStream:true};let calls=0;
  const result=f.entry.catalogFallback(value=>{calls++;assert.deepEqual(value,row);return normalized;});
  assert.equal(calls,1);assert.deepEqual(result,{stations:[normalized],source:'shared-station',partial:'shared-station',cached:false,stale:false});
  assert.equal(f.entry.read().kind,'ready');assert.equal(f.calls.some(call=>call.navigate),false);
});

test('directory recovery cannot fabricate an entry, substitute its ID or bypass normalization',()=>{
  for(const normalize of [()=>null,()=>({...row,stationuuid:'another'}),()=>{throw Error('normalization failed');}])assert.equal(fixture().entry.catalogFallback(normalize),null);
  for(const url of ['https://app.earthradio.stream/','file:///C:/app/index.html']){
    const f=fixture({url,json:null});let calls=0;assert.equal(f.entry.catalogFallback(()=>{calls++;return row;}),null);assert.equal(calls,0);
  }
});
