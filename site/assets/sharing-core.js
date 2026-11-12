import {LISTEN_MOE_STATIONS} from './direct-stations.js?v=0.37.0';

export const STATION_SHARE_ORIGIN='https://app.earthradio.stream';
export const STATION_SHARE_IMAGE='https://earthradio.stream/images/earth-radio-og.png';
export const SHARED_STATION_BOOTSTRAP_MAX_BYTES=512*1024;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const directIds=new Set(LISTEN_MOE_STATIONS.map(row=>row.stationuuid));
const clean=(value,max=160)=>typeof value==='string'?value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';

export function publicStationId(value){
  if(typeof value!=='string'||value.length>160)return null;
  // The published index hashes exact identity bytes. Preserve selected/saved IDs.
  if(uuid.test(value))return value;
  return directIds.has(value)?value:null;
}

export function stationShareUrl(value){
  const id=publicStationId(value);return id?STATION_SHARE_ORIGIN+'/s/'+encodeURIComponent(id):null;
}

export function parseStationSharePath(pathname){
  if(typeof pathname!=='string'||pathname.length>220)return null;
  const match=/^\/s\/([^/?#]+)\/?$/.exec(pathname);if(!match)return null;
  let decoded;try{decoded=decodeURIComponent(match[1]);}catch{return null;}
  const id=publicStationId(decoded);return id?{id,canonicalPath:'/s/'+encodeURIComponent(id)}:null;
}

function countryLabel(station,locale){
  const code=typeof station?.countrycode==='string'?station.countrycode.toUpperCase():'';
  if(!/^[A-Z]{2}$/.test(code)||['ZZ','XX','EU','UN'].includes(code))return '';
  try{return clean(new Intl.DisplayNames([locale],{type:'region',style:'short',fallback:'none'}).of(code),128);}catch{return '';}
}

export function stationSharePayload(station,{locale='en'}={}){
  const url=stationShareUrl(station?.stationuuid),name=clean(station?.name);if(!url||!name)return null;
  const country=countryLabel(station,locale);
  return Object.freeze({title:name+' · Earth Radio',text:[name,country].filter(Boolean).join(' · '),url});
}

export function stationPreviewMetadata(station){
  const payload=stationSharePayload(station);if(!payload)return null;
  return Object.freeze({title:payload.title,description:payload.text+'. Listen on Earth Radio.',url:payload.url,image:STATION_SHARE_IMAGE});
}
