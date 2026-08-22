import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stageSite } from '../scripts/stage-site.mjs';

async function exists(file) {
  try { await readFile(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

test('stageSite excludes source maps and writes a deterministic manifest', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-stage-'));
  try {
    const source = path.join(scratch, 'site');
    const output = path.join(scratch, '.build', 'site');
    await mkdir(path.join(source, 'assets'), { recursive: true });
    await writeFile(path.join(source, 'index.html'), '<script src="./assets/app.js"></script>');
    await writeFile(path.join(source, 'assets', 'app.js'), 'export const ok = true;\n');
    await writeFile(path.join(source, 'assets', 'app.js.map'), '{}\n');
    const first = await stageSite({ source, output, allowedOutputParent: scratch });
    const firstManifest = await readFile(path.join(output, 'asset-manifest.json'), 'utf8');
    const second = await stageSite({ source, output, allowedOutputParent: scratch });
    assert.deepEqual(first, second);
    assert.equal(await exists(path.join(output, 'assets', 'app.js.map')), false);
    assert.equal(await readFile(path.join(output, 'asset-manifest.json'), 'utf8'), firstManifest);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('stageSite rejects symbolic links', async t => {
  if (process.platform === 'win32') t.skip('symbolic-link creation requires elevated Windows policy');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-stage-link-'));
  try {
    const source = path.join(scratch, 'site');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(scratch, 'outside.txt'), 'outside');
    await symlink(path.join(scratch, 'outside.txt'), path.join(source, 'linked.txt'));
    await assert.rejects(
      () => stageSite({ source, output: path.join(scratch, '.build', 'site'), allowedOutputParent: scratch }),
      /symbolic link/i
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
