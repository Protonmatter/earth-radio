// Pure Passport data and synthetic-clock rules. No account, DOM, network or I/O.
import { COUNTRY_LOCATIONS } from './country-locations.js?v=0.34.1';

export const PASSPORT_LIMITS = Object.freeze({ countries: 300, cities: 1000, bytes: 128_000 });
const MAX_COUNTER = 2_147_483_647, MAX_DAY = 100_000_000, FILE_BYTES = 262_144;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
const invalid = () => failure('PASSPORT_INVALID', 'The Passport data could not be read.');
const full = () => failure('PASSPORT_FULL', 'The Passport is full. Export a copy before clearing history.');
const updateRequired = () => failure('PASSPORT_UPDATE_REQUIRED', 'Update Earth Radio to open this Passport.');
function counter(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COUNTER) throw invalid();
  return value;
}
function timestamp(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw invalid();
  return value;
}
function day(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DAY) throw invalid();
  return value;
}
const countryCode = value => typeof value === 'string' && /^[A-Z]{2}$/.test(value)
  && Object.hasOwn(COUNTRY_LOCATIONS, value) ? value : '';
const cityId = value => typeof value === 'string' && value.length <= 32 && /^ne-[1-9]\d*$/.test(value) ? value : '';
function name(value) {
  if (typeof value !== 'string' || value.length > 512) throw invalid();
  const result = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!result || result.length > 160) throw invalid();
  return result;
}
function dates(value) {
  if (!plain(value)) throw invalid();
  const firstDay = day(value.firstDay), lastDay = day(value.lastDay);
  if (firstDay > lastDay) throw invalid();
  return { firstDay, lastDay };
}
function bounded(value) {
  if (Object.keys(value.countries).length > PASSPORT_LIMITS.countries
      || Object.keys(value.cities).length > PASSPORT_LIMITS.cities
      || jsonBytes(value) > PASSPORT_LIMITS.bytes) throw full();
  return value;
}
export function emptyPassport(epoch = 0, clearedAt = 0) {
  return { version: 1, historyEpoch: counter(epoch), historyClearedAt: timestamp(clearedAt), countries: {}, cities: {} };
}
export function normalizePassport(value) {
  if (value === undefined) return emptyPassport();
  if (!plain(value)) throw invalid();
  if (value.version > 1) throw updateRequired();
  if (value.version !== 1 || !plain(value.countries) || !plain(value.cities)) throw invalid();
  if (Object.keys(value.countries).length > PASSPORT_LIMITS.countries || Object.keys(value.cities).length > PASSPORT_LIMITS.cities) throw full();
  const result = emptyPassport(value.historyEpoch, value.historyClearedAt);
  for (const code of Object.keys(value.countries).sort(compare)) {
    if (!countryCode(code)) throw invalid();
    result.countries[code] = dates(value.countries[code]);
  }
  for (const id of Object.keys(value.cities).sort(compare)) {
    const source = value.cities[id];
    if (!cityId(id) || !plain(source) || !countryCode(source.countrycode)) throw invalid();
    const range = dates(source), parent = result.countries[source.countrycode];
    if (!parent || range.firstDay < parent.firstDay || range.lastDay > parent.lastDay) throw invalid();
    result.cities[id] = { countrycode: source.countrycode, name: name(source.name), ...range };
  }
  return bounded(result);
}
function normalizedPlace(value) {
  if (!plain(value) || !countryCode(value.countrycode)) return null;
  const place = { countrycode: value.countrycode, confidence: 'country' };
  if (value.confidence === 'city' && cityId(value.cityId)) {
    try { return { ...place, confidence: 'city', cityId: value.cityId, city: name(value.city) }; }
    catch { return place; }
  }
  return place;
}
const joinedDates = (left, right) => ({ firstDay: Math.min(left.firstDay, right.firstDay), lastDay: Math.max(left.lastDay, right.lastDay) });
export function recordPassportPlace(value, placeValue, atDay) {
  const doc = normalizePassport(value), place = normalizedPlace(placeValue), at = day(atDay);
  if (!place) return doc;
  const range = { firstDay: at, lastDay: at }, prior = doc.countries[place.countrycode];
  doc.countries[place.countrycode] = prior ? joinedDates(prior, range) : range;
  if (place.confidence === 'city') {
    const previous = doc.cities[place.cityId];
    if (previous && previous.countrycode !== place.countrycode) throw failure('PASSPORT_PLACE_CONFLICT', 'The saved city has conflicting country data.');
    doc.cities[place.cityId] = { countrycode: place.countrycode, name: place.city,
      ...(previous ? joinedDates(previous, range) : range) };
  }
  return normalizePassport(doc);
}
function mergeSameEpoch(a, b) {
  const result = emptyPassport(a.historyEpoch, Math.max(a.historyClearedAt, b.historyClearedAt));
  for (const code of new Set([...Object.keys(a.countries), ...Object.keys(b.countries)])) {
    result.countries[code] = a.countries[code] && b.countries[code]
      ? joinedDates(a.countries[code], b.countries[code]) : { ...(a.countries[code] || b.countries[code]) };
  }
  for (const id of new Set([...Object.keys(a.cities), ...Object.keys(b.cities)])) {
    const left = a.cities[id], right = b.cities[id];
    if (left && right) {
      if (left.countrycode !== right.countrycode) throw failure('PASSPORT_PLACE_CONFLICT', 'The saved city has conflicting country data.');
      result.cities[id] = { countrycode: left.countrycode, name: [left.name, right.name].sort(compare)[0], ...joinedDates(left, right) };
    } else result.cities[id] = { ...(left || right) };
  }
  return normalizePassport(result);
}
export function mergePassports(left, right) {
  const a = normalizePassport(left), b = normalizePassport(right);
  if (a.historyEpoch !== b.historyEpoch) return a.historyEpoch > b.historyEpoch ? a : b;
  return mergeSameEpoch(a, b);
}
export function mergePassportsThreeWay(base, local, remote) {
  if (base !== undefined && (local === undefined || remote === undefined)) return undefined;
  return mergePassports(local, remote);
}
export function addPassportVisits(current, imported) {
  const own = normalizePassport(current), addition = normalizePassport(imported);
  // An explicit import adds positive entries. Foreign clear/setting counters
  // never authorize removal or change the current profile's history policy.
  addition.historyEpoch = own.historyEpoch; addition.historyClearedAt = own.historyClearedAt;
  return mergeSameEpoch(own, addition);
}
export function passportEntries(value) {
  const doc = normalizePassport(value);
  return Object.entries(doc.countries).map(([countrycode, range]) => ({ countrycode, ...range,
    cities: Object.entries(doc.cities).filter(([, row]) => row.countrycode === countrycode).map(([id, row]) => ({ id, ...row })) }));
}
export function exportPassport(value) {
  return JSON.stringify({ format: 'earth-radio-passport', version: 1, value: normalizePassport(value) }, null, 2);
}
export function importPassport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > FILE_BYTES) throw invalid();
  let parsed; try { parsed = JSON.parse(text); } catch { throw invalid(); }
  if (!plain(parsed) || parsed.format !== 'earth-radio-passport' || parsed.version !== 1 || !Object.hasOwn(parsed, 'value')) throw invalid();
  return normalizePassport(parsed.value);
}
function validNamespace(namespace) {
  if (typeof namespace !== 'string' || namespace.length > 512 || namespace !== 'default' && !/^account:.+/.test(namespace)) throw invalid();
  return encodeURIComponent(namespace);
}
export const passportNamespaceKey = namespace => `earth-radio-passport-v1:${validNamespace(namespace)}`;
export const passportSyncStateKey = namespace => `earth-radio-passport-sync-v1:${validNamespace(namespace)}`;
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
const envelopeText = value => JSON.stringify([value.version, value.namespace, value.generation, value.savedAt, value.policyEpoch, value.payload]);
export function encodePassportEnvelope(namespace, generation, value, savedAt) {
  validNamespace(namespace);
  if (!Number.isSafeInteger(generation) || generation < 1) throw invalid();
  savedAt = timestamp(savedAt);
  const doc = value === undefined ? undefined : normalizePassport(value);
  const envelope = { version: 1, namespace, generation, savedAt, policyEpoch: doc?.historyEpoch || 0, payload: JSON.stringify(doc ?? null) };
  envelope.checksum = checksum(envelopeText(envelope)); return envelope;
}
export function decodePassportEnvelope(envelope, namespace) {
  if (!plain(envelope) || envelope.namespace !== namespace) return null;
  if (envelope.version > 1) throw updateRequired();
  if (envelope.version !== 1 || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1
      || !Number.isSafeInteger(envelope.savedAt) || envelope.savedAt < 0 || typeof envelope.payload !== 'string'
      || new TextEncoder().encode(envelope.payload).length > FILE_BYTES || envelope.checksum !== checksum(envelopeText(envelope))) return null;
  try {
    counter(envelope.policyEpoch); timestamp(envelope.savedAt);
    const raw = JSON.parse(envelope.payload), value = raw == null ? undefined : normalizePassport(raw);
    if (value && value.historyEpoch !== envelope.policyEpoch) return null;
    return { namespace, generation: envelope.generation, savedAt: envelope.savedAt, policyEpoch: envelope.policyEpoch, value };
  } catch (error) { if (error.code === 'PASSPORT_UPDATE_REQUIRED') throw error; return null; }
}

