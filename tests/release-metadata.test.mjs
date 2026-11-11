import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizePublicRelease,compareReleaseVersions} from '../website/release-core.js';
import {publishedReleaseMetadata,publishedReleaseModule,parsePublishedReleaseModule,stampReleaseHtml} from '../scripts/release-metadata.mjs';
import {setPublishedRelease} from '../scripts/set-published-release.mjs';

function fixture(version='0.32.2'){
  const names=[`EarthRadio-Setup-${version}-arm64.exe`,`EarthRadio-Portable-${version}-arm64.exe`,
    ...(version==='0.32.2'?[`EarthRadio-Setup-${version}-x64.exe`,`EarthRadio-Portable-${version}-x64.exe`]:[]),
    `EarthRadio-${version}-macOS-arm64-unnotarized.dmg`,`EarthRadio-${version}-macOS-x64-unnotarized.dmg`,'INSTALL.md','SHA256SUMS.txt'];
  return{tag_name:'v'+version,draft:false,prerelease:false,html_url:`https://github.com/Protonmatter/earth-radio/releases/tag/v${version}`,
    assets:names.map(name=>({name,size:1234,state:'uploaded',browser_download_url:`https://github.com/Protonmatter/earth-radio/releases/download/v${version}/${name}`}))};
}
const template='<strong data-release-version>old</strong>'+['windowsSetup','windowsPortable','macArm64','macIntel'].map(key=>`<a data-download="${key}" href="https://old.example/obsolete">Download</a>`).join('')
  +'<article data-download-group="windowsX64" hidden><a data-download="windowsX64Setup" href="#install">Installer</a><a data-download="windowsX64Portable" href="#install">Portable</a></article>'
  +'<a data-release-install href="#install">Guide</a><a data-release-checksums href="#checksums">Checksums</a><a data-release-page href="#release">Notes</a>';

test('release version ordering is numeric and rejects malformed values',()=>{
  for(const [a,b,want] of [['0.32.2','0.32.1',1],['1.0.0','0.99.99',1],['0.9.0','0.10.0',-1],['0.32.2','0.32.2',0]])assert.equal(compareReleaseVersions(a,b),want);
  for(const value of ['',null,'latest','v0.32.2','0.32.2-beta'])assert.throws(()=>compareReleaseVersions(value,'0.32.2'),/numeric/);
});
test('public metadata serialization is data-only, strips unrelated fields and validates optional provenance',()=>{
  const raw={...fixture(),unrelated:'do-not-publish'};
  const module=publishedReleaseModule(raw);assert.doesNotMatch(module,/unrelated|do-not-publish/);
  assert.deepEqual(parsePublishedReleaseModule(module),publishedReleaseMetadata(raw));
  assert.throws(()=>parsePublishedReleaseModule(module+'globalThis.unwanted=true;'),/data-only/);
  assert.throws(()=>publishedReleaseMetadata({...raw,id:'invalid identifier'}),/identifier/);
  const bad=fixture();bad.assets[0].digest='invalid digest';assert.throws(()=>publishedReleaseMetadata(bad),/digest/);
  bad.assets[0].digest='sha256:'+'a'.repeat(64);assert.equal(publishedReleaseMetadata(bad).assets[0].digest,bad.assets[0].digest);
});
test('staging stamps all fallback bindings and only exposes an available x64 pair',()=>{
  const current=normalizePublicRelease(fixture('0.32.1')),old=stampReleaseHtml(template,current);
  assert.doesNotMatch(old,/old\.example|>old</);assert.match(old,/data-download-group="windowsX64" hidden/);
  assert.doesNotMatch(old,/<a data-download="windowsX64\w+" href=/);
  const next=normalizePublicRelease(fixture()),html=stampReleaseHtml(template,next);
  for(const url of [...Object.values(next.downloads),next.install,next.checksums,next.url])assert.ok(html.includes(`href="${url}"`));
  assert.doesNotMatch(html,/data-download-group="windowsX64" hidden/);assert.equal(stampReleaseHtml(html,next),html);
  assert.throws(()=>stampReleaseHtml(template.replace('data-release-version','removed-version'),next),/version label/);
});

test('standard quoted attributes cannot retain stale first hrefs or hidden x64 groups',()=>{
  const next=normalizePublicRelease(fixture());
  const source=template.replace('href="https://old.example/obsolete"',"href='https://old.example/obsolete'").replace(' hidden>',' hidden="">');
  const html=stampReleaseHtml(source,next);
  assert.doesNotMatch(html,/old\.example/);assert.doesNotMatch(html,/\shidden(?:=|\s|>)/);
  assert.equal((html.match(/href=/g)||[]).length,Object.keys(next.downloads).length+3);
  assert.throws(()=>stampReleaseHtml(template.replace('href="https://old.example/obsolete"','href="https://old.example/obsolete" href="https://duplicate.example"'),next),/duplicate/i);
});
test('public metadata update previews, applies, is idempotent and rejects rollback or replacement',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'earth-radio-release-meta-'));
  try{
    await mkdir(path.join(root,'website'));
    const file=path.join(root,'website/published-release.js'),html=path.join(root,'website/index.html'),input=path.join(root,'public.json');
    await writeFile(file,publishedReleaseModule(fixture('0.32.1')));await writeFile(html,stampReleaseHtml(template,normalizePublicRelease(fixture('0.32.1'))));
    await writeFile(input,'\uFEFF'+JSON.stringify(fixture()));const before=await readFile(file,'utf8');
    const plan=await setPublishedRelease({root,input});assert.equal(plan.apply,false);assert.equal(plan.changedFiles.length,2);assert.equal(await readFile(file,'utf8'),before);
    const applied=await setPublishedRelease({root,input,apply:true});assert.equal(applied.tag,'v0.32.2');assert.equal(applied.downloads.length,6);
    assert.equal((await setPublishedRelease({root,input,apply:true})).changedFiles.length,0);
    await writeFile(input,JSON.stringify(fixture('0.32.1')));await assert.rejects(setPublishedRelease({root,input,apply:true}),/downgrade/);
    const changed=fixture();changed.assets[0].size++;await writeFile(input,JSON.stringify(changed));await assert.rejects(setPublishedRelease({root,input,apply:true}),/same tag/);
  }finally{
    assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('earth-radio-release-meta-'));
    await rm(root,{recursive:true,force:true});
  }
});
