import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

async function document(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

test('README states the local, recovery, hosting, and license contracts', async () => {
  const readme = await document('README.md');
  const opening = readme.split('\n').slice(0, 12).join('\n');
  for (const expected of ['Earth Radio', 'https://earth-radio.pages.dev', 'npm ci', 'npm run verify', 'recovered', 'No license is granted']) {
    assert.match(readme, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(opening, /https:\/\/earth-radio\.pages\.dev/);
});

test('operator documentation covers deployment and rollback boundaries', async () => {
  const operations = await document('docs/OPERATIONS.md');
  for (const expected of ['Build', 'Deploy', 'Smoke', 'Rollback', 'GitHub App', 'Only select repositories']) {
    assert.match(operations, new RegExp(expected, 'i'));
  }
});

test('build state distinguishes evidence from outstanding work', async () => {
  const state = await document('docs/BUILD_STATE.md');
  for (const heading of ['Validated', 'Not validated', 'Live deployment']) {
    assert.match(state, new RegExp(`^## ${heading}`, 'mi'));
  }
  assert.match(state, /Production is live at `https:\/\/earth-radio\.pages\.dev\/`/i);
  assert.match(state, /merge commit `[0-9a-f]{40}`/i);
  assert.match(state, /Cloudflare Pages deployment `[0-9a-f-]{36}`/i);
  assert.doesNotMatch(state, /not created/i);
});

test('required public documentation set exists and is non-empty', async () => {
  for (const relative of [
    'docs/ARCHITECTURE.md',
    'docs/PROVENANCE.md',
    'docs/RELEASE.md',
    'docs/SECURITY.md'
  ]) {
    assert.ok((await document(relative)).trim().length > 100, `${relative} is incomplete`);
  }
  const architecture = await document('docs/ARCHITECTURE.md');
  assert.match(architecture, /capability path/i);
  assert.match(architecture, /CGNAT|100\.64/);
});

test('public configuration forbids a deployed proxy URL', async () => {
  const config = await document('site/config.js');
  assert.match(config, /Cloudflare Pages/i);
  assert.match(config, /must remain empty/i);
  assert.doesNotMatch(config, /proxy mode is preferred for production/i);
});

function installedRuntimePath(row) {
  const match = String(row.source || '').match(/^installed-runtime\/(.+)$/);
  return match ? `${match[1]}/${row.path}` : null;
}

test('provenance separates immutable intake hashes from hardened overlays', async () => {
  const provenance = await document('docs/PROVENANCE.md');
  const overlay = JSON.parse(await document('docs/provenance/hardening-overlays.json'));
  const intake = JSON.parse(await document('docs/provenance/recovery-manifest.json'));
  const overlayByPath = new Map(overlay.files.map(entry => [entry.path, entry]));
  assert.match(provenance, /hardening overlay/i);
  assert.equal(overlay.schemaVersion, 1);
  assert.ok(overlay.files.some(entry => entry.path === 'site/sw.js'));
  for (const entry of overlay.files) {
    const absolute = path.join(root, ...entry.path.split('/'));
    const content = await readFile(absolute);
    assert.equal((await stat(absolute)).size, entry.current.bytes, `${entry.path} overlay byte count is stale`);
    assert.equal(createHash('sha256').update(content).digest('hex'), entry.current.sha256, `${entry.path} overlay hash is stale`);
  }
  for (const row of intake.files) {
    const relative = installedRuntimePath(row);
    if (!relative) continue;
    const absolute = path.join(root, ...relative.split('/'));
    const content = await readFile(absolute);
    const diskBytes = (await stat(absolute)).size;
    const diskSha = createHash('sha256').update(content).digest('hex');
    if (diskBytes === row.bytes && diskSha === row.sha256) continue;
    const recorded = overlayByPath.get(relative);
    assert.ok(recorded, `${relative} drifted from intake without a hardening overlay`);
    assert.equal(recorded.intake.bytes, row.bytes, `${relative} overlay intake byte count is stale`);
    assert.equal(recorded.intake.sha256, row.sha256, `${relative} overlay intake hash is stale`);
    assert.equal(recorded.current.bytes, diskBytes, `${relative} overlay current byte count is stale`);
    assert.equal(recorded.current.sha256, diskSha, `${relative} overlay current hash is stale`);
  }
});
