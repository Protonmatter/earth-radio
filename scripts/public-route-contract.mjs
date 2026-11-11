// Static Pages prerequisites and optional bounded HTTP readback. No default I/O
// to a deployed service: the caller must supply its public origin explicitly.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const APP='https://app.earthradio.stream/',MARKETING='https://earthradio.stream/';
const absent='/__earth_radio_route_probe_missing__';
function requireValue(condition,message){if(!condition)throw Error(message);}
function canonical(html,expected){return [...html.matchAll(/<link\b[^>]*>/gi)].some(([tag])=>/\brel=["']canonical["']/i.test(tag)&&tag.includes(`href="${expected}"`));}
function noindex(html){return [...html.matchAll(/<meta\b[^>]*>/gi)].some(([tag])=>/\bname=["']robots["']/i.test(tag)&&/\bnoindex\b/i.test(tag));}
function branded404(html){return /data-earth-radio-not-found/.test(html)&&/href=["']\/["']/.test(html)&&noindex(html)&&!/<script\b/i.test(html);}
function marketingCrawlAllowed(robots){return !/^[\t ]*Disallow[\t ]*:[\t ]*\/[\t ]*(?:#.*)?$/im.test(robots);}
export async function validateRouteArtifacts(root,{kind='app'}={}){
  requireValue(['app','marketing'].includes(kind),'Unknown route contract kind');
  const [html,missing,robots]=await Promise.all(['index.html','404.html','robots.txt'].map(file=>readFile(path.join(root,file),'utf8')));
  requireValue(branded404(missing),'404.html must be a static branded noindex page linking home');
  requireValue(/^User-agent:\s*\*/im.test(robots)&&!/<html|<!doctype/i.test(robots),'robots.txt must contain crawler directives, not HTML');
  requireValue(canonical(html,kind==='app'?APP:MARKETING),'Missing canonical URL for the public origin');
  requireValue(kind==='app'?noindex(html):!noindex(html),'The app must be noindex; the marketing homepage must remain indexable');
  if(kind==='app'){
    const redirects=await readFile(path.join(root,'_redirects'),'utf8');
    requireValue(/^\/sitemap\.xml\s+https:\/\/earthradio\.stream\/sitemap\.xml\s+301\s*$/m.test(redirects),'App sitemap must redirect to the marketing sitemap');
  }else requireValue(marketingCrawlAllowed(robots),'Marketing robots.txt must permit indexing');
}

async function boundedText(response){
  const reader=response.body?.getReader();if(!reader)return '';
  const chunks=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>256*1024){await reader.cancel();throw Error('Route response exceeds 256 KiB');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(body);
}

export async function validateRouteResponses(origin,{kind='app',deployment='production',fetchImpl=globalThis.fetch}={}){
  requireValue(['app','marketing'].includes(kind),'Unknown route contract kind');
  requireValue(['production','preview'].includes(deployment),'Unknown deployment qualification mode');
  const base=new URL(origin);
  const loopback=base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname);
  requireValue((base.protocol==='https:'||loopback)&&!base.username&&!base.password&&base.pathname==='/'&&!base.search&&!base.hash,'Route validation requires a plain HTTPS origin (or local test server)');
  const paths=['/',absent,'/places'+absent,'/robots.txt','/sitemap.xml'];
  const rows=await Promise.all(paths.map(async pathname=>{
    const url=new URL(pathname,base),response=await fetchImpl(url,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(10000)});
    return{pathname,status:response.status,type:response.headers.get('content-type')||'',location:response.headers.get('location'),robots:response.headers.get('x-robots-tag')||'',body:await boundedText(response)};
  }));
  const [home,missing,nested,robots,sitemap]=rows;
  requireValue(home.status===200&&/text\/html/i.test(home.type),'Homepage must return HTTP 200 HTML');
  requireValue(canonical(home.body,kind==='app'?APP:MARKETING),'Served homepage has the wrong canonical URL');
  requireValue(kind==='app'?noindex(home.body):!noindex(home.body)&&(deployment==='preview'||!/noindex/i.test(home.robots)),'Served homepage indexing policy is incorrect');
  if(kind==='marketing'&&deployment==='preview')requireValue(/noindex/i.test(home.robots),'Marketing preview must retain its noindex protection');
  for(const row of [missing,nested])requireValue(row.status===404&&/text\/html/i.test(row.type)&&branded404(row.body),`Unknown route must return branded HTTP 404: ${row.pathname}`);
  requireValue(robots.status===200&&/^text\/plain\b/i.test(robots.type)&&/^User-agent:\s*\*/im.test(robots.body)&&!/<html/i.test(robots.body),'robots.txt must return HTTP 200 text/plain directives');
  if(kind==='marketing')requireValue(marketingCrawlAllowed(robots.body),'Served marketing robots.txt must permit indexing');
  if(kind==='app')requireValue(sitemap.status===301&&sitemap.location===MARKETING+'sitemap.xml','App sitemap must return the canonical marketing redirect');
  else requireValue(sitemap.status===200&&/(?:application|text)\/xml/i.test(sitemap.type)&&/<urlset\b/.test(sitemap.body),'Marketing sitemap must return HTTP 200 XML');
  // Keep page bodies out of receipts; URLs, statuses and types are sufficient.
  return{origin:base.origin,kind,deployment,routes:rows.map(({pathname,status,type,location})=>({pathname,status,type,location}))};
}
