import {createHash} from 'node:crypto';
import {copyFile,lstat,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateWebsite} from './validate-website.mjs';

export const WEBSITE_FILES=Object.freeze(['index.html','styles.css','website.js','release-core.js','_headers','_redirects','robots.txt','sitemap.xml','images/radio-player.png','images/listening-map.png']);
const defaultRoot=path.resolve(import.meta.dirname,'..');
function childOf(parent,child){const relative=path.relative(parent,child);return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`);}
async function regular(file,bound){const metadata=await lstat(file);if(metadata.isSymbolicLink()||!metadata.isFile()||!childOf(await realpath(bound),await realpath(file)))throw new Error(`Expected a regular source file within its public source directory: ${path.basename(file)}`);}
export async function stageWebsite({root=defaultRoot,output,cloudflare=false}={}){
  root=path.resolve(root);const source=path.join(root,'website'),parent=cloudflare?source:path.join(root,'.build');
  const expectedOutput=path.join(parent,cloudflare?'.build':'website');
  output=path.resolve(output||expectedOutput);
  if(output!==expectedOutput)throw new Error('Website output is outside the allowed build directory');
  const sourceMetadata=await lstat(source);if(sourceMetadata.isSymbolicLink()||!sourceMetadata.isDirectory())throw new Error('Website source must be a regular directory');
  for(const forbidden of ['functions','_worker.js']){
    try{await lstat(path.join(source,forbidden));throw new Error('Website must stay static; unexpected Functions/worker source');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const inputs=[...WEBSITE_FILES.map(relative=>({source:path.join(source,relative),bound:source,path:relative})),
    {source:path.join(root,'site/privacy.html'),bound:path.join(root,'site'),path:'privacy.html'},
    ...[32,512].map(size=>({source:path.join(root,`site/branding/earth-radio-${size}-v2.png`),bound:path.join(root,'site/branding'),path:`images/earth-radio-${size}.png`}))];
  for(const input of inputs){if(!childOf(await realpath(root),await realpath(input.bound)))throw new Error('Public source resolves outside the repository');await regular(input.source,input.bound);}
  await mkdir(parent,{recursive:true});const resolvedParent=await realpath(parent),resolvedRoot=await realpath(root);
  if(!childOf(resolvedRoot,resolvedParent))throw new Error('Website build parent resolves outside the repository');
  try{if((await lstat(output)).isSymbolicLink())throw new Error('Website output must not be a symbolic link');}catch(error){if(error.code!=='ENOENT')throw error;}
  // Both absolute bounds and the resolved parent are checked before replacement.
  await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
  const files=[];
  for(const input of inputs){
    const target=path.join(output,input.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(input.source,target);
    if(input.path==='privacy.html'){
      const privacy=await readFile(target,'utf8');
      await writeFile(target,privacy.replaceAll('href="./icon-192.png"','href="./images/earth-radio-32.png"').replaceAll('https://earth-radio.pages.dev/','https://app.earthradio.stream/'));
    }
    const bytes=await readFile(target);files.push({path:input.path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  await writeFile(path.join(output,'asset-manifest.json'),JSON.stringify({schemaVersion:1,files},null,2)+'\n');
  await validateWebsite(output);return {output,files};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--cloudflare'))throw new Error('Only --cloudflare is supported');
  const result=await stageWebsite({cloudflare:args.includes('--cloudflare')});process.stdout.write(`Staged ${result.files.length} static website files.\n`);
}
