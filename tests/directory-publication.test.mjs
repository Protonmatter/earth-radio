import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,unlink,rename,symlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
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
  const report=await stageDirectorySnapshot(input,output);assert.equal(report.files,generation.files.size+3);
  assert.deepEqual(JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8')),generation.manifest);
  assert.deepEqual(JSON.parse(await readFile(path.join(output,'station-manifest.json'),'utf8')),generation.stationManifest);
  await assert.rejects(readFile(path.join(output,'ignored.txt')),/ENOENT/);
});

test('old generations without the optional station manifest remain stageable',async t=>{
  const{input,output,generation}=await fixture(t);await unlink(path.join(input,'station-manifest.json'));
  const report=await stageDirectorySnapshot(input,output);
  const oldFiles=new Set([...Object.values(generation.manifest.files),...Object.values(generation.manifest.byCountry).flatMap(Object.values)].map(value=>value.path));
  assert.equal(report.files,oldFiles.size+2);
  await assert.rejects(readFile(path.join(output,'station-manifest.json')),/ENOENT/);
});

test('a malformed optional manifest cannot be silently skipped or stage any output',async t=>{
  const{input,output,generation}=await fixture(t);const changed=structuredClone(generation.stationManifest);changed.producerSourceSha='b'.repeat(40);
  await writeFile(path.join(input,'station-manifest.json'),JSON.stringify(changed));
  await assert.rejects(stageDirectorySnapshot(input,output),/generation|identity/i);
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
});

test('a tampered station shard fails before publication output exists',async t=>{
  const{input,output,generation}=await fixture(t);const descriptor=generation.stationManifest.shards.find(value=>value.records);
  await writeFile(path.join(input,descriptor.path),'bad');
  await assert.rejects(stageDirectorySnapshot(input,output),/hash mismatch/);
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
});

test('a valid shard in the wrong lookup bucket cannot publish a broken index',async t=>{
  const{input,output,generation}=await fixture(t),manifest=structuredClone(generation.stationManifest);
  const full=manifest.shards.findIndex(item=>item.records),empty=manifest.shards.findIndex(item=>!item.records);
  [manifest.shards[full],manifest.shards[empty]]=[manifest.shards[empty],manifest.shards[full]];
  await writeFile(path.join(input,'station-manifest.json'),JSON.stringify(manifest));
  await assert.rejects(stageDirectorySnapshot(input,output),/bucket|identity/i);
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
});

test('publication rejects a linked station-record directory before creating output',async t=>{
  const{input,output}=await fixture(t),folder=path.join(input,'station-records'),real=path.join(input,'real-station-records');
  await rename(folder,real);await symlink(real,folder,process.platform==='win32'?'junction':'dir');
  await assert.rejects(stageDirectorySnapshot(input,output),/artifact directory/);
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
});

test('an existing empty output directory is never adopted or partially populated',async t=>{
  const{input,output}=await fixture(t);await mkdir(output);await writeFile(path.join(output,'keep.txt'),'keep');
  await assert.rejects(stageDirectorySnapshot(input,output),/EEXIST/);
  assert.equal(await readFile(path.join(output,'keep.txt'),'utf8'),'keep');
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
});

test('station payloads count toward the existing128MiB aggregate guard',async t=>{
  const{input,output,generation}=await fixture(t),manifest=structuredClone(generation.manifest);
  const descriptors=[];
  for(let i=0;i<8;i++){
    const bytes=Buffer.alloc(16*1024*1024,32+i),sha256=createHash('sha256').update(bytes).digest('hex');
    const descriptor={path:`snapshots/${sha256}.json`,sha256,bytes:bytes.length,records:1};
    await writeFile(path.join(input,descriptor.path),bytes);descriptors.push(descriptor);
  }
  for(const[key,index]of Object.keys(manifest.files).map((key,index)=>[key,index]))manifest.files[key]=descriptors[index];
  manifest.byCountry.GB={catalog:descriptors[6],legacy:descriptors[7]};
  await writeFile(path.join(input,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(stageDirectorySnapshot(input,output),/total byte limit/);
  await assert.rejects(readFile(path.join(output,'manifest.json')),/ENOENT/);
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
