import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {FALLBACK_RELEASE,normalizePublicRelease} from '../website/release-core.js';
import {stageWebsite} from '../scripts/stage-website.mjs';
import {validateWebsite} from '../scripts/validate-website.mjs';

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
  assert.equal(result.files.some(row=>/functions|auth-deployment|config\.js|\.node-version|wrangler/.test(row.path)),false);
  const forbidden=path.join(result.output,'_worker.js');await writeFile(forbidden,'// must not ship');
  await assert.rejects(validateWebsite(result.output),/unexpected|worker|static/i);
});
