import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildReleaseManifest } from '../scripts/release-manifest.mjs';

test('release manifest is stable and uses the package version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-manifest-'));
  await mkdir(path.join(root, 'site'), { recursive: true });
  await writeFile(path.join(root, 'site', 'index.html'), '<!doctype html>\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'earth-radio', version: '9.8.7' }));
  await writeFile(path.join(root, 'electron-builder.yml'), 'appId: example\n');

  const first = await buildReleaseManifest(root);
  const second = await buildReleaseManifest(root);

  assert.deepEqual(second, first);
  assert.equal(first.name, 'Earth Radio');
  assert.equal(first.version, '9.8.7');
  assert.equal('generatedAt' in first, false);
  assert.deepEqual(first.files.map(entry => entry.path), [
    'electron-builder.yml',
    'package.json',
    'site/index.html'
  ]);
});

test('generated release files never hash themselves', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-manifest-self-'));
  await mkdir(path.join(root, 'site'), { recursive: true });
  await writeFile(path.join(root, 'site', 'index.html'), 'ok\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await writeFile(path.join(root, 'RELEASE_MANIFEST.json'), 'stale');
  await writeFile(path.join(root, 'sha256sums.txt'), 'stale');

  const manifest = await buildReleaseManifest(root);
  assert.equal(manifest.files.some(entry => /RELEASE_MANIFEST|sha256sums/.test(entry.path)), false);
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, manifest.version);
});

test('release manifest inventories the CI workflow', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-manifest-workflow-'));
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'permissions:\n  contents: read\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));

  const manifest = await buildReleaseManifest(root);
  assert.equal(manifest.files.some(entry => entry.path === '.github/workflows/ci.yml'), true);
});

test('release manifest inventories root runtime and lint policy inputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-manifest-root-policy-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await writeFile(path.join(root, '.node-version'), '24.18.0\n');
  await writeFile(path.join(root, 'eslint.config.mjs'), 'export default [];\n');

  const manifest = await buildReleaseManifest(root);
  assert.deepEqual(manifest.files.map(entry => entry.path), [
    '.node-version',
    'eslint.config.mjs',
    'package.json'
  ]);
});

test('release manifest inventories Supabase configuration, migrations, and RLS tests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-manifest-supabase-'));
  await mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await mkdir(path.join(root, 'supabase', 'tests'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await writeFile(path.join(root, 'supabase', 'config.toml'), 'project_id = "earth-radio"\n');
  await writeFile(path.join(root, 'supabase', 'migrations', '20260825010000_auth.sql'), 'create table profiles ();\n');
  await writeFile(path.join(root, 'supabase', 'tests', 'rls_policies.sql'), 'select plan(1);\n');

  const manifest = await buildReleaseManifest(root);
  assert.deepEqual(manifest.files.map(entry => entry.path), [
    'package.json',
    'supabase/config.toml',
    'supabase/migrations/20260825010000_auth.sql',
    'supabase/tests/rls_policies.sql'
  ]);
});

test('non-writing release verification detects missing, current, and stale metadata', async () => {
  const releaseManifest = await import('../scripts/release-manifest.mjs');
  assert.equal(typeof releaseManifest.verifyReleaseManifest, 'function');
  const root = await mkdtemp(path.join(tmpdir(), 'earth-radio-manifest-check-'));
  await mkdir(path.join(root, 'site'), { recursive: true });
  await writeFile(path.join(root, 'site', 'index.html'), 'first\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));

  assert.equal((await releaseManifest.verifyReleaseManifest(root)).ok, false);
  await releaseManifest.writeReleaseManifest(root);
  assert.equal((await releaseManifest.verifyReleaseManifest(root)).ok, true);
  await writeFile(path.join(root, 'site', 'index.html'), 'changed\n');
  assert.equal((await releaseManifest.verifyReleaseManifest(root)).ok, false);
});
