// Song identity, retention and merge rules. No DOM, network, account or audio I/O.
export const SONG_LIMITS = Object.freeze({ likes: 500, recent: 200, records: 1000, bytes: 512000 });
const MAX_COUNTER = 2147483647;
const ID = /^[a-f0-9]{64}$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const clean = (value, maximum = 200) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum) : '';
const stamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : 0;
const counter = value => {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNTER) throw new Error('Invalid song library counter');
  return value;
};
const next = value => { if (value >= MAX_COUNTER) throw new Error('Song library counter exhausted'); return value + 1; };
const canonical = value => value === undefined ? 'undefined' : value === null || typeof value !== 'object'
  ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical)}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
function full() { const error = new Error('The song library is full. Export a copy and remove some saved songs.'); error.code = 'LIBRARY_FULL'; throw error; }

function providerUrl(value) {
  if (typeof value !== 'string' || value.length > 700) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

function exactTrackUrl(service, value) {
  const url = providerUrl(value); if (!url) return '';
  const host = url.hostname, pathname = url.pathname.replace(/\/$/, '');
  let query = '';
  if (service === 'spotify') {
    if (host !== 'open.spotify.com' || !/^\/(?:intl-[a-z]{2}\/)?track\/[A-Za-z0-9]{22}$/.test(pathname)) return '';
  } else if (service === 'appleMusic') {
    if (host !== 'music.apple.com' || !/^\/[a-z]{2}\/(album|song)\/(?:[^/]+\/)?\d+$/.test(pathname)) return '';
    const id = url.searchParams.get('i');
    if (pathname.includes('/album/')) { if (!/^\d+$/.test(id || '')) return ''; query = `?i=${id}`; }
  } else if (service === 'tidal') {
    if (!['tidal.com', 'listen.tidal.com', 'open.tidal.com'].includes(host) || !/^\/(?:browse\/)?track\/\d+$/.test(pathname)) return '';
  } else if (service === 'youtubeMusic') {
    const id = url.searchParams.get('v');
    if (host !== 'music.youtube.com' || pathname !== '/watch' || !/^[\w-]{11}$/.test(id || '')) return '';
    query = `?v=${id}`;
  } else return '';
  return `https://${host}${pathname}${query}`;
}

export function normalizeSong(value) {
  if (!plain(value) || typeof value.artist !== 'string' || typeof value.title !== 'string' || value.artist.length > 200 || value.title.length > 200) return null;
  const artist = clean(value.artist), title = clean(value.title);
  if (!artist || !title) return null;
  const artwork = providerUrl(value.artworkUrl);
  const artworkUrl = artwork && (/(^|\.)mzstatic\.com$/.test(artwork.hostname) || ['i.scdn.co', 'cdn.listen.moe'].includes(artwork.hostname)) ? artwork.href : '';
  const catalogMatched = value.catalogMatched === true, links = {};
  if (catalogMatched) for (const service of ['spotify', 'appleMusic', 'tidal', 'youtubeMusic']) {
    const href = exactTrackUrl(service, value.links?.[service]); if (href) links[service] = href;
  }
  return { title, artist, album: clean(value.album), genre: clean(value.genre, 100),
    releaseYear: Number.isInteger(Number(value.releaseYear)) && Number(value.releaseYear) >= 1800 && Number(value.releaseYear) <= 2100 ? Number(value.releaseYear) : 0,
    isrc: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(String(value.isrc || '').toUpperCase()) ? String(value.isrc).toUpperCase() : '',
    artworkUrl, links, catalogMatched, confidence: Math.max(0, Math.min(100, Number(value.confidence) || 0)),
    sourceFeed: clean(value.sourceFeed, 80), stationUuid: clean(value.stationUuid, 128), stationName: clean(value.stationName), observedAt: stamp(value.observedAt) };
}

export async function songId(value) {
  const song = normalizeSong(value); if (!song) throw new Error('A song requires an artist and title');
  const key = [song.artist, song.title].map(text => text.normalize('NFKC').toLowerCase()).join('\u0000');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function songServiceLinks(value) {
  const song = normalizeSong(value); if (!song) return [];
  const query = encodeURIComponent(`${song.artist} ${song.title}`);
  return [['spotify', 'Spotify', `https://open.spotify.com/search/${query}`],
    ['appleMusic', 'Apple Music', `https://music.apple.com/search?term=${query}`],
    ['tidal', 'Tidal', `https://tidal.com/search?q=${query}`],
    ['youtubeMusic', 'YouTube Music', `https://music.youtube.com/search?q=${query}`]]
    .map(([key, service, search]) => ({ service, key, href: song.links[key] || search, kind: song.links[key] ? 'track' : 'search' }));
}

export const emptySongLibrary = () => ({ version: 1, historyEpoch: 0, historyClearedAt: 0,
  historyEnabled: true, settingsVersion: 0, tracks: {} });

function normalizeRecord(value, epoch) {
  if (!plain(value)) throw new Error('Invalid song library entry');
  const track = value.track == null ? null : normalizeSong(value.track);
  const record = { track, liked: value.liked === true, likeVersion: counter(value.likeVersion), likeChangedAt: stamp(value.likeChangedAt),
    heardAt: stamp(value.heardAt), heardVersion: counter(value.heardVersion), heardEpoch: counter(value.heardEpoch), heardChangedAt: stamp(value.heardChangedAt),
    stationUuid: clean(value.stationUuid || track?.stationUuid, 128), stationName: clean(value.stationName || track?.stationName) };
  if (record.heardEpoch < epoch) record.heardAt = 0;
  if ((record.liked || record.heardAt) && !track) throw new Error('A saved song requires artist/title information');
  if (!record.liked && !record.heardAt) { record.track = null; record.stationUuid = ''; record.stationName = ''; }
  return record;
}

export function normalizeSongLibrary(value) {
  if (value == null) return emptySongLibrary();
  if (!plain(value) || value.version !== 1) throw new Error('Unsupported song library version');
  if (!plain(value.tracks) || Object.keys(value.tracks).length > SONG_LIMITS.records) throw new Error('Invalid song library records');
  const result = { version: 1, historyEpoch: counter(value.historyEpoch), historyClearedAt: stamp(value.historyClearedAt),
    historyEnabled: value.historyEnabled !== false, settingsVersion: counter(value.settingsVersion), tracks: {} };
  for (const id of Object.keys(value.tracks).sort()) {
    if (!ID.test(id)) throw new Error('Invalid song identifier');
    result.tracks[id] = normalizeRecord(value.tracks[id], result.historyEpoch);
  }
  if (bytes(result) > 1048576) full();
  return result;
}

export function libraryEntries(value, kind = 'recent') {
  const doc = normalizeSongLibrary(value);
  return Object.entries(doc.tracks).filter(([, record]) => record.track && (kind === 'liked' ? record.liked : record.heardAt > 0))
    .map(([id, record]) => ({ id, ...record })).sort((a, b) => (kind === 'liked' ? b.likeChangedAt - a.likeChangedAt : b.heardAt - a.heardAt) || a.id.localeCompare(b.id, 'en'));
}

function bounded(doc) {
  for (const record of Object.values(doc.tracks)) if (!record.liked && !record.heardAt) { record.track = null; record.stationUuid = ''; record.stationName = ''; }
  const entries = Object.entries(doc.tracks);
  if (entries.filter(([, r]) => r.liked).length > SONG_LIMITS.likes) full();
  const recent = entries.filter(([, r]) => r.heardAt).sort(([a, x], [b, y]) => y.heardAt - x.heardAt || a.localeCompare(b, 'en'));
  for (const [, record] of recent.slice(SONG_LIMITS.recent)) {
    record.heardAt = 0; record.heardVersion = next(record.heardVersion);
    if (!record.liked) { record.track = null; record.stationUuid = ''; record.stationName = ''; }
  }
  const discardable = Object.entries(doc.tracks).filter(([, r]) => !r.liked).sort(([a, x], [b, y]) =>
    Number(Boolean(x.track)) - Number(Boolean(y.track)) || Math.max(x.heardAt, x.heardChangedAt, x.likeChangedAt) - Math.max(y.heardAt, y.heardChangedAt, y.likeChangedAt) || a.localeCompare(b, 'en'));
  while (Object.keys(doc.tracks).length > SONG_LIMITS.records || bytes(doc) > SONG_LIMITS.bytes) {
    const candidate = discardable.shift(); if (!candidate) full(); delete doc.tracks[candidate[0]];
  }
  doc.tracks = Object.fromEntries(Object.entries(doc.tracks).sort(([a], [b]) => a.localeCompare(b, 'en')));
  return doc;
}

function entryFor(doc, value, at) {
  if (!ID.test(value?.id || '')) throw new Error('Invalid song identifier');
  const track = normalizeSong({ ...value, observedAt: value.observedAt || at }); if (!track) throw new Error('Invalid song information');
  return doc.tracks[value.id] ||= { track, liked: false, likeVersion: 0, likeChangedAt: 0,
    heardAt: 0, heardVersion: 0, heardEpoch: doc.historyEpoch, heardChangedAt: 0, stationUuid: track.stationUuid, stationName: track.stationName };
}

export function setSongLiked(value, song, liked, at = Date.now()) {
  const doc = normalizeSongLibrary(value);
  applyLike(doc, song, liked, at);
  return bounded(doc);
}

function applyLike(doc, song, liked, at) {
  const record = entryFor(doc, song, at);
  if (record.liked !== Boolean(liked)) { record.liked = Boolean(liked); record.likeVersion = next(record.likeVersion); record.likeChangedAt = stamp(at); }
  record.track = record.liked || record.heardAt ? pickTrack(record.track, normalizeSong({ ...song, observedAt: song.observedAt || at })) : null;
  if (!record.heardAt) { record.stationUuid = clean(song.stationUuid, 128); record.stationName = clean(song.stationName); }
}

export function recordHeardSong(value, song, at = Date.now()) {
  return recordHeardSongs(value, [{ song, at }]);
}

function applyHeard(doc, song, at) {
  const record = entryFor(doc, song, at);
  if (record.heardEpoch === doc.historyEpoch && record.heardAt >= stamp(at)) return;
  if (record.heardAt !== at || record.heardEpoch !== doc.historyEpoch) record.heardVersion = next(record.heardVersion);
  record.heardAt = stamp(at); record.heardChangedAt = stamp(at); record.heardEpoch = doc.historyEpoch;
  record.track = pickTrack(record.track, normalizeSong({ ...song, observedAt: song.observedAt || at }));
  record.stationUuid = clean(song.stationUuid, 128); record.stationName = clean(song.stationName);
}

// A queued observation belongs to the history epoch in which it was heard.
// Storage retries must never resurrect songs after a local or remote clear.
export function recordHeardSongs(value, observations) {
  const doc = normalizeSongLibrary(value); if (!doc.historyEnabled) return doc;
  if (!Array.isArray(observations) || observations.length > SONG_LIMITS.recent) throw new Error('Invalid song observations');
  for (const observation of observations) {
    if (observation.historyEpoch !== undefined && observation.historyEpoch !== doc.historyEpoch) continue;
    applyHeard(doc, observation.song, observation.at);
  }
  return bounded(doc);
}

export function clearSongHistory(value, at = Date.now()) {
  const doc = normalizeSongLibrary(value); if (doc.historyClearedAt === at) return doc;
  doc.historyEpoch = next(doc.historyEpoch); doc.historyClearedAt = stamp(at);
  for (const record of Object.values(doc.tracks)) {
    record.heardAt = 0; record.heardEpoch = doc.historyEpoch; record.heardVersion = next(record.heardVersion); record.heardChangedAt = stamp(at);
    if (!record.liked) record.track = null;
  }
  return bounded(doc);
}

export function removeSong(value, id, at = Date.now()) {
  const doc = normalizeSongLibrary(value), record = doc.tracks[id]; if (!record || (!record.liked && !record.heardAt)) return doc;
  record.liked = false; record.likeVersion = next(record.likeVersion); record.likeChangedAt = stamp(at);
  record.heardAt = 0; record.heardEpoch = doc.historyEpoch; record.heardVersion = next(record.heardVersion); record.heardChangedAt = stamp(at); record.track = null;
  return bounded(doc);
}

export function setSongHistoryEnabled(value, enabled) {
  const doc = normalizeSongLibrary(value);
  if (doc.historyEnabled !== Boolean(enabled)) { doc.historyEnabled = Boolean(enabled); doc.settingsVersion = next(doc.settingsVersion); }
  return doc;
}

// Import is an explicit, non-destructive addition to the current profile. The
// source's clear/remove counters belong to its own library and must not erase
// another profile's songs. New positive intents use the destination's counters.
export function addSongsFromLibrary(destination, source) {
  const result = normalizeSongLibrary(destination), incoming = normalizeSongLibrary(source);
  for (const [id, entry] of Object.entries(incoming.tracks)) if (entry.liked && !result.tracks[id]?.liked) {
    applyLike(result, { ...entry.track, id, stationUuid: entry.stationUuid, stationName: entry.stationName }, true, entry.likeChangedAt);
  }
  if (result.historyEnabled) for (const [id, entry] of Object.entries(incoming.tracks)) {
    if (entry.heardAt > (result.tracks[id]?.heardAt || 0)) applyHeard(result,
      { ...entry.track, id, stationUuid: entry.stationUuid, stationName: entry.stationName }, entry.heardAt);
  }
  return bounded(result);
}

function pickTrack(a, b) {
  if (!a) return b; if (!b) return a;
  const rank = song => Number(song.catalogMatched) * 10000 + ['album', 'genre', 'releaseYear', 'isrc', 'artworkUrl'].filter(key => Boolean(song[key])).length * 100 + song.confidence;
  return rank(a) !== rank(b) ? rank(a) > rank(b) ? a : b : a.observedAt !== b.observedAt ? a.observedAt > b.observedAt ? a : b : canonical(a) > canonical(b) ? a : b;
}

function mergeRecord(a, b, base, epoch) {
  if (!a) return b && normalizeRecord(b, epoch); if (!b) return normalizeRecord(a, epoch);
  let like = a.likeVersion !== b.likeVersion ? a.likeVersion > b.likeVersion ? a : b
    : a.liked !== b.liked ? a.liked ? b : a : a.likeChangedAt > b.likeChangedAt ? a : b;
  let heard = a.heardEpoch !== b.heardEpoch ? a.heardEpoch > b.heardEpoch ? a : b
    : a.heardVersion !== b.heardVersion ? a.heardVersion > b.heardVersion ? a : b
      : Boolean(a.heardAt) !== Boolean(b.heardAt) ? a.heardAt ? b : a
        : a.heardAt !== b.heardAt ? a.heardAt > b.heardAt ? a : b : a.heardChangedAt > b.heardChangedAt ? a : b;
  if (base) {
    const changed = (record, keys) => keys.some(key => record[key] !== base[key]);
    if (changed(a, ['likeVersion', 'liked']) && changed(b, ['likeVersion', 'liked']) && a.liked !== b.liked) like = a.liked ? b : a;
    if (changed(a, ['heardEpoch', 'heardVersion', 'heardAt']) && changed(b, ['heardEpoch', 'heardVersion', 'heardAt']) && Boolean(a.heardAt) !== Boolean(b.heardAt)) heard = a.heardAt ? b : a;
  }
  const context = heard.heardAt ? heard : like;
  return normalizeRecord({ track: pickTrack(a.track, b.track), liked: like.liked, likeVersion: Math.max(a.likeVersion, b.likeVersion), likeChangedAt: like.likeChangedAt,
    stationUuid: context.stationUuid, stationName: context.stationName,
    heardAt: heard.heardAt, heardVersion: Math.max(a.heardVersion, b.heardVersion), heardEpoch: Math.max(a.heardEpoch, b.heardEpoch), heardChangedAt: heard.heardChangedAt }, epoch);
}

function mergeLibraries(left, right, baseline) {
  const a = normalizeSongLibrary(left), b = normalizeSongLibrary(right), base = baseline && normalizeSongLibrary(baseline);
  const doc = emptySongLibrary(); doc.historyEpoch = Math.max(a.historyEpoch, b.historyEpoch);
  doc.historyClearedAt = a.historyEpoch !== b.historyEpoch ? a.historyEpoch > b.historyEpoch ? a.historyClearedAt : b.historyClearedAt : Math.max(a.historyClearedAt, b.historyClearedAt);
  doc.settingsVersion = Math.max(a.settingsVersion, b.settingsVersion);
  doc.historyEnabled = a.settingsVersion !== b.settingsVersion ? a.settingsVersion > b.settingsVersion ? a.historyEnabled : b.historyEnabled : a.historyEnabled && b.historyEnabled;
  for (const id of new Set([...Object.keys(a.tracks), ...Object.keys(b.tracks)])) {
    if (base?.tracks[id] && (!a.tracks[id] || !b.tracks[id])) continue;
    doc.tracks[id] = mergeRecord(a.tracks[id], b.tracks[id], base?.tracks[id], doc.historyEpoch);
  }
  return bounded(doc);
}
export const mergeSongLibraries = (left, right) => mergeLibraries(left, right);
export function mergeSongLibrariesThreeWay(base, local, remote) {
  if (base !== undefined && (local === undefined || remote === undefined)) return undefined;
  return mergeLibraries(local, remote, base);
}

export class ListeningSession {
  constructor({ minimumSeconds = 15 } = {}) {
    if (!Number.isFinite(minimumSeconds) || minimumSeconds <= 0) throw new Error('Invalid listening duration');
    this.minimumSeconds = minimumSeconds; this.setTrack(null);
  }
  setTrack(track) {
    const key = track?.id && track?.stationUuid ? `${track.stationUuid}:${track.id}` : '';
    if (key === this.key && key) { this.track = track; return; }
    this.key = key; this.track = key ? track : null; this.seconds = 0; this.last = null; this.qualified = false;
  }
  sample({ mediaTime, now, playing, seeking = false }) {
    if (!this.track || !playing || seeking || !Number.isFinite(mediaTime) || !Number.isFinite(now)) { this.last = null; return null; }
    const previous = this.last; this.last = { mediaTime, now };
    if (!previous || this.qualified) return null;
    const wall = (now - previous.now) / 1000, delta = mediaTime - previous.mediaTime;
    // Audio progress is independent of animation frames. Reject seek/discontinuity
    // jumps; count elapsed audible-app time rather than accelerated media time.
    if (wall > 0 && delta > 0 && delta <= wall * 1.5 + 0.5) this.seconds += Math.min(wall, delta);
    if (this.seconds + 1e-6 < this.minimumSeconds) return null;
    this.qualified = true; return { ...this.track, heardSeconds: this.seconds };
  }
}

export const exportSongLibrary = (value, at = Date.now()) => JSON.stringify({ format: 'earth-radio-songs', version: 1, exportedAt: new Date(at).toISOString(), value: normalizeSongLibrary(value) }, null, 2);
export function importSongLibrary(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2097152) throw new Error('Invalid song library file');
  let data; try { data = JSON.parse(text); } catch { throw new Error('The song library file is not valid JSON'); }
  if (data?.format !== 'earth-radio-songs' || data.version !== 1) throw new Error('Unsupported song library file version');
  return bounded(normalizeSongLibrary(data.value));
}

function validNamespace(namespace) {
  if (typeof namespace !== 'string' || namespace.length > 512 || (namespace !== 'default' && !/^account:.+/.test(namespace))) throw new Error('Invalid library namespace');
  return encodeURIComponent(namespace);
}
export const songNamespaceKey = namespace => `earth-radio-songs-v1:${validNamespace(namespace)}`;
export const songSyncStateKey = namespace => `earth-radio-song-sync-v1:${validNamespace(namespace)}`;
function checksum(value) {
  let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
const envelopeText = value => canonical([value.version, value.namespace, value.generation, value.savedAt, value.payload]);
export function encodeSongEnvelope(namespace, generation, value, savedAt = Date.now()) {
  validNamespace(namespace);
  if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(savedAt) || savedAt < 0) throw new Error('Invalid library envelope');
  const envelope = { version: 1, namespace, generation, savedAt, payload: JSON.stringify(value === undefined ? null : normalizeSongLibrary(value)) };
  envelope.checksum = checksum(envelopeText(envelope)); return envelope;
}
export function decodeSongEnvelope(envelope, namespace) {
  if (envelope?.version !== 1 || envelope.namespace !== namespace || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1 || !Number.isSafeInteger(envelope.savedAt) || envelope.savedAt < 0 ||
      typeof envelope.payload !== 'string' || new TextEncoder().encode(envelope.payload).length > 1048576 || envelope.checksum !== checksum(envelopeText(envelope))) return null;
  try {
    const value = JSON.parse(envelope.payload);
    return { version: 1, namespace, generation: envelope.generation, savedAt: envelope.savedAt,
      value: value == null ? undefined : normalizeSongLibrary(value), checksum: envelope.checksum };
  }
  catch { return null; }
}
