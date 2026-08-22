import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryTree, writeInventory } from '../scripts/recovery-inventory.mjs';

const fixture = new URL('./fixtures/inventory/', import.meta.url);

test('inventoryTree returns sorted portable paths with stable hashes', async () => {
  const rows = await inventoryTree(fixture, 'fixture');
  assert.deepEqual(rows.map(row => row.path), ['a.txt', 'nested/b.txt']);
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
  assert.ok(rows.every(row => row.source === 'fixture'));
});

test('writeInventory emits deterministic JSON without timestamps', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'earth-radio-inventory-'));
  try {
    const output = path.join(scratch, 'manifest.json');
    await writeInventory({ roots: [{ root: fixture, source: 'fixture' }], output });
    const first = await readFile(output, 'utf8');
    await writeInventory({ roots: [{ root: fixture, source: 'fixture' }], output });
    assert.equal(await readFile(output, 'utf8'), first);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
