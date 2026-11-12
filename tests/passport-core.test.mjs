import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PASSPORT_LIMITS, emptyPassport, normalizePassport, recordPassportPlace,
  mergePassports, mergePassportsThreeWay, addPassportVisits, passportEntries,
  passportNamespaceKey, passportSyncStateKey, encodePassportEnvelope,
  decodePassportEnvelope, exportPassport, importPassport, ContinuousPassportSession
} from '../site/assets/passport-core.js';

// Synthetic clocks and place IDs exercise app rules, not physical listening.
const DAY = 20_000;
const country = code => ({ countrycode: code, confidence: 'country' });
const city = (id = 'ne-900000001', code = 'KR') => ({ countrycode: code,
  confidence: 'city', cityId: id, city: 'Fixture City' });
const input = (time, patch = {}) => ({ now: time, mediaTime: time / 1000, day: DAY,
  ownerNamespace: 'default', ownerVersion: 1, historyEpoch: 0, settingsVersion: 0,
  historyEnabled: true, ready: true, programKey: 'fixture-program', sourceKey: 'fixture-source',
  place: country('US'), playing: true, muted: false, volume: 0.5,
  readyState: 4, seeking: false, ...patch });
function sampleRun(session, start, end, patch = {}, step = 1000) {
  let result = null;
  for (let time = start; time <= end; time += step) result = session.sample(input(time, patch)) || result;
  return result;
}
const saved = (code = 'US', day = DAY, epoch = 0) => recordPassportPlace(emptyPassport(epoch), country(code), day);
const errorCode = code => error => error.code === code;

test('synthetic continuous media earns nothing before a minute and emits one fenced observation', () => {
  const session = new ContinuousPassportSession();
  assert.equal(sampleRun(session, 0, 59_000), null);
  assert.equal(session.sample(input(59_999)), null);
  const observed = session.sample(input(60_000));
  assert.equal(observed.place.countrycode, 'US');
  assert.equal(observed.ownerNamespace, 'default');
  assert.equal(observed.ownerVersion, 1); assert.equal(observed.historyEpoch, 0);
  assert.equal(observed.day, DAY);
  assert.equal(sampleRun(session, 61_000, 75_000), null);
  assert.ok(session.sample(input(76_000, { day: DAY + 1 })));
  assert.equal(session.sample(input(77_000, { day: DAY + 1 })), null);
});

for (const [label, patch] of [
  ['pause', { playing: false }], ['stall', { readyState: 2 }],
  ['mute', { muted: true }], ['zero volume', { volume: 0 }],
  ['seek', { seeking: true }], ['unready owner', { ready: false }],
  ['history off', { historyEnabled: false }]
]) test(`${label} discards prior time rather than accumulating across an interruption`, () => {
  const session = new ContinuousPassportSession(); sampleRun(session, 0, 55_000);
  assert.equal(session.sample(input(56_000, patch)), null);
  assert.equal(sampleRun(session, 57_000, 116_000), null);
  assert.ok(session.sample(input(117_000)));
});

for (const [label, patch] of [
  ['account', { ownerNamespace: 'account:fixture-b', ownerVersion: 2 }],
  ['owner version', { ownerVersion: 2 }], ['clear epoch', { historyEpoch: 1 }],
  ['settings version', { settingsVersion: 1 }], ['program', { programKey: 'other-program' }],
  ['source', { sourceKey: 'other-source' }], ['place', { place: country('KR') }]
]) test(`${label} starts a fresh continuous run with its own fence`, () => {
  const session = new ContinuousPassportSession(); sampleRun(session, 0, 55_000);
  assert.equal(sampleRun(session, 56_000, 115_000, patch), null);
  const result = session.sample(input(116_000, patch)); assert.ok(result);
  assert.equal(result.ownerVersion, patch.ownerVersion || 1);
  assert.equal(result.historyEpoch, patch.historyEpoch || 0);
});

test('a five-second gap is bounded and a larger background gap discards the run', () => {
  const allowed = new ContinuousPassportSession(); sampleRun(allowed, 0, 55_000);
  assert.ok(allowed.sample(input(60_000)));
  const rejected = new ContinuousPassportSession(); sampleRun(rejected, 0, 55_000);
  assert.equal(rejected.sample(input(60_001)), null);
  assert.equal(sampleRun(rejected, 61_001, 119_001), null);
  assert.ok(rejected.sample(input(120_001)));
});

test('seek jumps, reversed clocks, no media progress and invalid samples never earn a minute', () => {
  for (const patch of [{ mediaTime: 600 }, { now: -1 }, { now: NaN },
    { mediaTime: Infinity }, { mediaTime: -1 }, { volume: NaN },
    { day: -1 }, { ownerVersion: -1 }, { place: country('ZZ') },
    { ownerNamespace: 'unexpected' }, { sourceKey: '' }, { historyEpoch: NaN },
    { settingsVersion: -1 }, { readyState: 5 }, { now: Infinity }]) {
    const session = new ContinuousPassportSession(); sampleRun(session, 0, 55_000);
    assert.equal(session.sample(input(56_000, patch)), null);
    assert.equal(sampleRun(session, 57_000, 60_000), null);
  }
  const stalled = new ContinuousPassportSession(); sampleRun(stalled, 0, 55_000);
  assert.equal(stalled.sample(input(56_000, { mediaTime: 55 })), null);
  assert.equal(sampleRun(stalled, 57_000, 61_000), null);
});

