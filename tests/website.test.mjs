import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {FALLBACK_RELEASE,normalizePublicRelease} from '../website/release-core.js';
import {BRAND_ASSETS,stageWebsite} from '../scripts/stage-website.mjs';
import {validateWebsite} from '../scripts/validate-website.mjs';
import {validateRouteResponses} from '../scripts/public-route-contract.mjs';
import {createSiteServer} from './e2e/serve-site.mjs';

const fixture=(tag='v0.29.1')=>({tag_name:tag,draft:false,prerelease:false,html_url:`https://github.com/Protonmatter/earth-radio/releases/tag/${tag}`,assets:[
  `EarthRadio-Setup-${tag.slice(1)}-arm64.exe`,`EarthRadio-Portable-${tag.slice(1)}-arm64.exe`,
  `EarthRadio-${tag.slice(1)}-macOS-arm64-unnotarized.dmg`,`EarthRadio-${tag.slice(1)}-macOS-x64-unnotarized.dmg`,'SHA256SUMS.txt','INSTALL.md'
].map(name=>({name,size:1234,state:'uploaded',browser_download_url:`https://github.com/Protonmatter/earth-radio/releases/download/${tag}/${name}`}))});

test('website fallback points to the previously verified complete stable release',()=>{
  assert.equal(FALLBACK_RELEASE.tag,'v0.29.0');
  assert.equal(Object.keys(FALLBACK_RELEASE.downloads).length,4);
  assert.ok(Object.values(FALLBACK_RELEASE.downloads).every(url=>url.startsWith('https://github.com/Protonmatter/earth-radio/releases/download/v0.29.0/')));
});

test('release lookup accepts only complete stable releases and exact repository asset URLs',()=>{
  const release=normalizePublicRelease(fixture());
  assert.equal(release.version,'0.29.1');assert.equal(Object.keys(release.downloads).length,4);
  for(const mutate of [r=>{r.draft=true;},r=>{r.prerelease=true;},r=>{r.tag_name='v0.29.1-rc1';},r=>{r.assets.pop();},r=>{r.assets[0].state='open';},r=>{r.assets[0].size=0;},r=>{r.assets[0].browser_download_url='https://github.com.evil.example/download.exe';},r=>{r.assets[0].browser_download_url+='?token=untrusted';},r=>{r.html_url='javascript:alert(1)';},r=>{r.assets[0].name='EarthRadio-Setup-0.29.0-arm64.exe';}]){
    const raw=fixture();mutate(raw);assert.equal(normalizePublicRelease(raw),null);
  }
});

test('website staging is explicit, static, validated and independent from app Functions',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'earth-radio-website-'));
  await mkdir(path.join(root,'website'),{recursive:true});
  await assert.rejects(stageWebsite({root}),/missing|required|ENOENT/i);
  await assert.rejects(stageWebsite({root,output:path.join(root,'outside')}),/outside|output/i);
});

