// Explicit operator step after public download qualification. No network access
// or credential handling; the input is the owned repository's public release JSON.
import {readFile,stat,writeFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishedReleaseMetadata,publishedReleaseModule,stampReleaseHtml,parsePublishedReleaseModule} from './release-metadata.mjs';
import {normalizePublicRelease,compareReleaseVersions} from '../website/release-core.js';

export async function setPublishedRelease({root,input,apply=false}){
  if(!input)throw Error('A public release JSON input file is required');
  if((await stat(input)).size>256*1024)throw Error('Public release input exceeds 256 KiB');
  const metadata=publishedReleaseMetadata(JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,''))),release=normalizePublicRelease(metadata);
  const metadataPath=path.join(root,'website/published-release.js'),htmlPath=path.join(root,'website/index.html');
  const resolvedRoot=await realpath(root);
  for(const file of [metadataPath,htmlPath]){
    const entry=await lstat(file),relative=path.relative(resolvedRoot,await realpath(file));
    if(!entry.isFile()||entry.isSymbolicLink()||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Release targets must be regular files inside the repository');
  }
  const [oldMetadata,oldHtml]=await Promise.all([readFile(metadataPath,'utf8'),readFile(htmlPath,'utf8')]);
  const previous=parsePublishedReleaseModule(oldMetadata),previousRelease=normalizePublicRelease(previous);
  if(compareReleaseVersions(release.version,previousRelease.version)<0)throw Error('Refusing to downgrade published release metadata; use the documented Git rollback');
  if(release.tag===previousRelease.tag&&JSON.stringify(previous)!==JSON.stringify(metadata))throw Error('Published asset metadata changed for the same tag; investigate instead of replacing its identity');
  const nextMetadata=publishedReleaseModule(metadata),nextHtml=stampReleaseHtml(oldHtml,release);
  const changes=[[metadataPath,oldMetadata,nextMetadata],[htmlPath,oldHtml,nextHtml]].filter(([_file,before,after])=>before!==after);
  if(apply){
    for(const [file,before] of changes)if(await readFile(file,'utf8')!==before)throw Error('Source changed while preparing the release metadata update');
    for(const [file,_before,after] of changes)await writeFile(file,after);
  }
  return{tag:release.tag,downloads:Object.keys(release.downloads),apply,changedFiles:changes.map(([file])=>path.relative(root,file).replaceAll(path.sep,'/')),
    qualification:'Structural metadata validation only; complete the public-download hash gate before applying.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);if(args[0]!=='--input'||!args[1]||args.length>3||(args[2]&&args[2]!=='--apply'))throw Error('Usage: set-published-release.mjs --input public-release.json [--apply]');
    process.stdout.write(JSON.stringify(await setPublishedRelease({root:path.resolve(import.meta.dirname,'..'),input:path.resolve(args[1]),apply:args[2]==='--apply'}))+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
