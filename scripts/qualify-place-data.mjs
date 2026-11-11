// Offline qualification only. Reads one explicit local public snapshot; no fetch,
// DNS, account access or mutation of the current directory/selection is performed.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expandVariantGroups} from '../site/assets/station-variants.js';
import {programComponents} from '../site/assets/program-components.js';
import {streamIdentity} from '../site/assets/discovery-core.js';
import {stationPlace,CITY_EVIDENCE_RADIUS_KM} from '../site/assets/place-core.js';
import {CURATED_PLACES} from '../site/assets/curated-places.js';

export const MAX_PLACE_INPUT_BYTES=16*1024*1024;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const canonicalId=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value.toLowerCase():value;
function suppliedMetadata(value){
 const generatedAt=value?.generatedAt,producerSourceSha=value?.producerSourceSha;
 if(generatedAt===undefined&&producerSourceSha===undefined)return null;
 if(typeof generatedAt!=='string'||!Number.isFinite(Date.parse(generatedAt))||new Date(generatedAt).toISOString()!==generatedAt||typeof producerSourceSha!=='string'||!/^[a-f0-9]{40}$/.test(producerSourceSha))throw Error('Invalid supplied generation/source metadata');
 return{generatedAt,producerSourceSha};
}
function snapshotRecords(value){
 let serialized;try{serialized=JSON.stringify(value);}catch(error){throw Error('Snapshot must be bounded JSON data',{cause:error});}
 if(typeof serialized!=='string')throw Error('Invalid snapshot JSON');
 if(Buffer.byteLength(serialized)>MAX_PLACE_INPUT_BYTES)throw Error('Snapshot byte budget exceeds 16 MiB');
 let rows;
 if(Array.isArray(value)){if(value.length>10000)throw Error('Snapshot record budget exceeded');rows=value;}
 else if(value?.schemaVersion===2&&Array.isArray(value.groups))rows=expandVariantGroups(value.groups,{maxGroups:10000,maxRecords:10000});
 else throw Error('Expected a legacy array or schema2 station snapshot');
 if(!rows.length)throw Error('Empty station snapshot');
 const records=rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.stationuuid!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(row.stationuuid)||['constructor','prototype'].includes(row.stationuuid)||typeof row.name!=='string'||!row.name.trim()||row.name.length>160||/[\u0000-\u001f\u007f]/.test(row.name))throw Error('Invalid station identity/name in snapshot');
  if(row.countrycode!=null&&(typeof row.countrycode!=='string'||row.countrycode!==''&&!/^[A-Za-z]{2}$/.test(row.countrycode)))throw Error('Invalid station country in snapshot');
  for(const field of ['state','city'])if(row[field]!=null&&(typeof row[field]!=='string'||row[field].length>128))throw Error('Invalid station place field in snapshot');
  const url=row.url_resolved||row.url;if(typeof url!=='string'||url.length>4096||!streamIdentity(row))throw Error('Invalid station stream in snapshot');
  // Only the bounded fields needed for grouping/place evidence reach the model.
  // Tags, artwork, arbitrary nested metadata and source URLs never enter reports.
  return{stationuuid:row.stationuuid,name:row.name,countrycode:String(row.countrycode||'').toUpperCase(),state:row.state||'',city:row.city||'',geo_lat:row.geo_lat,geo_long:row.geo_long,url:streamIdentity(row)};
 });
 const observations=new Map();
 for(const record of records){
  const id=canonicalId(record.stationuuid),observation=JSON.stringify({...record,stationuuid:id});
  if(observations.has(id)&&observations.get(id)!==observation)throw Error('Conflicting duplicate station identity; supply a normalized single-generation snapshot');
  observations.set(id,observation);
 }
 return records;
}

