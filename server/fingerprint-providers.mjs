// Earth Radio on-demand audio fingerprinting.
// Samples a short window of encoded audio bytes directly from a station stream and
// submits it to a configured recognition provider (ACRCloud or AudD). Both accept
// encoded MP3/AAC bytes, so no decoding happens here. Fingerprinting is strictly
// opt-in: without provider credentials in the environment every request short-circuits.
// Recognition APIs are metered, so results are cached and deduplicated per stream URL.

import { createHmac } from 'node:crypto';
import { requestLimited, resolvePublicTarget } from './net-guard.mjs';

const USER_AGENT = 'EarthRadio/0.25.0 fingerprint (+https://github.com/Protonmatter/EarthRadio)';
const ACR_IDENTIFY_PATH = '/v1/identify';
const AUDD_IDENTIFY_URL = 'https://api.audd.io/';
const DEFAULT_SAMPLE_SECONDS = 12;
const MAX_SAMPLE_SECONDS = 20;
const MIN_SAMPLE_BYTES = 96 * 1024;
const MAX_SAMPLE_BYTES = 1024 * 1024;
const DEFAULT_BITRATE_KBPS = 160;
const SAMPLE_TIMEOUT_MS = 20_000;
const RECOGNIZE_TIMEOUT_MS = 15_000;
const CACHE_MAX_ENTRIES = 128;
const CACHE_TTL_HIT_MS = 90 * 1000;
const CACHE_TTL_MISS_MS = 45 * 1000;
const PLAYLIST_MAX_BYTES = 64 * 1024;
const HLS_SEGMENT_COUNT = 3;

const fingerprintCache = new Map();
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
  const cached = readCache(cacheKey);
  if (cached) return { ...cached, cached: true };
  if (inFlight.has(cacheKey)) return { ...await inFlight.get(cacheKey), cached: true };

  const promise = identifyUncached(cacheKey, { sampleSeconds, env, providers, sampleImpl, recognizeImpl });
  inFlight.set(cacheKey, promise);
  try {
    const payload = await promise;
    writeCache(cacheKey, payload, payload.found ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS);
    return payload;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function identifyUncached(streamUrl, { sampleSeconds, env, providers, sampleImpl, recognizeImpl }) {
  const seconds = Math.min(MAX_SAMPLE_SECONDS, Math.max(5, Number(sampleSeconds) || DEFAULT_SAMPLE_SECONDS));
  let sample;
  try {
    sample = await sampleImpl(streamUrl, { seconds });
  } catch (error) {
    return { available: true, found: false, reason: `stream sampling failed: ${error?.message || 'unknown error'}` };
  }
  if (!sample?.body?.length || sample.body.length < 16 * 1024) {
    return { available: true, found: false, reason: 'stream sample was too short to fingerprint' };
  }

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
      // Provider errors fall through to the next configured provider.
    }
  }
  return { available: true, found: false, reason: 'no fingerprint match', sampleBytes: sample.body.length, fetchedAt: new Date().toISOString() };
}

// Pulls ~`seconds` of encoded audio from the stream. ICY metadata injection is avoided
// by simply not sending Icy-MetaData, so the bytes are pure audio. HLS playlists are
// resolved one level and the most recent segments are concatenated instead.
export async function sampleStreamAudio(streamUrl, { seconds = DEFAULT_SAMPLE_SECONDS } = {}) {
  const target = await resolvePublicTarget(streamUrl);
  if (/\.m3u8(\?|#|$)/i.test(target.url.pathname + target.url.search)) {
    return sampleHlsAudio(target, { seconds });
  }

  const response = await requestLimited(target, {
    timeoutMs: SAMPLE_TIMEOUT_MS,
    maxBytes: MAX_SAMPLE_BYTES,
    stopWhen: makeByteTarget(seconds),
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  assertAudioResponse(response);
  const contentType = String(response.headers['content-type'] || '');
  if (/mpegurl|application\/x-mpegurl/i.test(contentType)) {
    const media = firstPlaylistLine(response.text, target.href);
    if (!media) throw new Error('empty HLS playlist');
    return sampleHlsAudio(await resolvePublicTarget(media), { seconds });
  }
  return { body: response.body, contentType };
}

function makeByteTarget(seconds) {
  let targetBytes = 0;
  return (body, headers) => {
    if (!targetBytes) {
      const kbps = Number.parseInt(String(headers?.['icy-br'] || ''), 10);
      const bitrate = Number.isFinite(kbps) && kbps > 0 ? Math.min(kbps, 512) : DEFAULT_BITRATE_KBPS;
      targetBytes = Math.min(MAX_SAMPLE_BYTES, Math.max(MIN_SAMPLE_BYTES, Math.round(bitrate * 1000 / 8 * seconds)));
    }
    return body.length >= targetBytes;
  };
}

async function sampleHlsAudio(playlistTarget, { seconds }) {
  const playlistResponse = await requestLimited(playlistTarget, {
    timeoutMs: 8000,
    maxBytes: PLAYLIST_MAX_BYTES,
    headers: { Accept: '*/*', 'User-Agent': USER_AGENT }
  });
  if (playlistResponse.statusCode < 200 || playlistResponse.statusCode >= 300) {
    throw new Error(`HLS playlist HTTP ${playlistResponse.statusCode}`);
  }
  const text = playlistResponse.text;
  const lines = text.split(/\r?\n/).map(line => line.trim());

  // Master playlist: follow the first variant, once.
  if (text.includes('#EXT-X-STREAM-INF')) {
    const variant = lines.find(line => line && !line.startsWith('#'));
    if (!variant) throw new Error('empty HLS master playlist');
    return sampleHlsAudio(await resolvePublicTarget(new URL(variant, playlistTarget.href).toString()), { seconds });
  }

  const segments = lines.filter(line => line && !line.startsWith('#')).slice(-HLS_SEGMENT_COUNT);
  if (!segments.length) throw new Error('HLS media playlist has no segments');
  const perSegmentCap = Math.floor(MAX_SAMPLE_BYTES / segments.length);
  const parts = [];
  for (const segment of segments) {
    const segmentTarget = await resolvePublicTarget(new URL(segment, playlistTarget.href).toString());
    const segmentResponse = await requestLimited(segmentTarget, {
      timeoutMs: 8000,
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

export async function recognizeSample(provider, sample, env = process.env) {
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

  const data = await postForm(`https://${host}${ACR_IDENTIFY_PATH}`, form);
  return normalizeAcrResult(data);
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

  const data = await postForm(AUDD_IDENTIFY_URL, form);
  return normalizeAuddResult(data);
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
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(key) {
  const entry = fingerprintCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    fingerprintCache.delete(key);
    return null;
  }
  entry.lastAccessedAt = Date.now();
  return { ...entry.payload };
}

function writeCache(key, payload, ttlMs) {
  fingerprintCache.set(key, { payload: { ...payload }, expiresAt: Date.now() + ttlMs, lastAccessedAt: Date.now() });
  if (fingerprintCache.size <= CACHE_MAX_ENTRIES) return;
  const oldest = [...fingerprintCache.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0]?.[0];
  if (oldest) fingerprintCache.delete(oldest);
}

export function clearFingerprintCache() {
  fingerprintCache.clear();
  inFlight.clear();
}
