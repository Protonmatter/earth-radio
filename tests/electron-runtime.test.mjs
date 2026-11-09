import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {ensureElectronRuntime,installPinnedElectron,INSTALL_TIMEOUT_MS} from '../scripts/ensure-electron-runtime.mjs';
test('runtime acquisition retries transport failure before allowing application tests',async()=>{
  let calls=0;const waits=[];
  await ensureElectronRuntime({install:async()=>{if(++calls<3)throw Error('fixture transport failure');},delay:async ms=>waits.push(ms)});
  assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
});
test('permanent acquisition failure remains a failing gate after three attempts',async()=>{
  let calls=0;const failure=Error('fixture integrity failure');
  await assert.rejects(ensureElectronRuntime({install:async()=>{calls++;throw failure;},delay:async()=>{}}),error=>error===failure);assert.equal(calls,3);
});
test('an installed runtime succeeds once with no delay or application-test retry',async()=>{
  let calls=0;await ensureElectronRuntime({install:async()=>{calls++;},delay:async()=>assert.fail('must not delay')});assert.equal(calls,1);
});
test('official locked installer retains bundled checksums and a bounded child lifetime',async()=>{
  await installPinnedElectron({spawnImpl:(executable,args,options)=>{
    assert.equal(executable,process.execPath);assert.match(args[0],/node_modules[\\/]electron[\\/]install\.js$/);
    assert.equal(options.timeout,INSTALL_TIMEOUT_MS);assert.equal(INSTALL_TIMEOUT_MS,180000);assert.equal(options.killSignal,'SIGTERM');assert.equal(options.shell,undefined);
    assert.equal(options.env.electron_use_remote_checksums,'');assert.equal(options.env.npm_config_electron_use_remote_checksums,'');
    const child=new EventEmitter();queueMicrotask(()=>child.emit('close',0,null));return child;
  }});
});
test('installer timeout/failure cannot be mistaken for successful acquisition',async()=>{
  await assert.rejects(installPinnedElectron({spawnImpl:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return child;}}),/SIGTERM/);
});
test('macOS preflight occurs before unchanged native qualification commands',async()=>{
  const text=await readFile('.github/workflows/ci.yml','utf8');const preflight=text.indexOf('node scripts/ensure-electron-runtime.mjs'),qualification=text.indexOf('run: npm run test:desktop-auth');
  assert.ok(preflight>0&&preflight<qualification);assert.match(text,/Prepare pinned Electron runtime\s+if: runner.os == 'macOS'/);
});
