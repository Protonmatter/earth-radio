import {parseStationSharePath,publicStationId,SHARED_STATION_BOOTSTRAP_MAX_BYTES} from './sharing-core.js?v=0.37.0';
import {STATION_RECORD_FIELDS,validateStationRecordShard} from './station-record-protocol.js?v=0.37.0';

const none=Object.freeze({kind:'none'}),invalid=Object.freeze({kind:'invalid'});

// A same-origin, Function-generated data block, never executable source. This
// presentation input may extend the public station cache, not account/history data.
export function createSharedStationEntry(options={}){
  let owner=null,state=null;
  function read(){
    const document=options.documentImpl||globalThis.document,location=options.locationImpl||globalThis.location,history=options.historyImpl||globalThis.history;
    if(!document||!location)return none;
    if(owner!==document){owner=document;state=null;}
    if(state)return state;
    let url;try{url=new URL(location.href);}catch{return state=none;}
    if(!['https:','http:'].includes(url.protocol)||!url.pathname.startsWith('/s/'))return state=none;
    try{
      const path=parseStationSharePath(url.pathname),node=document.getElementById('er-shared-station');
      if(!path||!node||typeof node.textContent!=='string'||new TextEncoder().encode(node.textContent).length>SHARED_STATION_BOOTSTRAP_MAX_BYTES)throw Error('Invalid station entry');
      const value=JSON.parse(node.textContent);
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||value.schemaVersion!==1||!Object.hasOwn(value,'station'))throw Error('Invalid station bootstrap');
      validateStationRecordShard({schemaVersion:1,stations:[value.station]},{records:1});
      if(value.station.stationuuid!==path.id)throw Error('Station identity mismatch');
      const station=Object.freeze({...value.station});
      history.replaceState(null,'','/#station='+encodeURIComponent(path.id));
      node.remove();return state=Object.freeze({kind:'ready',station});
    }catch{
      state=invalid;try{location.replace('/404');}catch{/* no playback or alternative station is requested */}
      return state;
    }
  }
  function restoreCachedStations(stations){
    if(read().kind!=='none'||!Array.isArray(stations)||stations.length>75000)return false;
    try{
      const location=options.locationImpl||globalThis.location,url=new URL(location.href);
      if(!['https:','http:'].includes(url.protocol)||!['/','/index.html'].includes(url.pathname))return false;
      const id=publicStationId(new URLSearchParams(url.hash.slice(1)).get('station'));if(!id)return false;
      const candidate=stations.find(row=>row?.stationuuid===id);if(!candidate)return false;
      const row=Object.fromEntries(STATION_RECORD_FIELDS.filter(key=>candidate[key]!==undefined&&candidate[key]!==null&&candidate[key]!=='').map(key=>[key,candidate[key]]));
      row.url||=row.url_resolved;
      for(const key of ['lastcheckok','hls'])if(typeof row[key]==='boolean')row[key]=Number(row[key]);
      validateStationRecordShard({schemaVersion:1,stations:[row]},{records:1});
      state=Object.freeze({kind:'cached',station:Object.freeze(row)});return true;
    }catch{return false;}
  }
  function catalogFallback(normalize){
    const station=read().station;if(!station||typeof normalize!=='function')return null;
    try{
      const row=normalize(station);if(!row||row.stationuuid!==station.stationuuid)return null;
      return{stations:[row],source:'shared-station',partial:'shared-station',cached:false,stale:false};
    }catch{return null;}
  }
  return Object.freeze({read,restoreCachedStations,catalogFallback});
}

const currentEntry=createSharedStationEntry();
export function getSharedStation(){return currentEntry.read().station||null;}
export function restoreCachedSharedStation(stations){return currentEntry.restoreCachedStations(stations);}
export function sharedStationDirectoryFallback(normalize){return currentEntry.catalogFallback(normalize);}
