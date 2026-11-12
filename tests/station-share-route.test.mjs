import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderStationShareDocument,createStationShareRoute,SHARE_DOCUMENT_HEADERS} from '../functions/_shared/share-document.js';
import {stationShareUrl} from '../site/assets/sharing-core.js';
import {onRequest} from '../functions/s/[[path]].js';

const id='a1234567-1234-4abc-8abc-0123456789ab';
const row={stationuuid:id,name:'서울 & Radio',countrycode:'KR',url:'https://radio.example/live',codec:'MP3'};
const html=await readFile('site/index.html','utf8');
function context(path='/s/'+id,method='GET',asset=html){
  const calls=[];return{request:new Request('https://preview.example'+path,{method,headers:{authorization:'must-not-forward',cookie:'must-not-forward'}}),env:{ASSETS:{async fetch(request){calls.push(request);return new Response(asset,{headers:{'content-type':'text/html','etag':'"old-shell"','content-length':'1','last-modified':'old'}});}}},calls};
}
const bootstrap=body=>JSON.parse(body.match(/<script type="application\/json" id="er-shared-station">([\s\S]*?)<\/script>/)?.[1]||'null');

test('station HTML has server-visible metadata, root assets and an inert public bootstrap',()=>{
  const body=renderStationShareDocument(html,{...row,privateField:'never-include'});
  assert.match(body,/<title>서울 &amp; Radio · Earth Radio<\/title>/);
  assert.ok(body.includes('property="og:title"'));assert.ok(body.includes('property="og:description"'));assert.match(body,/South Korea/);
  assert.ok(body.includes(`href="${stationShareUrl(id)}"`));assert.ok(body.includes('https://earthradio.stream/images/earth-radio-og.png'));
  assert.doesNotMatch(body,/\s(?:href|src|data-light|data-dark)\s*=\s*["']\.\//i);assert.doesNotMatch(body,/<base\b/i);
  assert.equal(bootstrap(body).schemaVersion,1);assert.deepEqual(bootstrap(body).station,row);assert.doesNotMatch(body,/never-include/);
  assert.ok(html.includes('href="./manifest.webmanifest"'),'native source HTML remains relative');
});

test('quotes, script delimiters, Unicode separators and markup remain plain station data',()=>{
  const name='" </script><img id="injected" src=x> & \u2028音楽';
  const body=renderStationShareDocument(html,{...row,name});
  assert.doesNotMatch(body,/<img id="injected"|<\/script><img/);assert.match(body,/&lt;\/script&gt;/);
  assert.equal(bootstrap(body).station.name,name);assert.ok(body.includes('\\u003c'));assert.ok(body.includes('\\u2028'));
});

test('template sentinels and byte budgets fail rather than producing a partially changed shell',()=>{
  assert.throws(()=>renderStationShareDocument(html.replace('<title>Earth Radio</title>','<title>Changed</title>'),row),/template/i);
  assert.throws(()=>renderStationShareDocument(html+html,row),/template|byte/i);
  assert.throws(()=>renderStationShareDocument(' '.repeat(262145),row),/byte|template/i);
  assert.throws(()=>renderStationShareDocument(html,{...row,url:'javascript:bad'}),/station|URL/i);
});

test('the generated document retains the static security policy with a stricter referrer policy',async()=>{
  const headers=await readFile('site/_headers','utf8'),block=headers.split(/\r?\n\r?\n/)[0];
  for(const line of block.split(/\r?\n/).slice(1)){
    const match=/^\s+([^:]+):\s*(.*)$/.exec(line);if(!match)continue;
    assert.equal(SHARE_DOCUMENT_HEADERS[match[1].toLowerCase()],match[1].toLowerCase()==='referrer-policy'?'no-referrer':match[2]);
  }
  const route=createStationShareRoute({lookup:async()=>row}),response=await route(context());
  for(const[key,value]of Object.entries(SHARE_DOCUMENT_HEADERS))assert.equal(response.headers.get(key),value,key);
  assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('x-robots-tag'),/noindex/);
});

test('GET and HEAD select the exact station without forwarding request credentials',async()=>{
  const looked=[];const route=createStationShareRoute({lookup:async value=>{looked.push(value);return row;}});
  const get=context(),response=await route(get);assert.equal(response.status,200);assert.equal(bootstrap(await response.text()).station.stationuuid,id);
  assert.equal(get.calls.length,1);assert.equal(new URL(get.calls[0].url).pathname,'/');assert.equal(get.calls[0].method,'GET');
  assert.equal(get.calls[0].headers.has('authorization'),false);assert.equal(get.calls[0].headers.has('cookie'),false);
  for(const key of ['etag','content-length','content-encoding','last-modified'])assert.equal(response.headers.has(key),false,key);
  const head=await route(context('/s/'+id,'HEAD'));assert.equal(head.status,200);assert.equal(await head.text(),'');assert.deepEqual(looked,[id,id]);
});

test('canonical redirects stay on the preview origin and discard all query data before lookup',async()=>{
  let calls=0;const route=createStationShareRoute({lookup:async()=>{calls++;return row;}});
  const response=await route(context('/s/'+id+'/?code=never-echo'));assert.equal(response.status,308);
  assert.equal(response.headers.get('location'),'https://preview.example/s/'+id);assert.equal(calls,0);assert.doesNotMatch(await response.text(),/never-echo/);
});

test('unknown or malformed routes return a branded script-free404 and never boot last played',async()=>{
  let calls=0;const route=createStationShareRoute({lookup:async()=>{calls++;return null;}});
  for(const path of ['/s/'+id,'/s/not-an-id','/s/'+id+'/extra','/s/%252e%252e']){
    const response=await route(context(path));assert.equal(response.status,404,path);const body=await response.text();assert.match(body,/data-earth-radio-not-found/);assert.match(body,/href="\/"/);assert.doesNotMatch(body,/<script\b/);
  }
  assert.equal(calls,1);
});

test('lookup failures, identity mismatch and broken assets produce a safe retryable503',async()=>{
  for(const lookup of [async()=>{throw Error('private diagnostic must not escape');},async()=>({...row,stationuuid:'b1234567-1234-4abc-8abc-0123456789ab'})]){
    const response=await createStationShareRoute({lookup})(context());assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'60');assert.doesNotMatch(await response.text(),/private diagnostic|<script\b/);
  }
  const response=await createStationShareRoute({lookup:async()=>row})(context('/s/'+id,'GET','not the app shell'));assert.equal(response.status,503);
});

