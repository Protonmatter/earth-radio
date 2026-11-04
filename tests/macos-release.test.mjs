import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { buildMacRelease, releaseIdentity, stopReleaseChild } from '../scripts/macos-release.mjs';

const input = { tag: 'v0.25.1', sha: 'a'.repeat(40), version: '0.25.1', arch: 'arm64' };
test('macOS release identity separates architectures and labels unnotarized artifacts', () => {
  assert.equal(releaseIdentity(input).artifactName, 'EarthRadio-0.25.1-macOS-arm64-unnotarized.dmg');
  assert.equal(releaseIdentity({ ...input, arch: 'x64' }).artifactName, 'EarthRadio-0.25.1-macOS-x64-unnotarized.dmg');
});
test('macOS release rejects tag/version drift, mutable refs and unexpected architecture', () => {
  for (const patch of [{ tag: 'v0.25.0' }, { version: '../0.25.1' }, { sha: 'main' }, { sha: 'a'.repeat(39) }, { arch: 'universal' }, { arch: '../x64' }]) {
    assert.throws(() => releaseIdentity({ ...input, ...patch }));
  }
});
test('macOS build refuses another host before any packaging operation', { skip: process.platform === 'darwin' }, async () => {
  await assert.rejects(buildMacRelease('unused', 'arm64'), /macOS host/);
});
test('macOS packaging workflow remains read-only without signing secrets or publication', async () => {
  const workflow = await readFile(new URL('../.github/workflows/macos-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /(?:contents|id-token): write|\$\{\{\s*secrets\.|gh release|GITHUB_TOKEN:/);
  const actions = [...workflow.matchAll(/uses:\s*(\S+)/g)].map(match => match[1]);
  assert.ok(actions.length >= 4);
  for (const action of actions) assert.match(action, /@[a-f0-9]{40}$/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
});
test('release shutdown rejects instead of waiting indefinitely after both signals', { timeout: 1000 }, async () => {
  const signals = [];
  await assert.rejects(stopReleaseChild({ kill: signal => signals.push(signal) }, new Promise(() => {}), { termMs: 5, killMs: 5 }), /cleanup deadline exceeded.*profile retained/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
// Windows cannot ignore SIGTERM in this fixture. The native macOS jobs and Linux
// CI exercise actual POSIX inherited-pipe behavior in addition to the unit gate.
test('release shutdown stays bounded when a helper retains pipes after parent termination', { timeout: 10000, skip: process.platform === 'win32' }, async () => {
  const code = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{});
    const helper=spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:['ignore',1,2]});
    helper.once('spawn',()=>console.log('ready')); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stderr.on('data', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 5000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('ready')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const started = Date.now();
    await assert.rejects(stopReleaseChild(child, closed, { termMs: 20, killMs: 20 }), /cleanup deadline exceeded.*profile retained/);
    assert.ok(Date.now() - started < 1500, 'Shutdown waited for the two-second helper instead of its configured deadline');
  } finally {
    child.kill('SIGKILL');
    child.stdout.destroy(); child.stderr.destroy();
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1000))]);
  }
});
