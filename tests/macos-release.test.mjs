import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildMacRelease, releaseIdentity } from '../scripts/macos-release.mjs';

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