test('non-navigation methods cannot cause a metadata or audio request',async()=>{
  let calls=0;const route=createStationShareRoute({lookup:async()=>{calls++;return row;}});
  const response=await route(context('/s/'+id,'POST'));assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');assert.equal(calls,0);
});

test('the actual entry point keeps the marketing origin and its previews out of app routing',async()=>{
  for(const origin of ['https://earthradio.stream','https://www.earthradio.stream','https://candidate.earth-radio-website.pages.dev']){
    let next=false;const response=await onRequest({request:new Request(origin+'/s/'+id),next(){next=true;return new Response('static missing',{status:404});}});
    assert.equal(next,true);assert.equal(response.status,404);
  }
});

test('the actual app entry point renders a built-in station without a live provider lookup',async()=>{
  const c=context('/s/'+encodeURIComponent('earth-radio:listen.moe:jpop'));
  const response=await onRequest(c);assert.equal(response.status,200);const body=await response.text();assert.match(body,/LISTEN.moe/);assert.match(body,/Japan/);
});

test('static asset deadlines and byte limits remain bounded independently of metadata',async()=>{
  const c=context();let resolve,canceled=false;
  c.env.ASSETS.fetch=()=>new Promise(done=>{resolve=done;});
  const response=await createStationShareRoute({lookup:async()=>row,assetTimeoutMs:20})(c);assert.equal(response.status,503);
  resolve(new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-type':'text/html'}}));await new Promise(done=>setTimeout(done,0));assert.equal(canceled,true);
  const large=await createStationShareRoute({lookup:async()=>row})(context('/s/'+id,'GET',' '.repeat(262145)));assert.equal(large.status,503);
});
