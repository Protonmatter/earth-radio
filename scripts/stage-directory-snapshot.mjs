import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateSnapshotManifest} from '../site/assets/snapshot-protocol.js';
import {STATION_RECORD_MANIFEST_MAX_BYTES,validateStationRecordManifest,validateStationRecordShard} from '../server/station-record-protocol.mjs';

// Validate the entire generation before creating the deployable artifact. Only
// manifest-referenced, content-addressed files enter the static site.
export async function stageDirectorySnapshot(input,output){
  const buildRoot=path.resolve('.build')+path.sep,source=path.resolve(input),target=path.resolve(output);
  if(!source.startsWith(buildRoot)||!target.startsWith(buildRoot)||source===target)throw Error('Directory artifacts must use distinct .build paths');
  const manifest=validateSnapshotManifest(JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8')));
  let stationManifest;
  const stationPath=path.join(source,'station-manifest.json');
  let stationInfo;try{stationInfo=await lstat(stationPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(stationInfo){
    if(!stationInfo.isFile()||stationInfo.isSymbolicLink()||stationInfo.size>STATION_RECORD_MANIFEST_MAX_BYTES)throw Error('Invalid station manifest file');
    stationManifest=validateStationRecordManifest(JSON.parse(await readFile(stationPath,'utf8')));
    if(['generatedAt','producerSourceSha','producerVersion'].some(key=>stationManifest[key]!==manifest[key]))throw Error('Station manifest generation identity mismatch');
  }
  const descriptors=[...Object.values(manifest.files),...Object.values(manifest.byCountry).flatMap(value=>Object.values(value))];
  if(stationManifest)descriptors.push(...stationManifest.shards);
  for(const folder of ['snapshots',...(stationManifest?['station-records']:[])]){
    const info=await lstat(path.join(source,folder));
    if(!info.isDirectory()||info.isSymbolicLink())throw Error('Invalid snapshot artifact directory');
  }
  const payload=new Map(),stationRows=new Map();let bytes=0;
  for(const descriptor of descriptors){
    if(payload.has(descriptor.path))continue;
    const filename=path.join(source,descriptor.path),info=await lstat(filename);
    if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid snapshot artifact file');
    if(info.size!==descriptor.bytes)throw Error('Snapshot artifact hash mismatch');
    const data=await readFile(filename);
    if(data.length!==descriptor.bytes||createHash('sha256').update(data).digest('hex')!==descriptor.sha256)throw Error('Snapshot artifact hash mismatch');
    if(descriptor.path.startsWith('station-records/'))stationRows.set(descriptor.path,validateStationRecordShard(JSON.parse(data),descriptor).stations);
    bytes+=data.length;if(bytes>128*1024*1024)throw Error('Snapshot artifact total byte limit exceeded');
    payload.set(descriptor.path,data);
  }
  if(stationManifest)for(const[bucket,descriptor]of stationManifest.shards.entries())for(const row of stationRows.get(descriptor.path)){
    if(createHash('sha256').update(row.stationuuid).digest()[0]!==bucket)throw Error('Station record bucket identity mismatch');
  }
  await mkdir(path.dirname(target),{recursive:true});
  await mkdir(target);
  await mkdir(path.join(target,'snapshots'));
  if(stationManifest)await mkdir(path.join(target,'station-records'));
  for(const[name,data]of payload)await writeFile(path.join(target,name),data,{flag:'wx'});
  await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest)+'\n',{flag:'wx'});
  if(stationManifest)await writeFile(path.join(target,'station-manifest.json'),JSON.stringify(stationManifest)+'\n',{flag:'wx'});
  await writeFile(path.join(target,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Earth Radio directory data</title><h1>Earth Radio directory data</h1><p>Scheduled, normalized public station metadata from <a href="https://www.radio-browser.info/">Radio Browser</a>. No audio or account data is hosted here.</p><p><a href="https://app.earthradio.stream/">Open Earth Radio</a> · <a href="https://github.com/Protonmatter/earth-radio">Source and operations</a></p></html>\n',{flag:'wx'});
  return{files:payload.size+(stationManifest?3:2),bytes,generatedAt:manifest.generatedAt,producerSourceSha:manifest.producerSourceSha,...(stationManifest?{stationIdentities:stationManifest.identities}: {})};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{console.log(JSON.stringify(await stageDirectorySnapshot(process.argv[2],process.argv[3])));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
