import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeDirectory} from '../server/directory-normalize.mjs';
import {groupStationVariants,serializeVariantGroups,expandVariantGroups} from '../site/assets/station-variants.js';
import {createDirectoryHosts} from '../site/assets/directory-hosts.js';
import {SNAPSHOT_MANAGED_BY,validateSnapshotManifest} from '../site/assets/snapshot-protocol.js';
import {requestPublic} from '../server/net-guard.mjs';
import {selectDirectoryPlaces} from './directory-place-selection.mjs';
import {CURATED_PLACES} from '../site/assets/curated-places.js';
import {cityProgramChoices} from '../site/assets/today-core.js';

export function buildDirectoryGeneration(input,{generatedAt=new Date().toISOString(),producerSourceSha,producerVersion='0.32.0',servers=[],minimumRecords=1000,minimumCountries=20,globalLimit=10000,countryLimit=1000,minimumCityPrograms=5}={}){
  if(!Number.isInteger(globalLimit)||globalLimit<1||globalLimit>10000||!Number.isInteger(countryLimit)||countryLimit<1||countryLimit>1000)throw Error('Invalid snapshot limits');
  const normalized=normalizeDirectory(input),all=normalized.stations;
  const buckets=new Map();for(const station of all)if(station.countrycode){if(!buckets.has(station.countrycode))buckets.set(station.countrycode,[]);buckets.get(station.countrycode).push(station);}
  if(all.length<minimumRecords||!all.length||buckets.size<minimumCountries)throw Error('Snapshot minimum record/country guard failed');
  const files=new Map(),put=(value,records)=>{
    const bytes=Buffer.from(JSON.stringify(value)+'\n'),sha256=createHash('sha256').update(bytes).digest('hex'),name=`snapshots/${sha256}.json`;
    files.set(name,bytes);return{path:name,sha256,bytes:bytes.length,records};
  };
  const views=rows=>({catalog:put({schemaVersion:2,groups:serializeVariantGroups(rows)},rows.length),legacy:put(rows,rows.length)});
  const {stations:global,...placeSelection}=selectDirectoryPlaces(all,{globalLimit,minimumCityPrograms});
  const globalGroups=groupStationVariants(global),primary=views(global);
  if(minimumCityPrograms){
    const grouped=expandVariantGroups(JSON.parse(files.get(primary.catalog.path)).groups);
    placeSelection.groupedCoverage=CURATED_PLACES.map(city=>({cityId:city.id,city:city.name,selectedPrograms:cityProgramChoices(grouped,city.id,{secureOnly:false}).length}));
    for(const city of placeSelection.groupedCoverage)if(city.selectedPrograms<minimumCityPrograms)throw Error(`Grouped ${city.city} has ${city.selectedPrograms} qualified programs; minimum ${minimumCityPrograms}`);
  }
  const byCountry={},countries=[];
  for(const[code,rows]of [...buckets].sort(([a],[b])=>a.localeCompare(b,'en'))){
    byCountry[code]=views(rows.slice(0,countryLimit));
    countries.push({name:rows[0].country,iso_3166_1:code,stationcount:groupStationVariants(rows).length,streamcount:rows.length});
  }
  const safeServers=[...new Set(servers.map(item=>typeof item==='string'?item:item?.name).filter(name=>/^[a-z0-9][a-z0-9-]{0,30}\.api\.radio-browser\.info$/.test(name||'')))].sort().map(name=>({name}));
  const manifest={schemaVersion:2,managedBy:SNAPSHOT_MANAGED_BY,generatedAt,producerVersion,producerSourceSha,
    totals:{identities:global.length,stations:globalGroups.length,streams:globalGroups.reduce((sum,group)=>sum+group.variants.length,0),httpOnlyStations:globalGroups.filter(group=>group.variants.every(v=>v.url.startsWith('http:'))).length},
    normalization:normalized.stats,
    files:{...primary,countries:put(countries,countries.length),servers:put(safeServers,safeServers.length),emptyCatalog:put({schemaVersion:2,groups:[]},0),emptyLegacy:put([],0)},byCountry};
  validateSnapshotManifest(manifest,{now:Date.parse(generatedAt)});
  if(Buffer.byteLength(JSON.stringify(manifest))>128*1024)throw Error('Snapshot manifest exceeds byte budget');
  return{manifest,files,report:{...normalized.stats,placeSelection,logicalStations:manifest.totals.stations,streams:manifest.totals.streams,files:files.size,legacyBytes:primary.legacy.bytes,catalogBytes:primary.catalog.bytes}};
}