test('media and wall progress both bound earned time; explicit reset discards it', () => {
  const slow = new ContinuousPassportSession();
  for (let t = 0; t <= 60_000; t += 1000) assert.equal(slow.sample(input(t, { mediaTime: t / 2000 })), null);
  slow.reset(); assert.equal(sampleRun(slow, 61_000, 120_000), null);
  assert.ok(slow.sample(input(121_000)));
  assert.throws(() => new ContinuousPassportSession({ thresholdMs: 0 }));
  assert.throws(() => new ContinuousPassportSession({ maxGapMs: Infinity }));
});

test('country-only and coordinate-only metadata never manufacture a city', () => {
  let doc = recordPassportPlace(emptyPassport(), { ...city(), confidence: 'country' }, DAY);
  doc = recordPassportPlace(doc, { ...city(), confidence: 'exact' }, DAY + 1);
  assert.deepEqual(doc.countries.KR, { firstDay: DAY, lastDay: DAY + 1 });
  assert.deepEqual(doc.cities, {});
  assert.deepEqual(recordPassportPlace(doc, country('ZZ'), DAY), doc);
  const full = recordPassportPlace(doc, city(), DAY + 2);
  assert.equal(Object.keys(full.cities).length, 1);
  assert.deepEqual(full.cities['ne-900000001'], { countrycode: 'KR', name: 'Fixture City', firstDay: DAY + 2, lastDay: DAY + 2 });
});

test('visit dates are idempotent, bounded and independent of the original object', () => {
  const original = saved(), next = recordPassportPlace(original, country('US'), DAY - 1);
  assert.deepEqual(original.countries.US, { firstDay: DAY, lastDay: DAY });
  assert.deepEqual(next.countries.US, { firstDay: DAY - 1, lastDay: DAY });
  assert.deepEqual(recordPassportPlace(next, country('US'), DAY), next);
  assert.throws(() => recordPassportPlace(next, country('US'), -1));
  assert.throws(() => recordPassportPlace(next, country('US'), 1.5));
});

test('normalization is deterministic, drops unrelated fields and retains valid future city IDs', () => {
  const doc = recordPassportPlace(saved('US'), city('ne-900000099'), DAY);
  const normalized = normalizePassport({ ...doc, access_token: 'synthetic-not-a-token', coordinates: [1, 2] });
  assert.deepEqual(normalizePassport(normalized), normalized);
  assert.deepEqual(Object.keys(normalized.countries), ['KR', 'US']);
  assert.equal(normalized.cities['ne-900000099'].name, 'Fixture City');
  assert.doesNotMatch(JSON.stringify(normalized), /synthetic|coordinates|access_token/);
  assert.deepEqual(passportEntries(normalized).map(row => row.countrycode), ['KR', 'US']);
});

test('malformed/future schemas, prototype names and contradictory locations fail closed', () => {
  for (const value of [null, [], 'text', { version: 0 }, { ...emptyPassport(), historyEpoch: -1 },
    { ...emptyPassport(), countries: { ZZ: { firstDay: 1, lastDay: 2 } } },
    { ...emptyPassport(), countries: { US: { firstDay: 2, lastDay: 1 } } },
    { ...emptyPassport(), cities: { 'ne-1': { countrycode: 'US', name: 'Fixture', firstDay: 1, lastDay: 2 } } },
    { ...emptyPassport(), cities: JSON.parse('{"__proto__":{"countrycode":"US"}}') }]) {
    assert.throws(() => normalizePassport(value));
  }
  assert.throws(() => normalizePassport({ ...emptyPassport(), version: 2 }), errorCode('PASSPORT_UPDATE_REQUIRED'));
  assert.throws(() => normalizePassport(Object.assign(Object.create({ polluted: true }), emptyPassport())));
  assert.equal(Object.prototype.polluted, undefined);
});

test('same-epoch merges converge and higher clear epochs remove old observations', () => {
  const a = saved('US', DAY), b = saved('KR', DAY + 1);
  assert.deepEqual(mergePassports(a, b), mergePassports(b, a));
  assert.deepEqual(mergePassports(a, a), a);
  assert.equal(Object.keys(mergePassports(a, b).countries).length, 2);
  const cleared = emptyPassport(1, 100);
  assert.deepEqual(mergePassports(mergePassports(a, b), cleared), cleared);
  assert.deepEqual(mergePassports(cleared, a), cleared);
  const fresh = recordPassportPlace(cleared, country('CA'), DAY + 2);
  assert.deepEqual(Object.keys(mergePassports(fresh, b).countries), ['CA']);
});

