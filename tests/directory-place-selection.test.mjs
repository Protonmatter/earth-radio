import test from 'node:test';
import assert from 'node:assert/strict';
import {CURATED_PLACES} from '../site/assets/curated-places.js';
import {cityProgramChoices} from '../site/assets/today-core.js';
import {selectDirectoryPlaces} from '../scripts/directory-place-selection.mjs';

const cityRows=(city,offset)=>Array.from({length:5},(_,i)=>({stationuuid:`00000000-0000-4000-8000-${String(offset+i).padStart(12,'0')}`,
 name:`${city.name} Programme ${i+1}`,countrycode:city.countrycode,country:city.countrycode,state:city.name,
 geo_lat:city.point[0],geo_long:city.point[1],url:`https://streams.example/${offset+i}`,url_resolved:`https://streams.example/${offset+i}`,
 codec:'MP3',bitrate:128,tags:'jazz',lastcheckok:1,clickcount:1000-i,quality:{score:100}}));
const filler=i=>({stationuuid:'filler-'+i,name:'Filler '+i,country:'New Zealand',countrycode:'NZ',geo_lat:null,geo_long:null,
 url:`https://streams.example/filler-${i}`,codec:'MP3',bitrate:128,lastcheckok:1,quality:{score:100}});
function fixture(){
 const dublin=CURATED_PLACES.find(city=>city.name==='Dublin');
 const rest=CURATED_PLACES.filter(city=>city!==dublin).flatMap((city,i)=>cityRows(city,i*10));
 const irish=cityRows(dublin,500);return{dublin,irish,rows:[...rest,...irish.slice(0,3),...Array.from({length:7},(_,i)=>filler(i)),...irish.slice(3)]};
}
const count=(rows,city)=>cityProgramChoices(rows,city.id,{secureOnly:false}).length;

test('retains five distinct Dublin programs beyond the global cutoff without growing it',()=>{
 const{rows,dublin,irish}=fixture();assert.equal(count(rows.slice(0,60),dublin),3);
 const {stations,coverage,addedForPlaces}=selectDirectoryPlaces(rows,{globalLimit:60});
 assert.equal(stations.length,60);assert.equal(addedForPlaces,2);assert.equal(count(stations,dublin),5);
 assert.ok(irish.every(row=>stations.includes(row)));assert.equal(stations.includes(rows.find(row=>row.stationuuid==='filler-6')),false);
 assert.ok(coverage.every(row=>row.selectedPrograms>=5));
 for(const city of CURATED_PLACES)assert.equal(count(stations,city),5);
});

test('keeps an already satisfactory prefix byte-for-byte and preserves source order',()=>{
 const{rows}=fixture(),good=[...rows.filter(row=>!row.stationuuid.startsWith('filler-')),...Array.from({length:9},(_,i)=>filler(i))];
 const result=selectDirectoryPlaces(good,{globalLimit:60});assert.deepEqual(result.stations,good.slice(0,60));assert.equal(result.addedForPlaces,0);
 const selected=selectDirectoryPlaces(rows,{globalLimit:60}).stations;
 assert.deepEqual(selected,rows.filter(row=>selected.includes(row)));
});

test('fails closed when the complete candidate pool cannot supply the minimum',()=>{
 const{rows,irish}=fixture();const short=rows.filter(row=>!irish.slice(3).includes(row));
 assert.throws(()=>selectDirectoryPlaces(short,{globalLimit:60}),/Dublin.*3.*5|Dublin.*5.*3/);
});

test('five stream variants of one program do not satisfy five programs',()=>{
 const{rows,irish}=fixture();const variants=rows.map(row=>irish.includes(row)?{...row,name:'Dublin One Programme'}:row);
 assert.throws(()=>selectDirectoryPlaces(variants,{globalLimit:60}),/Dublin/);
});

test('a shared stream with a conflicting city is not a qualified witness',()=>{
 const{rows,irish}=fixture();const conflict={...cityRows(CURATED_PLACES[0],700)[0],name:'Berlin Conflicting Relay',url:irish[4].url,url_resolved:irish[4].url_resolved};
 assert.throws(()=>selectDirectoryPlaces([...rows,conflict],{globalLimit:60}),/Dublin/);
});

test('country-only and mismatched coordinate observations cannot manufacture city coverage',()=>{
 const{rows,irish}=fixture();
 for(const patch of [{geo_lat:null,geo_long:null},{state:'New York',name:'New York Programme'},{geo_lat:0,geo_long:0}]){
  assert.throws(()=>selectDirectoryPlaces(rows.map(row=>row===irish[4]?{...row,...patch}:row),{globalLimit:60}),/Dublin/);
 }
});

test('rejects insufficient root space and invalid policy bounds',()=>{
 const{rows}=fixture();assert.throws(()=>selectDirectoryPlaces(rows,{globalLimit:54}),/budget|limit|space/i);
 for(const value of [-1,0,10001,Infinity,1.5])assert.throws(()=>selectDirectoryPlaces(rows,{globalLimit:value}),/limit/i);
 for(const value of [-1,Infinity,1.5,21])assert.throws(()=>selectDirectoryPlaces(rows,{minimumCityPrograms:value}),/minimum|policy/i);
});

test('explicit protocol-fixture opt-out retains the previous slice behavior',()=>{
 const rows=[filler(0),filler(1)];assert.deepEqual(selectDirectoryPlaces(rows,{globalLimit:1,minimumCityPrograms:0}).stations,[rows[0]]);
});

test('does not mutate rows, aliases or the input array and performs no implicit clock read',()=>{
 const{rows}=fixture();const input=rows.map(row=>Object.freeze({...row,quality:Object.freeze({...row.quality})}));Object.freeze(input);
 const before=JSON.stringify(input),now=Date.now;Date.now=()=>{throw Error('Implicit clock read');};
 try{const result=selectDirectoryPlaces(input,{globalLimit:60});assert.equal(result.stations.length,60);assert.ok(result.stations.every(row=>input.includes(row)));assert.equal(JSON.stringify(input),before);}finally{Date.now=now;}
});

test('uses an explicit bounded candidate pool and rejects oversized normalized input',()=>{
 const{rows}=fixture(),beyond=[...Array.from({length:50000},(_,i)=>filler(i)),...rows];
 assert.throws(()=>selectDirectoryPlaces(beyond),/Berlin.*0.*5|Berlin.*5.*0/);
 assert.throws(()=>selectDirectoryPlaces(new Array(75001)),/75000/);
});