export async function fetchDirectoryForPublication({timeoutMs=120000,requestImpl=requestPublic}={}){
  const deadlineAt=Date.now()+timeoutMs;
  const guarded=async(url,options={})=>{
    const discovery=url.endsWith('/json/servers'),deadline=discovery?Math.min(deadlineAt,Date.now()+4000):deadlineAt;
    const result=await requestImpl(url,{signal:options.signal,deadlineAt:deadline,timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:discovery?65536:16*1024*1024,maxRedirects:0,headers:{Accept:'application/json','User-Agent':'EarthRadioSnapshotProducer/0.32 (+https://github.com/Protonmatter/earth-radio)'}});
    return new Response(result.body,{status:result.statusCode,headers:result.headers});
  };
  const hosts=createDirectoryHosts({fetchImpl:guarded});let lastError;
  const discovered=await hosts.discover(),attempted=new Set();
  for(let attempt=0;attempt<3;attempt++){
    if(Date.now()>=deadlineAt)break;
    const pool=await hosts.discover(),host=pool.find(value=>!attempted.has(value));
    if(!host)break;
    attempted.add(host);
    try{
      const rows=[],seenPages=new Set(),seenIds=new Set();let complete=false;
      for(let offset=0;offset<75000;offset+=10000){
        if(Date.now()>=deadlineAt)throw Error('Directory pagination deadline exceeded');
        const limit=Math.min(10000,75000-offset);
        const response=await guarded(host+'/json/stations/search?'+new URLSearchParams({hidebroken:'true',order:'name',reverse:'false',limit:String(limit),offset:String(offset)}));
        if(!response.ok)throw Error('Directory upstream HTTP '+response.status);
        const page=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await response.arrayBuffer()));
        if(!Array.isArray(page)||page.length>limit)throw Error('Invalid directory pagination limit');
        const pageHash=createHash('sha256').update(JSON.stringify(page.map(row=>row?.stationuuid))).digest('hex');
        if(page.length&&seenPages.has(pageHash))throw Error('Directory repeated pagination page');
        for(const row of page){const uuid=row?.stationuuid;if(typeof uuid!=='string'||!uuid||seenIds.has(uuid))throw Error('Directory pagination contains duplicate or missing identities');seenIds.add(uuid);}
        seenPages.add(pageHash);rows.push(...page);
        if(page.length<limit){complete=true;break;}
      }
      if(!complete)throw Error('Directory pagination limit reached before completion');
      if(rows.length<1000)throw Error('Invalid bulk directory record count');
      return{rows,servers:[...new Set([...discovered,...pool])].map(value=>new URL(value).hostname)};
    }catch(error){lastError=error;hosts.failed(host);}
  }
  throw lastError||Error('Bulk directory unavailable');
}

export async function writeDirectoryGeneration(generation,output){
  const root=path.resolve(output),workspace=path.resolve('.build');
  if(!root.startsWith(workspace+path.sep))throw Error('Snapshot output must be inside .build');
  await mkdir(path.join(root,'snapshots'),{recursive:true});
  for(const[name,bytes]of generation.files)await writeFile(path.join(root,name),bytes,{flag:'wx'});
  await writeFile(path.join(root,'manifest.json'),JSON.stringify(generation.manifest,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(root,'report.json'),JSON.stringify(generation.report,null,2)+'\n',{flag:'wx'});
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2),output=args[0]||'.build/directory-generation';
    const inputIndex=args.indexOf('--input');
    const source=inputIndex>=0?{rows:JSON.parse(await readFile(args[inputIndex+1],'utf8')),servers:[]}:await fetchDirectoryForPublication();
    const producerSourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const generation=buildDirectoryGeneration(source.rows,{producerSourceSha,servers:source.servers,minimumCityPrograms:5});
    await writeDirectoryGeneration(generation,output);console.log(JSON.stringify({output:path.resolve(output),generatedAt:generation.manifest.generatedAt,...generation.report}));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
