import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseNetworkProxyRule, withDesktopProxyOrigin } from '../electron/proxy-rules.mjs';
import desktopPackageCompatibility from '../scripts/desktop-package-compat.mjs';

test('Windows packaging pins the legacy-compatible filter without changing other platforms', () => {
  const env = { EXISTING: 'preserved', ELECTRON_BUILDER_7Z_FILTER: 'ARM64' };
  desktopPackageCompatibility({ electronPlatformName: 'win32' }, env);
  assert.deepEqual(env, { EXISTING: 'preserved', ELECTRON_BUILDER_7Z_FILTER: 'BCJ' });
  const otherEnv = { ELECTRON_BUILDER_7Z_FILTER: 'ARM' };
  desktopPackageCompatibility({ electronPlatformName: 'linux' }, otherEnv);
  assert.deepEqual(otherEnv, { ELECTRON_BUILDER_7Z_FILTER: 'ARM' });
});

const originFixture = patch => ({ requestUrl: `http://127.0.0.1:43210/${'x'.repeat(32)}/api/stations/top`,
  proxyBaseUrl: `http://127.0.0.1:43210/${'x'.repeat(32)}`, webContentsId: 7, expectedWebContentsId: 7,
  documentUrl: 'file:///candidate/site/index.html#station=fixture', expectedDocumentUrl: 'file:///candidate/site/index.html',
  requestHeaders: { Accept: 'application/json' }, ...patch });

test('owned file renderer can assert its opaque Origin only on the per-launch API route', () => {
  const input = originFixture();
  assert.deepEqual(withDesktopProxyOrigin(input), { Accept: 'application/json', Origin: 'null' });
  assert.deepEqual(input.requestHeaders, { Accept: 'application/json' });
});

for (const [reason, patch] of [
  ['another window', { webContentsId: 8 }],
  ['missing window identity', { webContentsId: undefined, expectedWebContentsId: undefined }],
  ['remote document', { documentUrl: 'https://untrusted.example/' }],
  ['another local document', { documentUrl: 'file:///untrusted/index.html' }],
  ['another loopback port', { requestUrl: `http://127.0.0.1:43211/${'x'.repeat(32)}/api/stations/top` }],
  ['missing capability', { requestUrl: 'http://127.0.0.1:43210/api/stations/top' }],
  ['capability prefix collision', { requestUrl: `http://127.0.0.1:43210/${'x'.repeat(32)}extra/api/stations/top` }],
  ['non-loopback proxy', { proxyBaseUrl: `https://untrusted.example/${'x'.repeat(32)}` }],
  ['malformed endpoint', { requestUrl: 'not a URL' }],
  ['existing untrusted Origin', { requestHeaders: { origin: 'https://untrusted.example' } }],
  ['existing opaque Origin', { requestHeaders: { Origin: 'null' } }]
]) {
  test(`desktop Origin assertion leaves ${reason} unchanged`, () => {
    const input = originFixture(patch);
    assert.equal(withDesktopProxyOrigin(input), input.requestHeaders);
  });
}

test('Supabase CI runs database tests and the local PKCE auth workflow without secrets', async () => {
  const workflow = await readFile(path.resolve(import.meta.dirname, '..', '.github', 'workflows', 'supabase.yml'), 'utf8');
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.match(workflow, /supabase db start/);
  assert.match(workflow, /supabase test db/);
  assert.match(workflow, /supabase start -x studio,imgproxy,logflare,vector,supavisor/);
  assert.match(workflow, /AUTH_INTEGRATION/);
  assert.match(workflow, /tests\/auth-local-gotrue\.test\.mjs/);
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map(match => match[1]);
  assert.ok(uses.length >= 3);
  for (const action of uses) assert.match(action, /@[a-f0-9]{40}$/, `action is not immutable: ${action}`);
});

test('CI is read-only, cross-platform, and immutably pinned', async () => {
  const workflow = await readFile(path.resolve(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /(?:contents|pages|id-token): write/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /smoke-recovery-import\.ps1/);
  assert.match(workflow, /upload-artifact@/);
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map(match => match[1]);
  assert.ok(uses.length >= 3);
  for (const action of uses) assert.match(action, /@[a-f0-9]{40}$/, `action is not immutable: ${action}`);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
});

test('desktop packaging excludes examples and runtime-unneeded dependencies', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const builder = await readFile(path.join(root, 'electron-builder.yml'), 'utf8');
  const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(builder, /!server\/example-proxy\.mjs/);
  assert.deepEqual(packageMetadata.dependencies ?? {}, {});
});

test('Windows installer and portable targets cannot overwrite the same executable artifact', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8');
  const pattern = target => source.match(new RegExp(`^${target}:\\r?\\n((?:[ \\t].*\\r?\\n|\\r?\\n)*)`, 'm'))?.[1]
    .match(/^ {2}artifactName:\s*(.+)$/m)?.[1]?.trim();
  const installer = pattern('nsis'), portable = pattern('portable');
  assert.ok(installer, 'NSIS must have an explicit artifact name');
  assert.ok(portable, 'Portable must have an explicit artifact name');
  assert.notEqual(installer, portable, 'Both targets have the same version, architecture and exe extension');
  assert.match(source, /^beforePack: scripts\/desktop-package-compat\.mjs$/m);
  assert.match(source, /^ {2}useZip: false$/m, 'Both targets must consume the same compatible 7z archive');
});

test('desktop proxy settings parse complete supported URLs instead of a prefix regex', async () => {
  const main = await readFile(path.resolve(import.meta.dirname, '..', 'electron', 'main.mjs'), 'utf8');
  assert.match(main, /parseNetworkProxyRule\(rawValue\)/);
  assert.doesNotMatch(main, /https\?:\\\/\\\/\|socks5\?:\\\/\\\//);
  for (const value of [
    'direct',
    'proxy.example:8080',
    'proxy.example:80',
    'http://proxy.example:8080',
    'http://proxy.example:80',
    'https://proxy.example:8443',
    'https://proxy.example:443',
    'socks5://proxy.example:1080',
    '[::1]:8080',
    '[::1]:80'
  ]) {
    assert.equal(parseNetworkProxyRule(value), value);
  }
  for (const value of ['http://', 'ftp://proxy.example:21', 'http://proxy.example', 'http://user:pass@proxy.example:8080', 'http://proxy.example:8080/path']) {
    assert.throws(() => parseNetworkProxyRule(value), /invalid proxy rule/i);
  }
});
