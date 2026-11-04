import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fingerprintRuntime } from '../scripts/fingerprint-runtime.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-fingerprint-'));
  for (const name of ['site/assets', 'tests', 'docs/provenance']) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, 'site/assets/index-00000000.js'), 'export const candidate = true;\n');
  for (const name of ['site/index.html', 'site/sw.js', 'site/_headers', 'tests/runtime.test.mjs']) {
    await writeFile(path.join(root, name), 'assets/index-00000000.js\n');
  }
  const intake = { bytes: 10, sha256: 'immutable-intake' };
  await writeFile(path.join(root, 'docs/provenance/hardening-overlays.json'), JSON.stringify({ schemaVersion: 1, files: [
    { path: 'site/assets/index-00000000.js', intakePath: 'site/assets/original.js', intake, current: {}, reason: 'Audited integration' },
    { path: 'site/index.html', intake, current: {}, reason: 'Shell' },
    { path: 'site/sw.js', intake, current: {}, reason: 'Worker' }
  ] }));
  return root;
}

test('runtime fingerprint synchronizes shell, tests and derived provenance without changing intake', async () => {
  const root = await fixture();
  try {
    const name = await fingerprintRuntime(root);
    const content = await readFile(path.join(root, `site/assets/${name}.js`));
    assert.equal(name, `index-${createHash('sha256').update(content).digest('hex').slice(0, 8)}`);
    for (const reference of ['site/index.html', 'site/sw.js', 'site/_headers', 'tests/runtime.test.mjs']) {
      assert.ok((await readFile(path.join(root, reference), 'utf8')).includes(`${name}.js`));
    }
    const overlay = JSON.parse(await readFile(path.join(root, 'docs/provenance/hardening-overlays.json'), 'utf8'));
    assert.equal(overlay.files[0].path, `site/assets/${name}.js`);
    assert.deepEqual(overlay.files[0].intake, { bytes: 10, sha256: 'immutable-intake' });
    assert.equal(overlay.files[0].current.bytes, content.length);
    const first = JSON.stringify(overlay);
    assert.equal(await fingerprintRuntime(root), name);
    assert.equal(JSON.stringify(JSON.parse(await readFile(path.join(root, 'docs/provenance/hardening-overlays.json'), 'utf8'))), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid provenance fails before any runtime rename or shell write', async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, 'docs/provenance/hardening-overlays.json'), 'invalid JSON');
    await assert.rejects(() => fingerprintRuntime(root));
    assert.equal(await readFile(path.join(root, 'site/index.html'), 'utf8'), 'assets/index-00000000.js\n');
    assert.equal(await readFile(path.join(root, 'site/assets/index-00000000.js'), 'utf8'), 'export const candidate = true;\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