test('conflicting country assignments for one city ID fail without mutating either document', () => {
  const a = recordPassportPlace(emptyPassport(), city('ne-900000001', 'US'), DAY);
  const b = recordPassportPlace(emptyPassport(), city('ne-900000001', 'KR'), DAY);
  const before = structuredClone([a, b]);
  assert.throws(() => mergePassports(a, b), errorCode('PASSPORT_PLACE_CONFLICT'));
  assert.throws(() => addPassportVisits(a, b), errorCode('PASSPORT_PLACE_CONFLICT'));
  assert.deepEqual([a, b], before);
});

test('a clock-day rewind does not repeatedly emit an already credited day', () => {
  const session = new ContinuousPassportSession(); assert.ok(sampleRun(session, 0, 60_000));
  assert.ok(session.sample(input(61_000, { day: DAY + 1 })));
  assert.equal(session.sample(input(62_000, { day: DAY })), null);
  assert.equal(session.sample(input(63_000, { day: DAY + 1 })), null);
});

test('three-way merge preserves whole-document tombstones and clear over stale offline additions', () => {
  const base = saved(), local = recordPassportPlace(base, country('KR'), DAY);
  assert.equal(mergePassportsThreeWay(base, local, undefined), undefined);
  assert.equal(mergePassportsThreeWay(base, undefined, local), undefined);
  assert.deepEqual(mergePassportsThreeWay(base, local, emptyPassport(1, 900)), emptyPassport(1, 900));
});

test('explicit imports add positive visits into the current epoch without importing clears', () => {
  const current = saved('US', DAY, 3), source = saved('KR', DAY - 1, 99);
  const result = addPassportVisits(current, source);
  assert.equal(result.historyEpoch, 3); assert.equal(result.historyClearedAt, current.historyClearedAt);
  assert.deepEqual(Object.keys(result.countries), ['KR', 'US']);
  assert.deepEqual(addPassportVisits(result, emptyPassport(999, 9999)), result);
  assert.deepEqual(addPassportVisits(result, source), result);
});

test('exports round-trip only bounded Passport data and reject unsupported/hostile files', () => {
  const doc = recordPassportPlace(saved(), city(), DAY);
  assert.deepEqual(importPassport(exportPassport(doc)), doc);
  for (const text of ['bad json', '{}', '[]', '{"format":"earth-radio-passport","version":1}', '{"format":"earth-radio-passport","version":2,"value":{}}',
    JSON.stringify({ format: 'earth-radio-passport', version: 1, value: { version: 2 } }), 'x'.repeat(300_000)]) {
    assert.throws(() => importPassport(text));
  }
});

test('envelopes are namespace-bound and integrity checked; missing values remain tombstones', () => {
  const doc = saved(), ns = 'account:fixture-a', encoded = encodePassportEnvelope(ns, 1, doc, 100);
  assert.deepEqual(decodePassportEnvelope(encoded, ns).value, doc);
  assert.equal(encoded.policyEpoch, doc.historyEpoch);
  assert.equal(decodePassportEnvelope(encoded, 'account:fixture-b'), null);
  assert.equal(decodePassportEnvelope({ ...encoded, payload: encoded.payload + ' ' }, ns), null);
  assert.equal(decodePassportEnvelope({ ...encoded, checksum: 'broken' }, ns), null);
  assert.equal(decodePassportEnvelope(encodePassportEnvelope(ns, 2, undefined, 101), ns).value, undefined);
  assert.throws(() => decodePassportEnvelope({ ...encoded, version: 2 }, ns), errorCode('PASSPORT_UPDATE_REQUIRED'));
  assert.notEqual(passportNamespaceKey(ns), passportNamespaceKey('account:fixture-b'));
  assert.notEqual(passportNamespaceKey(ns), passportSyncStateKey(ns));
  assert.throws(() => encodePassportEnvelope('unexpected', 1, doc, 100));
});

test('capacity and UTF-8 limits fail without mutating the prior value', () => {
  assert.equal(PASSPORT_LIMITS.countries, 300); assert.equal(PASSPORT_LIMITS.cities, 1000);
  assert.equal(PASSPORT_LIMITS.bytes, 128_000);
  const full = saved('US');
  for (let i = 1; i <= 1000; i++) full.cities['ne-' + (900000000 + i)] = { countrycode: 'US', name: 'Fixture', firstDay: DAY, lastDay: DAY };
  const normalized = normalizePassport(full), before = structuredClone(normalized);
  assert.throws(() => recordPassportPlace(normalized, city('ne-999999999', 'US'), DAY), errorCode('PASSPORT_FULL'));
  assert.deepEqual(normalized, before);
  const large = structuredClone(full); for (const row of Object.values(large.cities)) row.name = '界'.repeat(150);
  assert.throws(() => normalizePassport(large), errorCode('PASSPORT_FULL'));
});
