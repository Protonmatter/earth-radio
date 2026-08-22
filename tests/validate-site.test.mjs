import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateSite } from '../scripts/validate-site.mjs';

async function createSite(root, {
  config = "window.RADIO_CONFIG={proxyBaseUrl: desktopProxyBaseUrl || ''};",
  missingAsset = false,
  sourceMapReference = false
} = {}) {
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<link rel="manifest" href="./manifest.webmanifest"><script src="./config.js"></script><script src="./assets/app.js"></script>');
  if (!missingAsset) {
    const sourceMapComment = sourceMapReference ? '//# sourceMappingURL=app.js.map\n' : '';
    await writeFile(path.join(root, 'assets', 'app.js'), `export {};\n${sourceMapComment}`);
  }
  await writeFile(path.join(root, 'config.js'), config);
  await writeFile(path.join(root, 'manifest.webmanifest'), '{"start_url":"./"}\n');
  await writeFile(path.join(root, 'sw.js'), "const SHELL_ASSETS=['./','./config.js','./assets/app.js'];\n");
  await writeFile(path.join(root, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n');
}

test('validateSite accepts a complete direct-mode site', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-valid-site-'));
  try {
    await createSite(root);
    const result = await validateSite(root);
    assert.equal(result.ok, true);
    assert.equal(result.assets.includes('assets/app.js'), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validateSite rejects a localhost production proxy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-local-site-'));
  try {
    await createSite(root, { config: "window.RADIO_CONFIG={proxyBaseUrl:'http://127.0.0.1:8787'};" });
    await assert.rejects(() => validateSite(root), /forbidden local reference/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validateSite rejects an absent referenced asset', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-missing-site-'));
  try {
    await createSite(root, { missingAsset: true });
    await assert.rejects(() => validateSite(root), /missing asset/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validateSite rejects a source map reference even when the map is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-source-map-site-'));
  try {
    await createSite(root, { sourceMapReference: true });
    await assert.rejects(() => validateSite(root), /source map reference/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
