// Small public station lookups, independent of the existing schema2 boot catalog.
export const STATION_RECORD_MANAGED_BY='earthradio.station-links.v1';
export const STATION_RECORD_MAX_BYTES=256*1024;
export const STATION_RECORD_MAX_ROWS=1024;
export const STATION_RECORD_MANIFEST_MAX_BYTES=64*1024;
export const STATION_RECORD_FIELDS=Object.freeze(['stationuuid','name','url','url_resolved','homepage','favicon','country','countrycode','state','city','tags','language','codec','bitrate','clickcount','votes','lastcheckok','lastchecktime','lastcheckoktime','hls','transport','geo_lat','geo_long','countryProvenance']);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&Object.keys(value).every(key=>expected.includes(key));
const urlFields=['url','url_resolved','homepage','favicon'];
// publicUrl() limits raw normalized text to4096 UTF-16 units before URL.href.
// Percent encoding can use nine ASCII units for one three-byte BMP character;
// allow that output plus a canonical trailing slash, retaining the shard byte cap.
const maxUrlChars=9*4096+1;
export const validStationRecordId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);

export function validateStationRecordManifest(value,{now=Date.now()}={}){
  if(!keys(value,['schemaVersion','managedBy','generatedAt','producerVersion','producerSourceSha','identities','shards'])||value.schemaVersion!==1||value.managedBy!==STATION_RECORD_MANAGED_BY||!/^\d+\.\d+\.\d+$/.test(value.producerVersion||'')||!/^[a-f0-9]{40}$/.test(value.producerSourceSha||''))throw Error('Invalid station manifest identity');
  const generated=Date.parse(value.generatedAt);
  if(!Number.isFinite(generated)||generated<Date.UTC(2020,0,1)||generated>now+300000||new Date(generated).toISOString()!==value.generatedAt)throw Error('Invalid station generation time');
  if(!integer(value.identities,75000)||!value.identities||!Array.isArray(value.shards)||value.shards.length!==256)throw Error('Invalid station record count');
  let total=0;const paths=new Map();
  for(const item of value.shards){
    if(!keys(item,['path','sha256','bytes','records'])||!/^[a-f0-9]{64}$/.test(item.sha256||'')||item.path!==`station-records/${item.sha256}.json`||!integer(item.bytes,STATION_RECORD_MAX_BYTES)||item.bytes<2||!integer(item.records,STATION_RECORD_MAX_ROWS))throw Error('Invalid station shard descriptor');
    const previous=paths.get(item.path);
    if(previous&&(previous.bytes!==item.bytes||previous.records!==item.records))throw Error('Inconsistent station shard descriptor');
    paths.set(item.path,item);
    total+=item.records;
  }
  if(total!==value.identities)throw Error('Inconsistent station record count');
  if(new TextEncoder().encode(JSON.stringify(value)).length>STATION_RECORD_MANIFEST_MAX_BYTES)throw Error('Station manifest byte limit exceeded');
  return value;
}

export function validateStationRecordShard(value,descriptor){
  if(!keys(value,['schemaVersion','stations'])||value.schemaVersion!==1||!Array.isArray(value.stations)||value.stations.length!==descriptor.records||value.stations.length>STATION_RECORD_MAX_ROWS)throw Error('Invalid station shard record count');
  let previous='';
  for(const row of value.stations){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!STATION_RECORD_FIELDS.includes(key))||!validStationRecordId(row.stationuuid)||compare(row.stationuuid,previous)<=0||typeof row.name!=='string'||!row.name.trim())throw Error('Invalid or duplicate station record');
    previous=row.stationuuid;
    for(const[key,entry]of Object.entries(row)){
      if(['bitrate','clickcount','votes','lastcheckok','hls'].includes(key)){
        if(!integer(entry,key==='bitrate'?1536:['lastcheckok','hls'].includes(key)?1:1e9))throw Error('Invalid station numeric field');
      }else if(['geo_lat','geo_long'].includes(key)){
        if(typeof entry!=='number'||!Number.isFinite(entry)||Math.abs(entry)>(key==='geo_lat'?90:180))throw Error('Invalid station coordinate');
      }else if(typeof entry!=='string'||entry.length>(urlFields.includes(key)?maxUrlChars:4096))throw Error('Invalid station text field');
    }
    for(const key of urlFields)if(row[key]!==undefined){
      let url;try{url=new URL(row[key]);}catch{throw Error('Invalid station URL');}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('Invalid station URL');
    }
    if(!row.url)throw Error('Missing station URL');
  }
  return value;
}