export class ContinuousPassportSession {
  constructor({ thresholdMs = 60_000, maxGapMs = 5000 } = {}) {
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0 || thresholdMs > Number.MAX_SAFE_INTEGER / 1000
        || !Number.isFinite(maxGapMs) || maxGapMs <= 0) throw invalid();
    this.thresholdUs = Math.ceil(thresholdMs * 1000); this.maxGapMs = maxGapMs; this.reset();
  }
  reset() { this.previous = null; this.key = ''; this.elapsedUs = 0; this.creditedDay = null; }
  start(input, key) {
    this.key = key; this.previous = { now: input.now, mediaTime: input.mediaTime };
    this.elapsedUs = 0; this.creditedDay = null;
  }
  sample(input) {
    let place;
    try {
      if (!plain(input) || input.ready !== true || input.historyEnabled !== true || input.playing !== true
          || input.muted !== false || input.seeking === true || ![3, 4].includes(input.readyState)
          || typeof input.volume !== 'number' || !Number.isFinite(input.volume) || input.volume <= 0 || input.volume > 1
          || !Number.isFinite(input.now) || input.now < 0 || !Number.isFinite(input.mediaTime) || input.mediaTime < 0
          || !Number.isSafeInteger(input.ownerVersion) || input.ownerVersion < 0
          || typeof input.programKey !== 'string' || !input.programKey || input.programKey.length > 512
          || typeof input.sourceKey !== 'string' || !input.sourceKey || input.sourceKey.length > 8192) throw invalid();
      validNamespace(input.ownerNamespace); counter(input.historyEpoch); counter(input.settingsVersion); day(input.day);
      place = normalizedPlace(input.place); if (!place) throw invalid();
    } catch { this.reset(); return null; }
    const key = JSON.stringify([input.ownerNamespace, input.ownerVersion, input.historyEpoch, input.settingsVersion,
      input.programKey, input.sourceKey, place.countrycode, place.cityId || '']);
    if (!this.previous || key !== this.key) { this.start(input, key); return null; }
    const wallMs = input.now - this.previous.now, mediaSeconds = input.mediaTime - this.previous.mediaTime;
    if (wallMs === 0 && mediaSeconds === 0) return null;
    if (wallMs <= 0 || wallMs > this.maxGapMs || mediaSeconds <= 0 || mediaSeconds > wallMs / 1000 + 0.5) {
      this.start(input, key); return null;
    }
    // Fixed microseconds avoid long fractional accumulations. Media time is
    // quantized to a microsecond; flooring every wall delta ensures the total
    // can never outrun the actually observed monotonic wall intervals.
    const wallUs = Math.floor(wallMs * 1000), mediaUs = Math.round(mediaSeconds * 1_000_000);
    this.elapsedUs = Math.min(this.thresholdUs, this.elapsedUs + Math.max(0, Math.min(wallUs, mediaUs)));
    this.previous = { now: input.now, mediaTime: input.mediaTime };
    if (this.elapsedUs < this.thresholdUs || this.creditedDay !== null && input.day <= this.creditedDay) return null;
    this.creditedDay = input.day;
    return { place, day: input.day, ownerNamespace: input.ownerNamespace, ownerVersion: input.ownerVersion,
      historyEpoch: input.historyEpoch, settingsVersion: input.settingsVersion, programKey: input.programKey, sourceKey: input.sourceKey };
  }
}
