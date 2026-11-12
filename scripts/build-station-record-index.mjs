import {createHash} from 'node:crypto';
import {STATION_RECORD_FIELDS,STATION_RECORD_MANAGED_BY,STATION_RECORD_MAX_BYTES,STATION_RECORD_MAX_ROWS,validStationRecordId,validateStationRecordManifest,validateStationRecordShard} from '../server/station-record-protocol.mjs';

// Input is the producer's already normalized, public-only rows. Project explicitly
// so future producer fields do not silently become part of a shared link record.
export function buildStationRecordIndex(stations,identity){
  if(!Array.isArray(stations)||!stations.length||stations.length>75000)throw Error('Invalid station record limit');
  const buckets=Array.from({length:256},()=>[]),seen=new Set();
  for(const station of stations){
    if(!validStationRecordId(station?.stationuuid)||seen.has(station.stationuuid))throw Error('Invalid or duplicate station record identity');
    seen.add(station.stationuuid);
    const row=Object.fromEntries(STATION_RECORD_FIELDS.filter(key=>station[key]!==undefined).map(key=>[key,station[key]]));
    const bucket=buckets[createHash('sha256').update(row.stationuuid).digest()[0]];
    bucket.push(row);if(bucket.length>STATION_RECORD_MAX_ROWS)throw Error('Station shard record limit exceeded');
  }
  const files=new Map(),shards=buckets.map(stations=>{
    stations.sort((a,b)=>a.stationuuid<b.stationuuid?-1:a.stationuuid>b.stationuuid?1:0);
    const value={schemaVersion:1,stations},bytes=Buffer.from(JSON.stringify(value)+'\n');
    if(bytes.length>STATION_RECORD_MAX_BYTES)throw Error('Station shard byte limit exceeded');
    const sha256=createHash('sha256').update(bytes).digest('hex'),path=`station-records/${sha256}.json`;
    const descriptor={path,sha256,bytes:bytes.length,records:stations.length};
    validateStationRecordShard(value,descriptor);files.set(path,bytes);return descriptor;
  });
  const manifest={schemaVersion:1,managedBy:STATION_RECORD_MANAGED_BY,generatedAt:identity.generatedAt,producerVersion:identity.producerVersion,producerSourceSha:identity.producerSourceSha,identities:stations.length,shards};
  validateStationRecordManifest(manifest,{now:Date.parse(identity.generatedAt)});
  return{manifest,files};
}
