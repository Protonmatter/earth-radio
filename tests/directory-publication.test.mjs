import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {buildDirectoryGeneration,writeDirectoryGeneration} from '../scripts/build-directory-snapshot.mjs';
import {stageDirectorySnapshot} from '../scripts/stage-directory-snapshot.mjs';
const rows=[{stationuuid:'test',name:'Radio',url:'https://radio.example/live',countrycode:'GB',lastcheckok:1}];
async function fixture(t){
  await mkdir('.build',{recursive:true});const root=await mkdtemp(path.resolve('.build/directory-publication-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const input=path.join(root,'input'),output=path.join(root,'output');
  const generation=buildDirectoryGeneration(rows,{producerSourceSha:'a'.repeat(40),minimumRecords:1,minimumCountries:1,minimumCityPrograms:0});
  await writeDirectoryGeneration(generation,input);return{input,output,generation};
}
test('publication includes exactly validated files and never source/account data',async t=>{
  const{input,output,generation}=await fixture(t);await writeFile(path.join(input,'ignored.txt'),'not published');
  const report=await stageDirectorySnapshot(input,output);assert.equal(report.files,generation.files.size+2);
  assert.deepEqual(JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8')),generation.manifest);
  await assert.rejects(readFile(path.join(output,'ignored.txt')),/ENOENT/);
});
test('tampering fails before output exists, leaving the last deployment intact',async t=>{
  const{input,output,generation}=await fixture(t);await writeFile(path.join(input,generation.manifest.files.catalog.path),'bad');
  await assert.rejects(stageDirectorySnapshot(input,output),/hash mismatch/);
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
});
test('unexpected manifest paths are rejected before any file read or output write',async t=>{
  const{input,output,generation}=await fixture(t);generation.manifest.files.evil={path:'../outside.json'};
  await writeFile(path.join(input,'manifest.json'),JSON.stringify(generation.manifest));
  await assert.rejects(stageDirectorySnapshot(input,output),/Unexpected snapshot file/);
});
test('publication cannot overwrite an artifact or target source paths',async t=>{
  const{input,output}=await fixture(t);await stageDirectorySnapshot(input,output);
  await assert.rejects(stageDirectorySnapshot(input,output),/EEXIST/);
  await assert.rejects(stageDirectorySnapshot(input,'site'),/distinct .build/);
});
test('workflow has bounded free-runner publication with no source write grant',async()=>{
  const text=await readFile('.github/workflows/directory-snapshot.yml','utf8');
  assert.match(text,/schedule:[\s\S]*17 \* \* \* \*/);assert.match(text,/cancel-in-progress: false/);
  assert.match(text,/pages: write/);assert.match(text,/id-token: write/);assert.doesNotMatch(text,/contents: write|secrets\.|npm install|git push/);
  assert.match(text,/deploy:\s+if: github\.ref == 'refs\/heads\/main'/);
  for(const line of text.split('\n').filter(line=>line.includes('uses:')))assert.match(line,/@[a-f0-9]{40}$/);
});
