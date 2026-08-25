import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateSite } from '../scripts/validate-site.mjs';

async function createSite(root, {
  config = "window.RADIO_CONFIG={proxyBaseUrl: desktopProxyBaseUrl || ''};",
  headers = '/*\n  X-Content-Type-Options: nosniff\n',
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
  await writeFile(path.join(root, '_headers'), headers);
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

test('validateSite permits only the bounded localhost auth development origin', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-auth-dev-site-'));
  try {
    await createSite(root, {
      config: "const authOriginAllowed = ['https://earth-radio.pages.dev', 'http://localhost:8788'].includes(window.location.origin); window.RADIO_CONFIG={proxyBaseUrl: desktopProxyBaseUrl || '',authOriginAllowed};"
    });
    const result = await validateSite(root);
    assert.equal(result.ok, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [label, unsafeConfig] of [
  ['Supabase auth URL', "const authOriginAllowed = ['https://earth-radio.pages.dev', 'http://localhost:8788'].includes(window.location.origin); window.RADIO_CONFIG={proxyBaseUrl: desktopProxyBaseUrl || '',auth:{url:'http://localhost:8788'}};"],
  ['generic API URL', "const authOriginAllowed = ['https://earth-radio.pages.dev', 'http://localhost:8788'].includes(window.location.origin); window.RADIO_CONFIG={proxyBaseUrl: desktopProxyBaseUrl || '',apiUrl:'http://localhost:8788/api'};"],
  ['executable request', "const authOriginAllowed = ['https://earth-radio.pages.dev', 'http://localhost:8788'].includes(window.location.origin); fetch('http://localhost:8788/internal'); window.RADIO_CONFIG={proxyBaseUrl: desktopProxyBaseUrl || ''};"]
]) {
  test(`validateSite rejects localhost in ${label} outside the exact auth declaration`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-local-exception-site-'));
    try {
      await createSite(root, { config: unsafeConfig });
      await assert.rejects(() => validateSite(root), /forbidden local reference/i);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('validateSite still rejects the permitted auth origin when used as a proxy endpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-local-proxy-site-'));
  try {
    await createSite(root, { config: "window.RADIO_CONFIG={proxyBaseUrl:'http://localhost:8788'};" });
    await assert.rejects(() => validateSite(root), /forbidden local reference|fail closed/i);
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

test('validateSite rejects immutable caching inherited by a mutable asset', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-cache-policy-site-'));
  try {
    await createSite(root, {
      headers: `/*
  X-Content-Type-Options: nosniff

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/assets/app.js
  Cache-Control: public, max-age=300, must-revalidate
`
    });
    await assert.rejects(
      () => validateSite(root),
      /non-fingerprinted asset assets\/app\.js inherits immutable caching/i
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validateSite rejects immutable caching inherited by a long-suffix overlay', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-overlay-fingerprint-site-'));
  try {
    await createSite(root, {
      headers: `/*
  X-Content-Type-Options: nosniff

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/assets/app-B4rKOAHV.js
  Cache-Control: public, max-age=31536000, immutable

/assets/metadata-enrichment.css
  Cache-Control: public, max-age=300, must-revalidate
`
    });
    await writeFile(
      path.join(root, 'index.html'),
      '<link rel="manifest" href="./manifest.webmanifest"><link rel="stylesheet" href="./assets/metadata-enrichment.css"><script src="./config.js"></script><script src="./assets/app-B4rKOAHV.js"></script>'
    );
    await unlink(path.join(root, 'assets', 'app.js'));
    await writeFile(path.join(root, 'assets', 'app-B4rKOAHV.js'), 'export {};\n');
    await writeFile(path.join(root, 'assets', 'metadata-enrichment.css'), '/* overlay */\n');
    await writeFile(
      path.join(root, 'sw.js'),
      "const SHELL_ASSETS=['./','./config.js','./assets/app-B4rKOAHV.js','./assets/metadata-enrichment.css'];\n"
    );
    await assert.rejects(
      () => validateSite(root),
      /non-fingerprinted asset assets\/metadata-enrichment\.css inherits immutable caching/i
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validateSite rejects immutable caching on a versionless file outside assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-config-immutable-site-'));
  try {
    await mkdir(path.join(root, 'i18n'), { recursive: true });
    await createSite(root, {
      headers: `/*
  X-Content-Type-Options: nosniff

/config.js
  Cache-Control: public, max-age=31536000, immutable

/i18n/*
  Cache-Control: public, max-age=31536000, immutable
`
    });
    await writeFile(path.join(root, 'i18n', 'en.js'), 'export default {};\n');
    await assert.rejects(
      () => validateSite(root),
      /non-fingerprinted asset (?:config\.js|i18n\/en\.js) inherits immutable caching/i
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});