export function qualifyPlaceData(snapshot){
 const rows=snapshotRecords(snapshot),metadata=suppliedMetadata(Array.isArray(snapshot)?null:snapshot);
 const {groups,components:programs,identityCount}=programComponents(rows);
 const components=programs.map(component=>component.map(row=>({row,place:stationPlace(row)})));
 const confidenceCounts={city:0,exact:0,country:0,unknown:0,ambiguous:0},counts=new Map(CURATED_PLACES.map(city=>[city.id,[]]));let partial=0;
 for(const component of components){
  const countries=new Set(component.map(item=>item.place?.countrycode).filter(Boolean)),cities=new Set(component.map(item=>item.place?.cityId).filter(Boolean));
  if(countries.size>1||cities.size>1){confidenceCounts.ambiguous++;continue;}
  if(cities.size===1){
   const id=[...cities][0],examples=[...new Set(component.filter(item=>item.place?.cityId===id).map(item=>canonicalId(item.row.stationuuid)))].sort(compare);
   counts.get(id).push(examples[0]);confidenceCounts.city++;
   if(component.some(item=>item.place?.confidence!=='city'))partial++;
  }else if(component.some(item=>item.place?.confidence==='exact'))confidenceCounts.exact++;
  else if(countries.size)confidenceCounts.country++;
  else confidenceCounts.unknown++;
 }
 const cities=CURATED_PLACES.map(city=>{const examples=counts.get(city.id).sort(compare);return{id:city.id,name:city.name,countrycode:city.countrycode,timeZone:city.timeZone,programs:examples.length,meetsFiveProgramMinimum:examples.length>=5,exampleStationIds:examples.slice(0,5)};});
 return{schemaVersion:1,suppliedMetadata:metadata,inputRecords:rows.length,directoryGroups:groups.length,programs:components.length,duplicateIdentityRows:rows.length-identityCount,confidenceCounts,cityProgramsWithPartialVariantEvidence:partial,cities,allCuratedCitiesMeetFiveProgramMinimum:cities.every(city=>city.meetsFiveProgramMinimum),criteria:'One count per station-family/shared-stream component. At least one corroborated variant supports a city; conflicting supported cities/countries are excluded. Supplied generation metadata is not an independent source-verification claim.'};
}

export async function qualifyPlaceFile(file){
 let entry;try{entry=await lstat(file);}catch(error){throw Error('Cannot read local snapshot input',{cause:error});}
 if(!entry.isFile()||entry.isSymbolicLink())throw Error('Snapshot input must be a regular local file');
 if(entry.size>MAX_PLACE_INPUT_BYTES)throw Error('Snapshot byte budget exceeds 16 MiB');
 const chunks=[];let size=0;const stream=createReadStream(file);
 try{for await(const chunk of stream){size+=chunk.length;if(size>MAX_PLACE_INPUT_BYTES)throw Error('Snapshot byte budget exceeds 16 MiB');chunks.push(chunk);}}
 finally{stream.destroy();}
 const bytes=Buffer.concat(chunks);let value;
 try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(error){throw Error('Invalid snapshot JSON',{cause:error});}
 const modelFiles=['site/assets/place-core.js','site/assets/curated-places.js','site/assets/station-location.js','site/assets/country-locations.js','site/assets/station-variants.js','site/assets/search-core.js','site/assets/discovery-core.js','site/assets/program-components.js','scripts/qualify-place-data.mjs','docs/provenance/place-data.json','docs/provenance/place-selection.json'];
 const root=new URL('../',import.meta.url),files=[];
 for(const relative of modelFiles){const source=await readFile(new URL(relative,root));files.push({path:relative,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')});}
 return{...qualifyPlaceData(value),input:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},model:{candidateRadiusKm:CITY_EVIDENCE_RADIUS_KM,files,runtime:{node:process.versions.node,icu:process.versions.icu,timeZoneData:process.versions.tz,platform:process.platform,architecture:process.arch}}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--input'||!args[1])throw Error('Usage: qualify-place-data.mjs --input LOCAL_PUBLIC_SNAPSHOT.json');process.stdout.write(JSON.stringify(await qualifyPlaceFile(args[1]),null,2)+'\n');}
 catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
