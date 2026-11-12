import {normalizeSong} from './song-library-core.js?v=0.36.0';
import {stationPlace} from './place-core.js?v=0.36.0';
import {displayCountry} from './search-core.js?v=0.36.0';

export const MEDIA_ARTWORK_SIZES=Object.freeze([96,256,512]);
export const MEDIA_ARTWORK_MAX_BYTES=2*1024*1024;
export const BRAND_MEDIA_ARTWORK=Object.freeze({
  src:new URL('../branding/earth-radio-app-icon-512.png',import.meta.url).href,
  sizes:'512x512',type:'image/png'
});
const clean=(value,max=200)=>typeof value==='string'?value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sameStation=(a,b)=>Boolean(a&&b&&(a===b||uuid.test(a)&&uuid.test(b)&&a.toLowerCase()===b.toLowerCase()));

export function mediaArtworkSource(value){
  if(typeof value!=='string'||value.length>4096)return '';
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port
      ||!(url.hostname==='i.scdn.co'||url.hostname==='cdn.listen.moe'||url.hostname==='mzstatic.com'||url.hostname.endsWith('.mzstatic.com')))return '';
    url.hash='';return url.href;
  }catch{return '';}
}

function generatedArtwork(value){
  if(!Array.isArray(value)||value.length!==MEDIA_ARTWORK_SIZES.length)return null;
  let bytes=0;
  for(const [index,item]of value.entries()){
    if(!item||item.type!=='image/png'||item.sizes!==`${MEDIA_ARTWORK_SIZES[index]}x${MEDIA_ARTWORK_SIZES[index]}`
      ||typeof item.src!=='string'||item.src.length>MEDIA_ARTWORK_MAX_BYTES)return null;
    bytes+=item.src.length;
    if(bytes>MEDIA_ARTWORK_MAX_BYTES||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.src))return null;
  }
  return value.map(({src,sizes,type})=>({src,sizes,type}));
}

// The caller supplies only the existing promoted-song snapshot, never raw ICY.
// This projection adds station identity fencing without a second trust algorithm.
export function currentMediaSong(station,snapshot){
  const song=normalizeSong(snapshot);
  return song&&sameStation(clean(station?.stationuuid,128),song.stationUuid)?song:null;
}

export function buildRadioMediaMetadata(station,snapshot,{locale='en',artwork}={}){
  if(!station||typeof station!=='object'||Array.isArray(station))return null;
  const name=clean(station.name)||'Earth Radio',current=currentMediaSong(station,snapshot);
  let place='';
  if(!current){
    const location=stationPlace(station);
    place=[location?.confidence==='city'?clean(location.city):'',location?.countrycode?displayCountry({countrycode:location.countrycode},locale):''].filter(Boolean).join(', ');
  }
  return{title:current?current.title:name,artist:current?current.artist:place,album:current?name:'Earth Radio',
    // Never hand an unbounded remote URL to a native image loader, which could
    // bypass our redirect/byte guards. Covers arrive only as validated PNG data.
    artwork:current&&generatedArtwork(artwork)||[{...BRAND_MEDIA_ARTWORK}]};
}
