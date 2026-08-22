import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseNetworkProxyRule } from '../electron/proxy-rules.mjs';

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
