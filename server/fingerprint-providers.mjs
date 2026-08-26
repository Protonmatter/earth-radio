// Earth Radio on-demand audio fingerprinting.
// Samples a short window of encoded audio bytes directly from a station stream and
// submits it to a configured recognition provider (ACRCloud or AudD). Both accept
// encoded MP3/AAC bytes, so no decoding happens here. Fingerprinting is strictly
// opt-in: without provider credentials in the environment every request short-circuits.
// Recognition APIs are metered, so results are cached and deduplicated per stream URL.

import { createHmac } from 'node:crypto';
import { requestPublic } from './net-guard.mjs';
import { createBoundedTtlCache, resolveWithCache } from './shared-cache.mjs';

const USER_AGENT = 'EarthRadio/0.24.0 fingerprint (+https://github.com/Protonmatter/EarthRadio)';
const ACR_IDENTIFY_PATH = '/v1/identify';
const AUDD_IDENTIFY_URL = 'https://api.audd.io/';
const DEFAULT_SAMPLE_SECONDS = 12;
const MAX_SAMPLE_SECONDS = 20;
const MIN_SAMPLE_BYTES = 96 * 1024;
// Below this the sample is too short for any provider to fingerprint reliably.
const MIN_RECOGNIZE_BYTES = 16 * 1024;
const MAX_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_BITRATE_KBPS = 160;
const SAMPLE_TIMEOUT_MS = 20_000;
const RECOGNIZE_TIMEOUT_MS = 15_000;
const CACHE_MAX_ENTRIES = 128;
// Positive results must expire before the client's 30s retry cooldown: after a track
// change, a retry must sample the current audio, not replay the previous song.
export const CACHE_TTL_HIT_MS = 25 * 1000;
const CACHE_TTL_MISS_MS = 30 * 1000;
const PLAYLIST_MAX_BYTES = 64 * 1024;
const HLS_SEGMENT_COUNT = 3;
const MAX_HLS_PLAYLIST_DEPTH = 2;

const fingerprintCache = createBoundedTtlCache({ maxEntries: CACHE_MAX_ENTRIES });
const inFlight = new Map();

export function fingerprintProviders(env = process.env) {
  const providers = [];
  if (env.ACR_HOST && env.ACR_ACCESS_KEY && env.ACR_ACCESS_SECRET) providers.push('acrcloud');
  if (env.AUDD_API_TOKEN) providers.push('audd');
  return providers;
}

export function fingerprintAvailable(env = process.env) {
  return fingerprintProviders(env).length > 0;
}

export async function identifyByFingerprint({
  streamUrl,
  sampleSeconds = DEFAULT_SAMPLE_SECONDS,
  env = process.env,
  deadlineAt = Date.now() + SAMPLE_TIMEOUT_MS,
  sampleImpl = sampleStreamAudio,
  recognizeImpl = recognizeSample
} = {}) {
  const providers = fingerprintProviders(env);
  if (!providers.length) {
    return { available: false, found: false, reason: 'no fingerprint provider credentials configured' };
  }
  const cacheKey = String(streamUrl || '').trim();
  if (!cacheKey) return { available: true, found: false, reason: 'missing stream url' };
  const joined = inFlight.has(cacheKey);
  const outcome = resolveWithCache({
    cache: fingerprintCache,
    inFlight,
    key: cacheKey,
    produce: () => identifyUncached(cacheKey, { sampleSeconds, env, providers, deadlineAt, sampleImpl, recognizeImpl }),
    ttlFor: payload => payload.found ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS
  });
  return joined ? withinDeadline(outcome, deadlineAt) : outcome;
}

async function identifyUncached(streamUrl, { sampleSeconds, env, providers, deadlineAt, sampleImpl, recognizeImpl }) {
  const seconds = Math.min(MAX_SAMPLE_SECONDS, Math.max(5, Number(sampleSeconds) || DEFAULT_SAMPLE_SECONDS));
  let sample;
  try {
    sample = await withinDeadline(sampleImpl(streamUrl, { seconds, deadlineAt }), deadlineAt);
  } catch (error) {
    return { available: true, found: false, reason: `stream sampling failed: ${error?.message || 'unknown error'}` };
  }
  if (!sample?.body?.length || sample.body.length < MIN_RECOGNIZE_BYTES) {
    return { available: true, found: false, reason: 'stream sample was too short to fingerprint' };
  }

  let providerFailures = 0;
  for (const provider of providers) {
    try {
      const result = await withinDeadline(recognizeImpl(provider, sample, env, { deadlineAt }), deadlineAt);
      if (result) {
        return {
          available: true,
          found: true,
          ...result,
          sampleBytes: sample.body.length,
          sampleSeconds: seconds,
          fetchedAt: new Date().toISOString()
        };
      }
    } catch {
      // Transport/credential failure — try the next configured provider.
      providerFailures += 1;
    }
  }
  if (providerFailures === providers.length) {
    // Recognition never completed; this is an outage, not a negative identification.
    return { available: true, found: false, providerError: true, reason: 'fingerprint providers unavailable', sampleBytes: sample.body.length, fetchedAt: new Date().toISOString() };
  }
  return { available: true, found: false, reason: 'no fingerprint match', sampleBytes: sample.body.length, fetchedAt: new Date().toISOString() };
}