test('real website artifact has correct app, installation, origin-migration and trust information',async()=>{
  const result=await stageWebsite();await validateWebsite(result.output);
  const html=await readFile(path.join(result.output,'index.html'),'utf8');
  assert.match(html,/https:\/\/app\.earthradio\.stream\//);
  assert.match(html,/https:\/\/earth-radio\.pages\.dev\//);
  for(const label of ['Windows ARM64','Apple Silicon','Intel','Safari','Add to Home Screen','unnotarized'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/<iframe|<form|google-analytics|googletagmanager/i);
  const source=await readFile('website/wrangler.jsonc','utf8');assert.doesNotMatch(source,/METADATA_LIMITS|durable_objects|service_bindings/);
  // Keep the already-public contact page byte-identical across Pages and zone
  // delivery, without changing zone-wide security or rewriting email links.
  assert.match(await readFile('website/_headers','utf8'),/Cache-Control:[^\n]*no-transform/);
  const appHeaders=await readFile('site/_headers','utf8');
  for(const endpoint of ['/privacy','/privacy.html'])assert.ok(appHeaders.includes(`${endpoint}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform`));
  assert.equal(result.files.some(row=>/functions|auth-deployment|config\.js|\.node-version|wrangler/.test(row.path)),false);
  const redirects=path.join(result.output,'_redirects'),validRedirects=await readFile(redirects,'utf8');
  await writeFile(redirects,'https://www.earthradio.stream/* https://earthradio.stream/:splat 301\n');
  await assert.rejects(validateWebsite(result.output),/unsupported.*host|host.*unsupported/i);
  await writeFile(redirects,validRedirects);
  const forbidden=path.join(result.output,'_worker.js');await writeFile(forbidden,'// must not ship');
  await assert.rejects(validateWebsite(result.output),/unexpected|worker|static/i);
});

test('website carries the precision identity from site/branding with a 1200x630 social card',async()=>{
  const result=await stageWebsite();const html=await readFile(path.join(result.output,'index.html'),'utf8');
  for(const href of ['./images/earth-radio-favicon-16.png','./images/earth-radio-favicon-32.png','./images/earth-radio-favicon.svg','./images/earth-radio-apple-touch-icon-180.png'])assert.ok(html.includes(`href="${href}"`),href);
  assert.match(html,/<meta property="og:image" content="https:\/\/earthradio\.stream\/images\/earth-radio-og\.png" \/>/);
  assert.match(html,/<meta property="og:image:width" content="1200" \/>/);assert.match(html,/<meta property="og:image:height" content="630" \/>/);
  assert.match(html,/<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.equal((html.match(/class="brand-lockup" src="\.\/images\/earth-radio-logo\.svg"[^>]*alt="Earth Radio"/g)||[]).length,2);
  assert.doesNotMatch(html,/earth-radio-(?:32|512)\.png|-v2\.png/);
  // Staged brand files are byte-identical to the app's approved masters.
  for(const [from,to] of BRAND_ASSETS)assert.deepEqual(await readFile(path.join(result.output,'images',to)),await readFile(path.join('site/branding',from)),to);
  const og=await readFile(path.join(result.output,'images/earth-radio-og.png'));
  assert.equal(og.toString('ascii',1,4),'PNG');assert.equal(og.readUInt32BE(16),1200);assert.equal(og.readUInt32BE(20),630);
  const privacy=await readFile(path.join(result.output,'privacy.html'),'utf8');
  assert.match(privacy,/href="\.\/images\/earth-radio-favicon-32\.png"/);
});

test('both public artifacts include a branded top-level 404 and an explicit crawler contract',async()=>{
  const result=await stageWebsite();
  for(const root of ['site',result.output]){
    const missing=await readFile(path.join(root,'404.html'),'utf8');
    assert.match(missing,/data-earth-radio-not-found/);assert.match(missing,/href="\/"/);assert.match(missing,/noindex/);
    const robots=await readFile(path.join(root,'robots.txt'),'utf8');assert.match(robots,/User-agent: \*/);assert.doesNotMatch(robots,/<html/i);
  }
  const app=await readFile('site/index.html','utf8');assert.match(app,/<link rel="canonical" href="https:\/\/app\.earthradio\.stream\/"/);
  assert.match(app,/<meta name="robots" content="noindex, follow"/);
  const marketing=await readFile(path.join(result.output,'index.html'),'utf8');assert.doesNotMatch(marketing,/<meta name="robots"[^>]*noindex/);
});

test('real staged app and marketing HTTP routes return 404, correct MIME and canonical policies',async()=>{
  const marketing=await stageWebsite();
  for(const [kind,appRoot] of [['app',path.resolve('site')],['marketing',marketing.output]]){
    const server=createSiteServer({appRoot});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const origin=`http://127.0.0.1:${server.address().port}`;
      const report=await validateRouteResponses(origin,{kind});
      assert.equal(report.routes[1].status,404);assert.equal(report.routes[2].status,404);assert.match(report.routes[3].type,/^text\/plain/);
      const privacy=await fetch(origin+'/privacy');assert.equal(privacy.status,200);assert.match(await privacy.text(),/Earth Radio privacy policy/);
      const signIn=await fetch(origin+'/?code=route-probe-only');assert.equal(signIn.status,200);
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});
