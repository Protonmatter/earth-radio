import {normalizePublicRelease} from '../website/release-core.js';

export function publishedReleaseMetadata(raw){
  const release=normalizePublicRelease(raw);
  if(!release)throw Error('Expected a complete stable Earth Radio release with exact public asset URLs');
  if(raw.id!==undefined&&(!Number.isSafeInteger(raw.id)||raw.id<1))throw Error('Invalid public release identifier');
  if(raw.published_at!==undefined&&(typeof raw.published_at!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(raw.published_at)||!Number.isFinite(Date.parse(raw.published_at))))throw Error('Invalid public release date');
  const urls=[...Object.values(release.downloads),release.install,release.checksums];
  const assets=urls.map(url=>{
    const asset=raw.assets.find(value=>value?.browser_download_url===url&&value.name===new URL(url).pathname.split('/').at(-1));
    if(asset.id!==undefined&&(!Number.isSafeInteger(asset.id)||asset.id<1))throw Error('Invalid public asset identifier');
    if(asset.digest!==undefined&&asset.digest!==null&&!/^sha256:[a-f0-9]{64}$/.test(asset.digest))throw Error('Invalid public asset digest');
    return{id:asset.id,name:asset.name,size:asset.size,state:'uploaded',browser_download_url:url,digest:asset.digest};
  });
  return{id:raw.id,tag_name:release.tag,draft:false,prerelease:false,html_url:release.url,published_at:raw.published_at,assets};
}

export function publishedReleaseModule(raw){
  const data=publishedReleaseMetadata(raw);
  return '// Public release metadata. Refresh only after qualifying published downloads.\nconst data = '+JSON.stringify(data,null,2)+';\nexport const PUBLISHED_RELEASE = Object.freeze({...data,assets:Object.freeze(data.assets.map(Object.freeze))});\n';
}

export function parsePublishedReleaseModule(source){
  source=source.replaceAll('\r\n','\n');
  const prefix='// Public release metadata. Refresh only after qualifying published downloads.\nconst data = ';
  const suffix=';\nexport const PUBLISHED_RELEASE = Object.freeze({...data,assets:Object.freeze(data.assets.map(Object.freeze))});\n';
  if(!source.startsWith(prefix)||!source.endsWith(suffix))throw Error('Expected a data-only published release module');
  return publishedReleaseMetadata(JSON.parse(source.slice(prefix.length,-suffix.length)));
}

function attributes(tag){
  const start=tag.match(/^<[a-z][\w:-]*/i)?.[0].length;
  if(!start)throw Error('Invalid release binding tag');
  const body=tag.slice(start,-1),result=new Map();let offset=0;
  const pattern=/([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for(const match of body.matchAll(pattern)){
    if(body.slice(offset,match.index).trim())throw Error('Unsupported release attribute serialization');
    const name=match[1].toLowerCase();if(result.has(name))throw Error('Duplicate release attribute: '+name);
    result.set(name,{value:match[2]??match[3]??match[4]??'',start:start+match.index,end:start+match.index+match[0].length});
    offset=match.index+match[0].length;
  }
  if(body.slice(offset).trim())throw Error('Unsupported release attribute serialization');
  return result;
}
function replaceAttribute(tag,attribute,value){return attribute?tag.slice(0,attribute.start)+value+tag.slice(attribute.end):tag.slice(0,-1)+' '+value+'>';}

export function stampReleaseHtml(html,release){
  // Bind by semantic attributes, never by a previous version string. All URLs
  // come from normalizePublicRelease's exact repository/filename allowlist.
  const values={...release.downloads,install:release.install,checksums:release.checksums,page:release.url};
  const seen=new Set();
  html=html.replace(/<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,tag=>{
    const attrs=attributes(tag),bindings=[];
    if(attrs.has('data-download'))bindings.push(attrs.get('data-download').value);
    for(const key of ['install','checksums','page'])if(attrs.has('data-release-'+key))bindings.push(key);
    if(bindings.length>1)throw Error('Ambiguous release link bindings');
    const key=bindings[0];
    if(!key)return tag;
    seen.add(key);const value=values[key],href=attrs.get('href');
    if(!value){if(!['windowsX64Setup','windowsX64Portable'].includes(key))throw Error('Unknown release binding: '+key);return href?replaceAttribute(tag,href,''):tag;}
    return replaceAttribute(tag,href,`href="${value}"`);
  });
  for(const key of Object.keys(values))if(!seen.has(key))throw Error('Missing release binding: '+key);
  let labels=0;html=html.replace(/(<strong\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)[^<]*(<\/strong>)/gi,(match,start,end)=>{if(!attributes(start).has('data-release-version'))return match;labels++;return start+release.tag+end;});
  if(labels!==1)throw Error('Expected one desktop release version label');
  html=html.replace(/<article\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,tag=>{
    const attrs=attributes(tag);if(attrs.get('data-download-group')?.value!=='windowsX64')return tag;
    const hidden=attrs.get('hidden');return release.downloads.windowsX64Setup?(hidden?replaceAttribute(tag,hidden,''):tag):hidden?tag:replaceAttribute(tag,null,'hidden');
  });
  return html;
}