// Pulls ~`seconds` of encoded audio from the stream. ICY metadata injection is avoided
// by simply not sending Icy-MetaData, so the bytes are pure audio. HLS playlists are
// resolved one level and the most recent segments are concatenated instead.
export async function sampleStreamAudio(streamUrl, {
  seconds = DEFAULT_SAMPLE_SECONDS,
  deadlineAt = Date.now() + SAMPLE_TIMEOUT_MS,
  requestImpl = requestPublic
} = {}) {
  // One wall-clock budget for the whole sampling operation, shared across every
  // redirect hop, playlist fetch, and segment fetch.
  const stream = new URL(String(streamUrl || '').trim());
  if (/\.m3u8(\?|#|$)/i.test(stream.pathname + stream.search)) {
    return sampleHlsAudio(stream.toString(), { seconds, depth: 0, deadlineAt, requestImpl });
  }

  // Redirecting radio endpoints are normal; every hop re-passes the public-target
  // policy inside requestPublic before any bytes are read from it.
  const response = await requestImpl(stream.toString(), {
    timeoutMs: SAMPLE_TIMEOUT_MS,
    deadlineAt,
    maxBytes: MAX_SAMPLE_BYTES,
    stopWhen: makeByteTarget(seconds),
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  assertAudioResponse(response);
  const contentType = String(response.headers['content-type'] || '');
  if (/mpegurl|application\/x-mpegurl/i.test(contentType)) {
    return sampleHlsPlaylist(response.text, response.finalUrl || stream.toString(), { seconds, depth: 0, deadlineAt, requestImpl });
  }
  return { body: response.body, contentType };
}

function makeByteTarget(seconds) {
  let targetBytes = 0;
  return ({ length, headers }) => {
    if (!targetBytes) {
      const kbps = Number.parseInt(String(headers?.['icy-br'] || ''), 10);
      const bitrate = Number.isFinite(kbps) && kbps > 0 ? Math.min(kbps, 512) : DEFAULT_BITRATE_KBPS;
      targetBytes = Math.min(MAX_SAMPLE_BYTES, Math.max(MIN_SAMPLE_BYTES, Math.round(bitrate * 1000 / 8 * seconds)));
    }
    return length >= targetBytes;
  };
}

export async function sampleHlsAudio(playlistUrl, { seconds, depth = 0, deadlineAt = Date.now() + SAMPLE_TIMEOUT_MS, requestImpl = requestPublic }) {
  if (depth > MAX_HLS_PLAYLIST_DEPTH) throw new Error('HLS playlist nesting too deep');
  const playlistResponse = await requestImpl(playlistUrl, {
    timeoutMs: 8000,
    deadlineAt,
    maxBytes: PLAYLIST_MAX_BYTES,
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  if (playlistResponse.statusCode < 200 || playlistResponse.statusCode >= 300) {
    throw new Error(`HLS playlist HTTP ${playlistResponse.statusCode}`);
  }
  return sampleHlsPlaylist(playlistResponse.text, playlistResponse.finalUrl || playlistUrl, { seconds, depth, deadlineAt, requestImpl });
}

async function sampleHlsPlaylist(text, baseUrl, { seconds, depth, deadlineAt, requestImpl }) {
  if (depth > MAX_HLS_PLAYLIST_DEPTH) throw new Error('HLS playlist nesting too deep');
  const lines = text.split(/\r?\n/).map(line => line.trim());

  // Master playlist: follow the first variant, once.
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = lines.find(line => line && !line.startsWith('#'));
    if (!variant) throw new Error('empty HLS master playlist');
    return sampleHlsAudio(new URL(variant, baseUrl).toString(), { seconds, depth: depth + 1, deadlineAt, requestImpl });
  }

  const { segments, map, encrypted } = coherentHlsTail(lines);
  if (!segments.length) throw new Error('HLS media playlist has no segments');
  // Encrypted segments would reach the recognizers as ciphertext and spend metered
  // recognition quota on a guaranteed no-match; refuse before fetching anything.
  if (encrypted) throw new Error('encrypted HLS stream not supported for fingerprinting');
  // Fragmented-MP4 playlists carry decoder metadata in an EXT-X-MAP initialization
  // segment; without it the recognizers receive an undecodable container.
  const fetchList = map ? [map, ...segments] : segments;
  const perSegmentCap = Math.floor(MAX_SAMPLE_BYTES / fetchList.length);
  const parts = [];
  for (const segment of fetchList) {
    const headers = { Accept: '*/*', 'User-Agent': USER_AGENT };
    // Byte-ranged playlists address fragments inside one shared resource; without
    // the Range header every request returns the beginning of that resource.
    if (segment.range) headers.Range = `bytes=${segment.range.offset}-${segment.range.offset + segment.range.length - 1}`;
    const segmentResponse = await requestImpl(new URL(segment.uri, baseUrl).toString(), {
      timeoutMs: 8000,
      deadlineAt,
      maxBytes: perSegmentCap,
      headers
    });
    if (segmentResponse.statusCode >= 200 && segmentResponse.statusCode < 300 && segmentResponse.body.length) {
      parts.push(segmentResponse.body);
    }
  }
  if (!parts.length) throw new Error('no HLS segments could be fetched');
  return { body: Buffer.concat(parts), contentType: map ? 'video/mp4' : 'video/mp2t' };
}

function coherentHlsTail(lines) {
  let activeMap = null;
  let keyMethod = 'NONE';
  let pendingRange = null;
  let previous = null;
  const media = [];
  for (const line of lines) {
    const mapMatch = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/i);
    if (mapMatch) {
      const mapRange = line.match(/BYTERANGE="(\d+)@(\d+)"/i);
      activeMap = {
        uri: mapMatch[1],
        range: mapRange ? { offset: Number(mapRange[2]), length: Number(mapRange[1]) } : null
      };
      continue;
    }
    const declaredMethod = line.match(/^#EXT-X-KEY:.*METHOD=([\w-]+)/i)?.[1];
    if (declaredMethod) {
      keyMethod = declaredMethod.toUpperCase();
      continue;
    }
    const rangeMatch = line.match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i);
    if (rangeMatch) {
      pendingRange = { length: Number(rangeMatch[1]), offset: rangeMatch[2] === undefined ? null : Number(rangeMatch[2]) };
      continue;
    }
    if (line && !line.startsWith('#')) {
      let range = null;
      if (pendingRange) {
        // An offset-less BYTERANGE continues at the end of the previous sub-range
        // of the same resource (RFC 8216 §4.3.2.2).
        const offset = pendingRange.offset ?? (previous?.uri === line && previous.range
          ? previous.range.offset + previous.range.length
          : 0);
        range = { offset, length: pendingRange.length };
        pendingRange = null;
      }
      const segment = { uri: line, map: activeMap, range, encrypted: keyMethod !== 'NONE' };
      media.push(segment);
      previous = segment;
    }
  }

  const recent = media.slice(-HLS_SEGMENT_COUNT);
  if (!recent.length) return { segments: [], map: null, encrypted: false };
  const map = recent.at(-1).map;
  let coherentStart = recent.length - 1;
  while (coherentStart > 0 && recent[coherentStart - 1].map === map) coherentStart -= 1;
  const segments = recent.slice(coherentStart);
  return {
    segments: segments.map(({ uri, range }) => ({ uri, range })),
    map,
    encrypted: segments.some(segment => segment.encrypted)
  };
}

function assertAudioResponse(response) {
  if (!(response.statusCode >= 200 && response.statusCode < 300)) {
    throw new Error(`stream HTTP ${response.statusCode}`);
  }
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (/text\/html|application\/json|text\/plain/.test(contentType)) {
    throw new Error(`stream returned non-audio content-type ${contentType.split(';')[0]}`);
  }
}

async function recognizeSample(provider, sample, env = process.env, { deadlineAt = Date.now() + RECOGNIZE_TIMEOUT_MS } = {}) {
  if (provider === 'acrcloud') return recognizeWithAcrCloud(sample, env, { deadlineAt });
  if (provider === 'audd') return recognizeWithAudd(sample, env, { deadlineAt });
  return null;
}

// ACRCloud identify API v1 request signing:
// signature = base64(hmac-sha1(secret, "POST\n/v1/identify\n{key}\naudio\n1\n{timestamp}"))
export function buildAcrSignature({ accessKey, accessSecret, timestamp }) {
  const stringToSign = ['POST', ACR_IDENTIFY_PATH, accessKey, 'audio', '1', String(timestamp)].join('\n');
  return createHmac('sha1', accessSecret).update(stringToSign).digest('base64');
}

// Throws on transport/credential failure; returns null only for a genuine no-match.
async function recognizeWithAcrCloud(sample, env, { deadlineAt }) {
  const host = String(env.ACR_HOST || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.set('access_key', env.ACR_ACCESS_KEY);
  form.set('data_type', 'audio');
  form.set('signature_version', '1');
  form.set('timestamp', String(timestamp));
  form.set('signature', buildAcrSignature({ accessKey: env.ACR_ACCESS_KEY, accessSecret: env.ACR_ACCESS_SECRET, timestamp }));
  form.set('sample_bytes', String(sample.body.length));
  form.set('sample', new Blob([sample.body]), 'sample.bin');

  const outcome = await postForm(`https://${host}${ACR_IDENTIFY_PATH}`, form, { deadlineAt });
  if (!outcome.ok) throw new Error('acrcloud request failed');
  const code = Number(outcome.data?.status?.code);
  // 0 = hit; 1001 = analyzed but no result — a genuine miss. Anything else is a
  // provider-side error (bad credentials, quota, internal failure).
  if (code !== 0 && code !== 1001) throw new Error(`acrcloud status ${code}`);
  return normalizeAcrResult(outcome.data);
}

export function normalizeAcrResult(data) {
  if (Number(data?.status?.code) !== 0) return null;
  const music = data?.metadata?.music?.[0];
  if (!music?.title) return null;
  const spotifyId = music.external_metadata?.spotify?.track?.id || '';
  return {
    provider: 'acrcloud',
    artist: (music.artists || []).map(item => item?.name).filter(Boolean).join(', '),
    title: String(music.title || ''),
    album: String(music.album?.name || ''),
    releaseYear: String(music.release_date || '').slice(0, 4),
    isrc: String(music.external_ids?.isrc || ''),
    score: Math.round(Number(music.score) || 0),
    spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : '',
    appleMusicUrl: ''
  };
}

async function recognizeWithAudd(sample, env, { deadlineAt }) {
  const form = new FormData();
  form.set('api_token', env.AUDD_API_TOKEN);
  form.set('return', 'apple_music,spotify');
  form.set('file', new Blob([sample.body]), 'sample.bin');

  const outcome = await postForm(AUDD_IDENTIFY_URL, form, { deadlineAt });
  if (!outcome.ok) throw new Error('audd request failed');
  if (outcome.data?.status !== 'success') throw new Error(`audd status ${outcome.data?.status || 'unknown'}`);
  return normalizeAuddResult(outcome.data);
}

export function normalizeAuddResult(data) {
  if (data?.status !== 'success' || !data?.result?.title) return null;
  const result = data.result;
  return {
    provider: 'audd',
    artist: String(result.artist || ''),
    title: String(result.title || ''),
    album: String(result.album || ''),
    releaseYear: String(result.release_date || '').slice(0, 4),
    isrc: String(result.apple_music?.isrc || result.spotify?.external_ids?.isrc || ''),
    // AudD does not return a match score; a fingerprint hit is inherently high confidence.
    score: 90,
    spotifyUrl: String(result.spotify?.external_urls?.spotify || ''),
    appleMusicUrl: String(result.apple_music?.url || '')
  };
}

async function postForm(url, form, { deadlineAt = Date.now() + RECOGNIZE_TIMEOUT_MS } = {}) {
  const remaining = Math.min(RECOGNIZE_TIMEOUT_MS, deadlineAt - Date.now());
  if (remaining <= 0) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      body: form
    });
    if (!response.ok) return { ok: false };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function withinDeadline(promise, deadlineAt) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.reject(new Error('fingerprint deadline exceeded'));
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fingerprint deadline exceeded')), remaining);
    })
  ]).finally(() => clearTimeout(timer));
}


export function clearFingerprintCache() {
  fingerprintCache.clear();
  inFlight.clear();
}
