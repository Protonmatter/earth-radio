import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {buildWindows} from '../scripts/build-windows.mjs';

test('Windows builds serialize architectures and forward the same reviewed configuration',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'earth-radio-win-build-'));
  try{
    const file=path.join(root,'builder.json');await writeFile(file,'{}');const calls=[];let active=false;
    await buildWindows({root,configPath:file,run:async(args,{arch})=>{assert.equal(active,false);active=true;await Promise.resolve();calls.push({args,arch});active=false;}});
    assert.deepEqual(calls.map(row=>row.arch),['arm64','x64']);
    assert.deepEqual(calls.map(row=>row.args),[['--win','--arm64','--config',file,'--publish','never'],['--win','--x64','--config',file,'--publish','never']]);
  }finally{assert.equal(path.dirname(path.resolve(root)),path.resolve(tmpdir()));await rm(root,{recursive:true,force:true});}
});
test('a failed architecture stops the build before the next one can create artifacts',async()=>{
  const calls=[];await assert.rejects(buildWindows({run:async(_args,{arch})=>{calls.push(arch);throw Error('fixture compiler failure');}}),/compiler failure/);assert.deepEqual(calls,['arm64']);
});
test('an invalid config never starts the packager and default builds do not select a signer',async()=>{
  await assert.rejects(buildWindows({configPath:'missing-build-config.json',run:()=>assert.fail('must not launch')}),/ENOENT/);
  const calls=[];await buildWindows({run:async args=>calls.push(args)});assert.deepEqual(calls,[['--win','--arm64','--publish','never'],['--win','--x64','--publish','never']]);
});

test('packaging explicitly disables publication regardless of inherited release or CI environment',async()=>{
  const calls=[];await buildWindows({run:async args=>calls.push(args)});
  for(const args of calls)assert.equal(args[args.indexOf('--publish')+1],'never');
});
