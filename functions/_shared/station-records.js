import {fetchPublic,readBodyCapped} from './guarded-fetch.js';
import {SNAPSHOT_ROOT} from '../../site/assets/snapshot-protocol.js';
import {STATION_RECORD_FIELDS,STATION_RECORD_MANIFEST_MAX_BYTES,validateStationRecordManifest,validateStationRecordShard} from '../../server/station-record-protocol.mjs';
import {LISTEN_MOE_STATIONS} from '../../site/assets/direct-stations.js';
import {publicStationId} from '../../site/assets/sharing-core.js';

const REFRESH_MS=5*60*1000,MAX_STALE_MS=7*86400000;
const unavailable=()=>Object.assign(new Error('Station metadata temporarily unavailable'),{code:'STATION_METADATA_UNAVAILABLE'});
const missing=()=>Object.assign(new Error('Published station shard removed'),{code:'STATION_SHARD_MISSING'});
async function digestBytes(bytes,cryptoImpl,deadlineAt){
  const remaining=deadlineAt-Date.now();if(remaining<=0)throw unavailable();let timer;
  try{return new Uint8Array(await Promise.race([
    Promise.resolve().then(()=>cryptoImpl.subtle.digest('SHA-256',bytes)),
    new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(unavailable()),remaining);})
  ]));}finally{clearTimeout(timer);}
}
const digest=async(bytes,cryptoImpl,deadlineAt)=>[...await digestBytes(bytes,cryptoImpl,deadlineAt)].map(value=>value.toString(16).padStart(2,'0')).join('');
const directRows=new Map(LISTEN_MOE_STATIONS.map(station=>[station.stationuuid,Object.freeze(Object.fromEntries(STATION_RECORD_FIELDS.filter(key=>station[key]!==undefined).map(key=>[key,station[key]])))]));

// Only immutable parsed public data crosses requests. Each lookup owns its fetch,
// response, body reader, deadline and attempt budget; no shared I/O promises.
export function createStationRecordReader({fetchImpl=globalThis.fetch,now=Date.now,cryptoImpl=globalThis.crypto,timeoutMs=5000}={}){
  if(typeof fetchImpl!=='function'||typeof now!=='function'||typeof cryptoImpl?.subtle?.digest!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw TypeError('Invalid station metadata reader options');
  let storedManifest=null,manifestRetryAt=0,activeFetches=0;
  const shards=new Map();

  async function jsonFile(path,maxBytes,operation,{force=false,shard=false}={}){
    if(activeFetches>=4)throw unavailable();
    activeFetches++;
    try{
      const response=await fetchPublic(new URL(path,SNAPSHOT_ROOT).href,{
        deadlineAt:operation.deadlineAt,maxRedirects:0,attemptBudget:operation.attempts,
        headers:{Accept:'application/json','User-Agent':'EarthRadioStationLinks/0.37 (+https://app.earthradio.stream/)',...(force?{'Cache-Control':'no-cache'}:{})},
        fetchImpl:(url,options)=>fetchImpl(url,{...options,credentials:'omit',referrerPolicy:'no-referrer'})
      });
      if(response.status!==200){void response.body?.cancel().catch(()=>{});throw shard&&response.status===404?missing():unavailable();}
      if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw unavailable();}
      // Read one extra byte so an appended suffix cannot hide behind a valid hash
      // of the prefix. The shared reader intentionally permits partial reads.
      const bytes=await readBodyCapped(response,{maxBytes:maxBytes+1,deadlineAt:operation.deadlineAt});
      if(bytes.length>maxBytes)throw unavailable();
      return{bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
    }finally{activeFetches--;}
  }

  function usable(stored){
    const time=now(),generation=stored&&Date.parse(stored.value.generatedAt);
    return stored&&Number.isFinite(time)&&time>=generation-300000&&time-generation<=MAX_STALE_MS;
  }

  async function manifest(operation,force=false){
    if(!force&&usable(storedManifest)&&now()-storedManifest.savedAt<REFRESH_MS)return storedManifest.value;
    if(!force&&now()<manifestRetryAt){if(usable(storedManifest))return storedManifest.value;throw unavailable();}
    try{
      const {value}=await jsonFile('station-manifest.json',STATION_RECORD_MANIFEST_MAX_BYTES,operation,{force});
      validateStationRecordManifest(value,{now:now()});
      if(now()-Date.parse(value.generatedAt)>MAX_STALE_MS)throw unavailable();
      for(const descriptor of value.shards)Object.freeze(descriptor);Object.freeze(value.shards);Object.freeze(value);
      storedManifest={value,savedAt:now()};manifestRetryAt=0;return value;
    }catch(error){
      manifestRetryAt=now()+60000;
      if(!force&&usable(storedManifest))return storedManifest.value;
      throw error;
    }
  }

  async function shard(descriptor,operation){
    const cached=shards.get(descriptor.path);
    if(cached){
      if(cached.bytes!==descriptor.bytes||cached.value.stations.length!==descriptor.records)throw unavailable();
      shards.delete(descriptor.path);shards.set(descriptor.path,cached);return cached.value;
    }
    const {bytes,value}=await jsonFile(descriptor.path,descriptor.bytes,operation,{shard:true});
    if(bytes.length!==descriptor.bytes||await digest(bytes,cryptoImpl,operation.deadlineAt)!==descriptor.sha256)throw unavailable();
    validateStationRecordShard(value,descriptor);
    for(const row of value.stations)Object.freeze(row);Object.freeze(value.stations);Object.freeze(value);
    shards.set(descriptor.path,{value,bytes:bytes.length});while(shards.size>4)shards.delete(shards.keys().next().value);
    return value;
  }

  async function lookup(value){
    const id=publicStationId(value);if(!id)return null;
    if(directRows.has(id))return directRows.get(id);
    const operation={deadlineAt:Date.now()+timeoutMs,attempts:{remaining:4}};
    try{
      const bucket=(await digestBytes(new TextEncoder().encode(id),cryptoImpl,operation.deadlineAt))[0];
      for(let attempt=0;attempt<2;attempt++){
        const index=await manifest(operation,attempt>0),descriptor=index.shards[bucket];
        try{
          const data=await shard(descriptor,operation);
          return data.stations.find(row=>row.stationuuid===id)||null;
        }catch(error){
          if(error.code!=='STATION_SHARD_MISSING'||attempt)throw error;
          storedManifest=null;
        }
      }
    }catch{throw unavailable();}
    throw unavailable();
  }
  return Object.freeze({lookup});
}
