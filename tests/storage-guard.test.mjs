// The storage guard's restore decision must distinguish intentional deletion from
// primary-store loss. These unit tests pin the exported pure helpers; the end-to-end
// eviction/restore and intentional-deletion flows run in tests/e2e/reliability.spec.mjs.

import assert from 'node:assert/strict';
import test from 'node:test';
import { checksum, hasUserSubstance, shouldRestore } from '../site/assets/storage-guard.js';

test('valid primary generation makes intentional empty data authoritative', () => {
  assert.equal(shouldRestore({
    primaryGeneration: 'g-7',
    backup: { generation: 'g-6', data: { favorites: { old: {} } } },
    restoreAttempts: 0
  }), false);
});

test('missing primary generation restores a valid substantive backup', () => {
  assert.equal(shouldRestore({
    primaryGeneration: '',
    backup: { generation: 'g-6', data: { favorites: { saved: {} } } },
    restoreAttempts: 0
  }), true);
});

test('restoration never runs without a decodable backup', () => {
  assert.equal(shouldRestore({ primaryGeneration: '', backup: null, restoreAttempts: 0 }), false);
  assert.equal(shouldRestore({ primaryGeneration: '', backup: {}, restoreAttempts: 0 }), false);
  assert.equal(shouldRestore({ primaryGeneration: '', backup: { data: 'corrupt' }, restoreAttempts: 0 }), false);
});

test('the per-tab-session attempt cap stops restore loops', () => {
  const backup = { generation: 'g-3', data: { favorites: { saved: {} } } };
  assert.equal(shouldRestore({ primaryGeneration: '', backup, restoreAttempts: 1 }), true);
  assert.equal(shouldRestore({ primaryGeneration: '', backup, restoreAttempts: 2 }), false);
  assert.equal(shouldRestore({ primaryGeneration: '', backup, restoreAttempts: 99 }), false);
});

test('checksum detects torn backup payloads', () => {
  const payload = JSON.stringify({ favorites: { a: { name: 'Radio' } } });
  assert.equal(checksum(payload), checksum(payload));
  assert.notEqual(checksum(payload), checksum(payload.slice(0, -2)));
});

test('substance means records a user would miss, not re-seeded defaults', () => {
  assert.equal(hasUserSubstance({ favorites: { a: {} } }), true);
  assert.equal(hasUserSubstance({ recents: [{ stationuuid: 'x' }] }), true);
  assert.equal(hasUserSubstance({ lastPlayed: { stationuuid: 'x' } }), true);
  assert.equal(hasUserSubstance({ favorites: {}, recents: [], prefs: { theme: 'dark' } }), false);
  assert.equal(hasUserSubstance(null), false);
});

test('restore commits backup data and the generation marker in one transaction', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const source = await readFile(path.resolve(import.meta.dirname, '..', 'site', 'assets', 'storage-guard.js'), 'utf8');
  // The restore path builds one entries list (records + marker) and commits it via
  // idbSetMany's single readwrite transaction — never one transaction per key.
  assert.match(source, /idbSetMany\(db, \[\.\.\.dataEntries, meta\]\)/);
  assert.match(source, /for \(const \[key, value\] of entries\) store\.put\(value, key\);/);
});
