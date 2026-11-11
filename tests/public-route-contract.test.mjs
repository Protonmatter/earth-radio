import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteResponses} from '../scripts/public-route-contract.mjs';

const missing='<meta name="robots" content="noindex"><main data-earth-radio-not-found><a href="/">Home</a></main>';
function fixture({kind='app',mutate=()=>{}}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});const pathname=new URL(url).pathname;
    let body='',status=200,headers={'content-type':'text/html; charset=utf-8'};
    if(pathname==='/')body=`<link rel="canonical" href="https://${kind==='app'?'app.':''}earthradio.stream/">${kind==='app'?'<meta name="robots" content="noindex, follow">':''}`;
    else if(pathname==='/robots.txt'){headers={'content-type':'text/plain'};body='User-agent: *\nAllow: /';}
    else if(pathname==='/sitemap.xml'){
      if(kind==='app'){status=301;headers={location:'https://earthradio.stream/sitemap.xml'};}
      else{headers={'content-type':'application/xml'};body='<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';}
    }else{status=404;body=missing;}
    const value={pathname,body,status,headers};mutate(value);return new Response(value.body,{status:value.status,headers:value.headers});
  };return{calls,fetchImpl};
}
test('route readback verifies five statuses and MIME/canonical rules without credentials or redirects',async()=>{
  for(const kind of ['app','marketing']){
    const f=fixture({kind}),result=await validateRouteResponses('https://preview.example',{kind,fetchImpl:f.fetchImpl});
    assert.equal(result.routes.length,5);assert.equal(result.routes[1].status,404);
    assert.ok(f.calls.every(({options})=>options.credentials==='omit'&&options.redirect==='manual'&&options.signal instanceof AbortSignal));
    assert.ok(result.routes.every(row=>!('body' in row)));
  }
});
test('soft 404s, HTML robots, missing canonical and app indexing fail the release gate',async()=>{
  for(const mutate of [v=>{if(v.status===404)v.status=200;},v=>{if(v.pathname==='/robots.txt')v.headers['content-type']='text/html';},v=>{if(v.pathname==='/')v.body='app shell';},v=>{if(v.pathname==='/')v.body=v.body.replace('noindex','index');},v=>{if(v.pathname==='/sitemap.xml')v.headers.location='https://other.example/sitemap.xml';}]){
    const f=fixture({mutate});await assert.rejects(validateRouteResponses('https://preview.example',{fetchImpl:f.fetchImpl}),/404|robots|canonical|indexing|sitemap/);
  }
});
test('oversized responses and unsafe origin arguments fail deterministically',async()=>{
  const f=fixture({mutate:v=>{if(v.pathname==='/')v.body='x'.repeat(256*1024+1);}});
  await assert.rejects(validateRouteResponses('https://preview.example',{fetchImpl:f.fetchImpl}),/256 KiB/);
  for(const origin of ['https://example.test/path','https://example.test/?query=x','https://example.test/#fragment','http://example.test','https://fixture:invalid@example.test']){
    const invalid=fixture();await assert.rejects(validateRouteResponses(origin,{fetchImpl:invalid.fetchImpl}),/plain HTTPS origin/);assert.equal(invalid.calls.length,0);
  }
});

test('marketing readback rejects a served robots file that blocks the homepage',async()=>{
  for(const directive of ['Disallow: / # temporary block','  Disallow: / # indented','\tDisallow \t: /\t# spaced colon']){
    const f=fixture({kind:'marketing',mutate:v=>{if(v.pathname==='/robots.txt')v.body='User-agent: *\n'+directive;}});
    await assert.rejects(validateRouteResponses('https://preview.example',{kind:'marketing',fetchImpl:f.fetchImpl}),/robots|indexing/);
  }
});

test('preview qualification preserves noindex without relaxing production indexing requirements',async()=>{
  const preview=fixture({kind:'marketing',mutate:v=>{if(v.pathname==='/')v.headers['x-robots-tag']='noindex';}});
  await assert.rejects(validateRouteResponses('https://preview.example',{kind:'marketing',fetchImpl:preview.fetchImpl}),/indexing/);
  const result=await validateRouteResponses('https://preview.example',{kind:'marketing',deployment:'preview',fetchImpl:preview.fetchImpl});
  assert.equal(result.deployment,'preview');
  const unprotected=fixture({kind:'marketing'});
  await assert.rejects(validateRouteResponses('https://preview.example',{kind:'marketing',deployment:'preview',fetchImpl:unprotected.fetchImpl}),/noindex/);
});
