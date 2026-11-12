import {createStationRecordReader} from './station-records.js';
import {readBodyCapped} from './guarded-fetch.js';
import {STATION_RECORD_FIELDS,validateStationRecordShard} from '../../server/station-record-protocol.mjs';
import {parseStationSharePath,stationPreviewMetadata,SHARED_STATION_BOOTSTRAP_MAX_BYTES} from '../../site/assets/sharing-core.js';

// Pages does not apply _headers to generated Function responses. The route tests
// bind these explicit headers to the static document policy; referrers are stricter.
export const SHARE_DOCUMENT_HEADERS=Object.freeze({
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'no-referrer',
  'permissions-policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security':'max-age=31536000; includeSubDomains; preload',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src https: http: blob:; connect-src 'self' https: http: wss://listen.moe; font-src 'self'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'content-type':'text/html; charset=utf-8',
  'cache-control':'no-store, no-transform',
  'x-robots-tag':'noindex, follow'
});
const encode=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const byteLength=value=>new TextEncoder().encode(value).length;

function replaceOne(html,pattern,replacement){
  const count=[...html.matchAll(pattern)].length;if(count!==1)throw Error('Unexpected share document template');
  return html.replace(pattern,()=>replacement);
}

export function renderStationShareDocument(html,station){
  if(typeof html!=='string'||byteLength(html)>256*1024)throw Error('Share template byte limit exceeded');
  const record=Object.fromEntries(STATION_RECORD_FIELDS.filter(key=>station?.[key]!==undefined).map(key=>[key,station[key]]));
  validateStationRecordShard({schemaVersion:1,stations:[record]},{records:1});
  const meta=stationPreviewMetadata(record);if(!meta)throw Error('Invalid public station metadata');
  const json=JSON.stringify({schemaVersion:1,station:record}).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  if(byteLength(json)>SHARED_STATION_BOOTSTRAP_MAX_BYTES)throw Error('Station bootstrap byte limit exceeded');
  let body=replaceOne(html,/<title>Earth Radio<\/title>/g,'<title>'+encode(meta.title)+'</title>');
  body=replaceOne(body,/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi,'<link rel="canonical" href="'+encode(meta.url)+'" />');
  body=replaceOne(body,/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/gi,'<meta name="description" content="'+encode(meta.description)+'" />');
  body=body.replace(/(\s(?:src|href|action|poster|data-light|data-dark)\s*=\s*)(["'])\.\//gi,(_match,prefix,quote)=>prefix+quote+'/');
  const tags=[['og:title',meta.title],['og:description',meta.description],['og:type','website'],['og:site_name','Earth Radio'],['og:url',meta.url],['og:image',meta.image],['og:image:width','1200'],['og:image:height','630'],['og:image:alt','Earth Radio. The world is on air.']].map(([key,value])=>'<meta property="'+key+'" content="'+encode(value)+'" />').join('\n');
  const extra=tags+'\n<meta name="twitter:card" content="summary_large_image" />\n<script type="application/json" id="er-shared-station">'+json+'</script>\n</head>';
  return replaceOne(body,/<\/head>/gi,extra);
}

function errorDocument(status){
  const title=status===404?'Station not found':status===503?'Station link unavailable':'Method not allowed';
  const message=status===404?'No station is available at this address. Open Earth Radio to search.':status===503?'We could not load this station’s information. Try again shortly, or open Earth Radio.':'Open this link in a browser to find the station.';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, follow"><title>'+title+' · Earth Radio</title><link rel="icon" type="image/svg+xml" href="/branding/earth-radio-favicon-pine.svg"><link rel="stylesheet" href="/not-found.css"></head><body data-earth-radio-not-found><main><img src="/branding/earth-radio-logo.svg" width="240" height="48" alt="Earth Radio"><p class="eyebrow">'+status+' · '+title+'</p><h1>'+title+'</h1><p>'+message+'</p><a href="/">Open Earth Radio <span aria-hidden="true">→</span></a></main></body></html>';
}

async function appTemplate(context,timeoutMs){
  const controller=new AbortController(),deadlineAt=Date.now()+timeoutMs;let timer,timedOut=false;
  try{
    const request=new Request(new URL('/',context.request.url),{method:'GET',headers:{Accept:'text/html'},credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    const work=Promise.resolve().then(()=>context.env.ASSETS.fetch(request)).then(response=>{if(timedOut){void response.body?.cancel().catch(()=>{});throw Error('Asset deadline exceeded');}return response;});
    const response=await Promise.race([work,new Promise((_resolve,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(Error('Asset deadline exceeded'));},timeoutMs);})]);
    if(response.status!==200||!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw Error('App template unavailable');}
    const bytes=await readBodyCapped(response,{maxBytes:256*1024+1,deadlineAt});
    if(bytes.length>256*1024)throw Error('Share template byte limit exceeded');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }finally{clearTimeout(timer);controller.abort();}
}

export function createStationShareRoute({lookup=createStationRecordReader().lookup,assetTimeoutMs=2000}={}){
  if(typeof lookup!=='function'||!Number.isInteger(assetTimeoutMs)||assetTimeoutMs<1||assetTimeoutMs>15000)throw TypeError('Invalid station route options');
  return async context=>{
    const request=context.request,head=request.method==='HEAD';
    const fail=status=>new Response(head?null:errorDocument(status),{status,headers:{...SHARE_DOCUMENT_HEADERS,...(status===503?{'retry-after':'60'}:{}),...(status===405?{allow:'GET, HEAD'}:{})}});
    if(!['GET','HEAD'].includes(request.method))return fail(405);
    const url=new URL(request.url),parsed=parseStationSharePath(url.pathname);if(!parsed)return fail(404);
    if(url.pathname!==parsed.canonicalPath||url.search){return new Response(null,{status:308,headers:{...SHARE_DOCUMENT_HEADERS,location:new URL(parsed.canonicalPath,url.origin).href}});}
    try{
      const station=await lookup(parsed.id);if(!station)return fail(404);
      if(station.stationuuid!==parsed.id)throw Error('Station identity mismatch');
      const body=renderStationShareDocument(await appTemplate(context,assetTimeoutMs),station);
      return new Response(head?null:body,{status:200,headers:SHARE_DOCUMENT_HEADERS});
    }catch{return fail(503);}
  };
}
