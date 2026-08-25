// Earth Radio on-demand audio fingerprinting.
// Samples a short window of encoded audio bytes directly from a station stream and
// submits it to a configured recognition provider (ACRCloud or AudD). Both accept
// encoded MP3/AAC bytes, so no decoding happens here. Fingerprinting is strictly
// opt-in: without provider credentials in the environment every request short-circuits.
// Recognition APIs are metered, so results are cached and deduplicated per stream URL.

import { createHmac } from 'node:crypto';
import { guardedRequest, resolvePublicTarget } from './net-guard.mjs';
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

export async function identifyByFingerprint({ streamUrl, sampleSeconds = DEFAULT_SAMPLE_SECONDS, env = process.env, sampleImpl = sampleStreamAudio, recognizeImpl = recognizeSample } = {}) {
  const providers = fingerprintProviders(env);
  if (!providers.length) {
    return { available: false, found: false, reason: 'no fingerprint provider credentials configured' };
  }
  const cacheKey = String(streamUrl || '').trim();
  if (!cacheKey) return { available: true, found: false, reason: 'missing stream url' };
  return resolveWithCache({
    cache: fingerprintCache,
    inFlight,
    key: cacheKey,
    produce: () => identifyUncached(cacheKey, { sampleSeconds, env, providers, sampleImpl, recognizeImpl }),
    ttlFor: payload => payload.found ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS
  });
}

async function identifyUncached(streamUrl, { sampleSeconds, env, providers, sampleImpl, recognizeImpl }) {
  const seconds = Math.min(MAX_SAMPLE_SECONDS, Math.max(5, Number(sampleSeconds) || DEFAULT_SAMPLE_SECONDS));
  let sample;
  try {
    sample = await sampleImpl(streamUrl, { seconds });
  } catch (error) {
    return { available: true, found: false, reason: `stream sampling failed: ${error?.message || 'unknown error'}` };
  }
  if (!sample?.body?.length || sample.body.length < MIN_RECOGNIZE_BYTES) {
    return { available: true, found: false, reason: 'stream sample was too short to fingerprint' };
  }

  let providerFailures = 0;
  for (const provider of providers) {
    try {
      const result = await recognizeImpl(provider, sample, env);
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
export async function sampleStreamAudio(streamUrl, { seconds = DEFAULT_SAMPLE_SECONDS, requestImpl = guardedRequest, resolveTarget = resolvePublicTarget } = {}) {
  // One wall-clock budget for the whole sampling operation, shared across every
  // redirect hop, playlist fetch, and segment fetch.
  const deadlineAt = Date.now() + SAMPLE_TIMEOUT_MS;
  const target = await resolveTarget(streamUrl);
  if (/\.m3u8(\?|#|$)/i.test(target.url.pathname + target.url.search)) {
    return sampleHlsAudio(target.href, { seconds, depth: 0, deadlineAt, requestImpl });
  }

  // Redirecting radio endpoints are normal; every hop re-passes the public-target
  // policy inside guardedRequest before any bytes are read from it.
  const response = await requestImpl(target.href, {
    timeoutMs: SAMPLE_TIMEOUT_MS,
    deadlineAt,
    maxBytes: MAX_SAMPLE_BYTES,
    stopWhen: makeByteTarget(seconds),
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  assertAudioResponse(response);
  const contentType = String(response.headers['content-type'] || '');
  if (/mpegurl|application\/x-mpegurl/i.test(contentType)) {
    const media = firstPlaylistLine(response.text, response.finalUrl);
    if (!media) throw new Error('empty HLS playlist');
    return sampleHlsAudio(media, { seconds, depth: 0, deadlineAt, requestImpl });
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

async function sampleHlsAudio(playlistUrl, { seconds, depth = 0, deadlineAt = Date.now() + SAMPLE_TIMEOUT_MS, requestImpl = guardedRequest }) {
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
  const text = playlistResponse.text;
  const baseUrl = playlistResponse.finalUrl;
  const lines = text.split(/\r?\n/).map(line => line.trim());

  // Master playlist: follow the first variant, once.
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = lines.find(line => line && !line.startsWith('#'));
    if (!variant) throw new Error('empty HLS master playlist');
    return sampleHlsAudio(new URL(variant, baseUrl).toString(), { seconds, depth: depth + 1, deadlineAt, requestImpl });
  }

  const segments = lines.filter(line => line && !line.startsWith('#')).slice(-HLS_SEGMENT_COUNT);
  if (!segments.length) throw new Error('HLS media playlist has no segments');
  // Fragmented-MP4 playlists carry decoder metadata in an EXT-X-MAP initialization
  // segment; without it the recognizers receive an undecodable container.
  const mapUri = lines.map(line => line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/i)?.[1]).find(Boolean);
  const fetchList = mapUri ? [new URL(mapUri, baseUrl).toString(), ...segments] : segments;
  const perSegmentCap = Math.floor(MAX_SAMPLE_BYTES / fetchList.length);
  const parts = [];
  for (const segment of fetchList) {
    const segmentResponse = await requestImpl(new URL(segment, baseUrl).toString(), {
      timeoutMs: 8000,
      deadlineAt,
      maxBytes: perSegmentCap,
      headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
    });
    if (segmentResponse.statusCode >= 200 && segmentResponse.statusCode < 300 && segmentResponse.body.length) {
      parts.push(segmentResponse.body);
    }
  }
  if (!parts.length) throw new Error('no HLS segments could be fetched');
  return { body: Buffer.concat(parts), contentType: 'video/mp2t' };
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

function firstPlaylistLine(text, baseUrl) {
  const line = String(text || '').split(/\r?\n/).map(item => item.trim()).find(item => item && !item.startsWith('#'));
  return line ? new URL(line, baseUrl).toString() : '';
}

async function recognizeSample(provider, sample, env = process.env) {
  if (provider === 'acrcloud') return recognizeWithAcrCloud(sample, env);
  if (provider === 'audd') return recognizeWithAudd(sample, env);
  return null;
}

// ACRCloud identify API v1 request signing:
// signature = base64(hmac-sha1(secret, "POST\n/v1/identify\n{key}\naudio\n1\n{timestamp}"))
export function buildAcrSignature({ accessKey, accessSecret, timestamp }) {
  const stringToSign = ['POST', ACR_IDENTIFY_PATH, accessKey, 'audio', '1', String(timestamp)].join('\n');
  return createHmac('sha1', accessSecret).update(stringToSign).digest('base64');
}

// Throws on transport/credential failure; returns null only for a genuine no-match.
async function recognizeWithAcrCloud(sample, env) {
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

  const outcome = await postForm(`https://${host}${ACR_IDENTIFY_PATH}`, form);
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

async function recognizeWithAudd(sample, env) {
  const form = new FormData();
  form.set('api_token', env.AUDD_API_TOKEN);
  form.set('return', 'apple_music,spotify');
  form.set('file', new Blob([sample.body]), 'sample.bin');

  const outcome = await postForm(AUDD_IDENTIFY_URL, form);
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

async function postForm(url, form) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOGNIZE_TIMEOUT_MS);
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


export function clearFingerprintCache() {
  fingerprintCache.clear();
  inFlight.clear();
}
