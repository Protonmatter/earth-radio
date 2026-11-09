import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const EXPECTED=new Set(['index.html','styles.css','website.js','release-core.js','_headers','_redirects','robots.txt','sitemap.xml','images/radio-player.png','images/listening-map.png','privacy.html','images/earth-radio-og.png','images/earth-radio-favicon-16.png','images/earth-radio-favicon-32.png','images/earth-radio-favicon.svg','images/earth-radio-apple-touch-icon-180.png','images/earth-radio-logo.svg','asset-manifest.json']);
async function walk(root,prefix=''){
  const files=[];for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){
    if(entry.isSymbolicLink())throw new Error('Website artifact contains a symbolic link');const relative=path.posix.join(prefix,entry.name);
    if(entry.isDirectory())files.push(...await walk(root,relative));else if(entry.isFile())files.push(relative);
  }return files;
}
export async function validateWebsite(root){
  root=path.resolve(root);const files=await walk(root),set=new Set(files);
  for(const file of files)if(!EXPECTED.has(file))throw new Error(`Unexpected static website artifact: ${file}`);
  for(const file of EXPECTED)if(!set.has(file))throw new Error(`Missing website artifact: ${file}`);
  for(const file of files.filter(file=>/\.(html|js|css|json|xml|txt)$/.test(file))){
    const text=await readFile(path.join(root,file),'utf8');
    if(/localhost|127\.0\.0\.1|file:\/\/|[A-Za-z]:\\Users\\|sb_secret_|-----BEGIN[^\n]*PRIVATE KEY|(?:access_token|refresh_token)\s*:/i.test(text))throw new Error(`Forbidden local/secret reference in website ${file}`);
  }
  const html=await readFile(path.join(root,'index.html'),'utf8');
  if((html.match(/<h1\b/gi)||[]).length!==1||/<iframe|<form|serviceWorker\.register/i.test(html))throw new Error('Website must have one primary heading and no embedded app/login/worker');
  for(const page of ['index.html','privacy.html']){
    const text=await readFile(path.join(root,page),'utf8');
    for(const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/gi)){
      if(/^(?:https?:|mailto:|data:|#)/.test(match[1]))continue;
      const url=new URL(match[1],'https://earthradio.stream/'),raw=decodeURIComponent(url.pathname).replace(/^\//,''),relative=raw===''?'index.html':raw==='privacy'?'privacy.html':raw;
      if(!set.has(relative))throw new Error(`Missing website reference: ${relative}`);
    }
  }
  if(!/<meta property="og:image" content="https:\/\/earthradio\.stream\/images\/earth-radio-og\.png"/.test(html))throw new Error('Website social preview must use the 1200x630 brand card');
  if(!/<link rel="icon" type="image\/svg\+xml"/.test(html)||!/<link rel="apple-touch-icon"/.test(html))throw new Error('Website must declare SVG and Apple touch icons');
  const headers=await readFile(path.join(root,'_headers'),'utf8');
  for(const required of ["frame-ancestors 'none'",'Strict-Transport-Security: max-age=31536000',"script-src 'self'",'https://api.github.com'])if(!headers.includes(required))throw new Error(`Missing website header: ${required}`);
  if(/immutable/i.test(headers))throw new Error('Unfingerprinted website assets must revalidate');
  const redirects=await readFile(path.join(root,'_redirects'),'utf8');
  if(redirects.split(/\r?\n/).some(line=>/^https?:\/\//i.test(line.trim())))throw new Error('Unsupported hostname source in Pages redirects; use the exact-host zone rule');
  if(!redirects.includes('Earth Radio www to apex'))throw new Error('Missing documented canonical zone redirect');
  return {files:files.sort()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await validateWebsite(process.argv[2]||path.resolve(import.meta.dirname,'../.build/website'));process.stdout.write(`Validated ${result.files.length} static website artifacts.\n`);
}
