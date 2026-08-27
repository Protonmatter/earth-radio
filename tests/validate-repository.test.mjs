import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCloudflareConfig, validateRepository } from '../scripts/validate-repository.mjs';

test('rejects executable and credential file extensions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-repo-guard-'));
  try {
    await mkdir(path.join(root, 'release'), { recursive: true });
    await writeFile(path.join(root, 'release', 'Earth Radio.exe'), 'x');
    await writeFile(path.join(root, '.env'), ['SPOTIFY_CLIENT', 'SECRET=real-value'].join('_'));
    const errors = await validateRepository(root);
    assert.ok(errors.some(error => error.includes('.exe')));
    assert.ok(errors.some(error => error.includes('.env')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects real secret assignments but allows documented variable names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-secret-guard-'));
  try {
    await writeFile(path.join(root, 'bad.txt'), ['SPOTIFY_CLIENT', 'SECRET=actual-value'].join('_'));
    await writeFile(path.join(root, 'good.md'), '`SPOTIFY_CLIENT_SECRET` is never committed.\nSPOTIFY_CLIENT_SECRET=<client-secret>');
    const errors = await validateRepository(root);
    assert.equal(errors.some(error => error.includes('bad.txt')), true);
    assert.equal(errors.some(error => error.includes('good.md')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('requires strict-public Cloudflare configuration whenever Pages Functions exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-wrangler-guard-'));
  try {
    // Functions without any wrangler.jsonc: the strict-public control is missing.
    await mkdir(path.join(root, 'functions', 'api'), { recursive: true });
    await writeFile(path.join(root, 'functions', 'api', 'nowplaying.js'), 'export const x = 1;\n');
    let errors = await validateCloudflareConfig(root);
    assert.ok(errors.some(error => error.includes('Missing wrangler.jsonc')));

    // Declared strict-public flag (with JSONC comments) passes.
    await writeFile(path.join(root, 'wrangler.jsonc'),
      '// deployable configuration\n{\n  "name": "earth-radio",\n  "compatibility_flags": ["global_fetch_strictly_public"]\n}\n');
    assert.deepEqual(await validateCloudflareConfig(root), []);

    // A dropped strict-public flag or any private-origin flag fails closed.
    await writeFile(path.join(root, 'wrangler.jsonc'), '{\n  "compatibility_flags": []\n}\n');
    errors = await validateCloudflareConfig(root);
    assert.ok(errors.some(error => error.includes('global_fetch_strictly_public')));

    await writeFile(path.join(root, 'wrangler.jsonc'),
      '{\n  "compatibility_flags": ["global_fetch_strictly_public", "global_fetch_private_origin"]\n}\n');
    errors = await validateCloudflareConfig(root);
    assert.ok(errors.some(error => error.includes('global_fetch_private_origin')));

    // The full repository validation surfaces the same failure.
    const repositoryErrors = await validateRepository(root);
    assert.ok(repositoryErrors.some(error => error.includes('global_fetch_private_origin')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('accepts ordinary source and binary image assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-safe-guard-'));
  try {
    await mkdir(path.join(root, 'site'), { recursive: true });
    await writeFile(path.join(root, 'site', 'app.js'), 'export const value = 1;\n');
    await writeFile(path.join(root, 'site', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.deepEqual(await validateRepository(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
