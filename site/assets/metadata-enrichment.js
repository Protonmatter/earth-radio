// Earth Radio metadata enrichment overlay v0.25.0
// Adds confidence-scored ICY -> iTunes/Spotify metadata identity without requiring a renderer rebuild.
// v0.25.0 layers three live-metadata feeds above raw ICY text:
//   1. Hosting-platform now-playing APIs (AzuraCast, Zeno.FM, Radio.co, Laut.fm, Radiojar,
//      Icecast/Shoutcast status) - browser-direct where CORS allows, via the desktop proxy otherwise.
//   2. HLS timed ID3 metadata exposed by hls.js as a hidden metadata text track.
//   3. On-demand audio fingerprinting through the desktop proxy (ACRCloud/AudD), user-triggered.
// The canonical source implementation is mirrored under recovered_src/ for the next full desktop build.

const VERSION = '0.25.0-metadata-overlay';
const CACHE_KEY = 'earth-radio-track-identity-cache-v1';
const JUNK_TITLE = /^(unknown|n\/?a|advert(isement)?|commercial|station\s?id|live stream|loading\.{0,3}|no title|news|weather|traffic)$/i;
const COVER_OR_TRIBUTE = /\b(karaoke|tribute|cover version|instrumental version|originally performed by|as made famous by|remix tribute)\b/i;
const ADLIKE = /\b(advertisement|commercial|sponsor|promo|listen live|news update|traffic|weather|sweeper|station id)\b/i;
const TITLE_ONLY_PROMOTION_REASON = 'title-only ICY metadata is raw broadcast text, not enough to identify a track';
const AMBIGUOUS_TITLE_ONLY_TERMS = new Set([
  'africa', 'america', 'asia', 'australia', 'brazil', 'canada', 'china', 'england', 'europe',
  'france', 'germany', 'india', 'italy', 'japan', 'korea', 'mexico', 'netherlands', 'spain',
  'united kingdom', 'united states', 'live', 'radio', 'fm', 'top hits', 'hits', 'music'
]);
const DEFAULTS = {
  enabled: true,
  iTunesDirectEnabled: true,
  spotifyProxyEnabled: true,
  minIdentifiedConfidence: 78,
  minLikelyConfidence: 58,
  cacheTtlHighMs: 30 * 24 * 60 * 60 * 1000,
  cacheTtlLowMs: 24 * 60 * 60 * 1000,
  cacheTtlMissMs: 6 * 60 * 60 * 1000,
  requestTimeoutMs: 6500,
  maxCandidates: 8,
  platformNowPlayingEnabled: true,
  platformPollMs: 30000,
  hlsId3Enabled: true,
  fingerprintEnabled: true,
  fingerprintAutoOnRawIcy: false,
  fingerprintMinIntervalMs: 30000,
  // Same-origin /api/* Pages Functions (public web deployments). Feature-detected at
  // runtime; a static-only deployment simply reports 404 and everything degrades.
  sameOriginApiEnabled: true
};

const TRUSTED_TRACK_FRESH_MS = 45 * 1000;

const state = {
  initialized: false,
  lastRaw: '',
  lastTrackKey: '',
  inFlight: null,
  timer: null,
  currentIdentity: null,
  trustedTrack: null,
  platformTimer: null,
  hlsWatchedTracks: new WeakSet(),
  fingerprintAvailable: null,
  fingerprintBusy: false,
  fingerprintLastAt: 0,
  fingerprintAutoKey: '',
  sameOriginApi: null,
  sameOriginApiProbe: null,
  sameOriginApiMisses: 0,
  platformPollGeneration: 0,
  streamUrl: '',
  selectedStreamUrl: '',
  selectedStationUuid: ''
};

function config() {
  const runtime = window.RADIO_CONFIG && typeof window.RADIO_CONFIG === 'object' ? window.RADIO_CONFIG : {};
  return {
    ...DEFAULTS,
    ...(runtime.metadataEnrichment || {}),
    proxyBaseUrl: String(runtime.proxyBaseUrl || '').replace(/\/+$/, '')
  };
}

function byId(id) { return document.getElementById(id); }
function text(el) { return String(el?.textContent || '').replace(/\s+/g, ' ').trim(); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min)); }
function nowIso() { return new Date().toISOString(); }

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*(remaster|live|radio edit|mono|stereo|explicit|clean)[^)]*\)/g, ' ')
    .replace(/\[[^\]]*(remaster|live|radio edit|mono|stereo|explicit|clean)[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripRadioNoise(value) {
  return String(value || '')
    .replace(/StreamTitle=/i, '')
    .replace(/^['"]|['"];?$/g, '')
    .replace(/\s*\|\s*(live|radio).*$/i, '')
    .replace(/\s*[-\u2013\u2014]\s*(live on .*|\d{2,4}\.?\d?\s?fm|\w+ radio)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNowPlaying(rawInput) {
  const raw = stripRadioNoise(rawInput);
  if (!raw || JUNK_TITLE.test(raw) || ADLIKE.test(raw)) return null;

  const separators = [/\s[-\u2013\u2014]\s/, /\s::\s/, /\s\|\s/, /\s\/\s/];
  for (const sep of separators) {
    const parts = raw.split(sep).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const artist = parts[0];
      const title = parts.slice(1).join(' - ');
      if (artist && title && !JUNK_TITLE.test(title)) return { artist, title, raw };
    }
  }

  // Some stations send "Title by Artist". Lowercase "by" only: title-cased "By"
  // ("Stand By Me") is part of the title, not an artist separator.
  const byMatch = raw.match(/^(.+?)\s+by\s+(.+)$/);
  if (byMatch) return { artist: byMatch[2].trim(), title: byMatch[1].trim(), raw };

  return { artist: '', title: raw, raw };
}

function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  const xs = new Set(x.split(' ').filter(Boolean));
  const ys = new Set(y.split(' ').filter(Boolean));
  const intersection = [...xs].filter(token => ys.has(token)).length;
  const union = new Set([...xs, ...ys]).size;
  return union ? intersection / union : 0;
}

function scoreCandidate(track, candidate, sourceAgreement = {}) {
  const titleSim = similarity(track.title, candidate.title);
  const artistSim = track.artist ? similarity(track.artist, candidate.artist) : 0;
  let score = 0;
  const reasons = [];

  if (normalize(track.title) && normalize(track.title) === normalize(candidate.title)) { score += 40; reasons.push('exact title match'); }
  else if (titleSim >= 0.9) { score += 32; reasons.push('near-exact title match'); }
  else if (titleSim >= 0.68) { score += Math.round(18 * titleSim); reasons.push('fuzzy title match'); }

  if (track.artist) {
    if (normalize(track.artist) === normalize(candidate.artist)) { score += 30; reasons.push('exact artist match'); }
    else if (artistSim >= 0.9) { score += 24; reasons.push('near-exact artist match'); }
    else if (artistSim >= 0.6) { score += Math.round(16 * artistSim); reasons.push('fuzzy artist match'); }
    else { score -= 28; reasons.push('artist mismatch'); }
  } else {
    score += Math.round(10 * titleSim);
    reasons.push(TITLE_ONLY_PROMOTION_REASON);
  }

  if (candidate.isrc && sourceAgreement.isrc && candidate.isrc === sourceAgreement.isrc) {
    score += 10;
    reasons.push('ISRC agreement across providers');
  }
  if (candidate.genre) { score += 4; reasons.push('catalog genre returned'); }
  if (candidate.artworkUrl) { score += 4; reasons.push('catalog artwork returned'); }
  if (candidate.previewUrl) { score += 2; reasons.push('preview available'); }
  if (COVER_OR_TRIBUTE.test(`${candidate.artist} ${candidate.title} ${candidate.album || ''}`)) {
    score -= 38;
    reasons.push('cover/karaoke/tribute penalty');
  }

  score = clamp(score, 0, 100);
  return { score, reasons, titleSim, artistSim };
}

function trackKey(track) {
  return `track:${normalize(track.artist)}:${normalize(track.title)}`.slice(0, 220);
}

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeCache(cache) {
  try {
    const entries = Object.entries(cache)
      .filter(([, entry]) => entry && entry.expiresAt > Date.now())
      .sort((a, b) => (b[1].storedAt || 0) - (a[1].storedAt || 0))
      .slice(0, 500);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage is best-effort */ }
}

function getCached(key) {
  const cache = readCache();
  const entry = cache[key];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value || null;
}

function setCached(key, value, ttlMs) {
  const cache = readCache();
  cache[key] = { value, storedAt: Date.now(), expiresAt: Date.now() + ttlMs };
  writeCache(cache);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function proxyProviders(cfg) {
  const providers = ['itunes'];
  if (cfg.spotifyProxyEnabled) providers.push('spotify');
  return providers;
}

function normalizeItunesCandidate(result) {
  if (!result || result.wrapperType && result.wrapperType !== 'track') return null;
  return {
    provider: 'itunes',
    providerId: result.trackId ? String(result.trackId) : '',
    title: result.trackName || '',
    artist: result.artistName || '',
    album: result.collectionName || '',
    releaseYear: result.releaseDate ? String(result.releaseDate).slice(0, 4) : '',
    genre: result.primaryGenreName || '',
    isrc: result.isrc || '',
    durationMs: Number.isFinite(result.trackTimeMillis) ? result.trackTimeMillis : undefined,
    artworkUrl: String(result.artworkUrl100 || '').replace(/\/(\d+)x(\d+)bb\.(jpg|png)/, '/512x512bb.$3'),
    previewUrl: result.previewUrl || '',
    appleMusicUrl: result.trackViewUrl || '',
    raw: result
  };
}

function normalizeSpotifyCandidate(item) {
  if (!item) return null;
  const album = item.album || {};
  const artist = Array.isArray(item.artists) ? item.artists.map(a => a.name).filter(Boolean).join(', ') : '';
  return {
    provider: 'spotify',
    providerId: item.id || '',
    title: item.name || '',
    artist,
    album: album.name || '',
    releaseYear: album.release_date ? String(album.release_date).slice(0, 4) : '',
    genre: Array.isArray(item.genres) ? item.genres.slice(0, 2).join(', ') : '',
    isrc: item.external_ids?.isrc || '',
    durationMs: item.duration_ms,
    explicit: item.explicit,
    artworkUrl: Array.isArray(album.images) && album.images[0]?.url ? album.images[0].url : '',
    spotifyUrl: item.external_urls?.spotify || '',
    raw: item
  };
}

async function resolveViaProxy(track, cfg) {
  if (!cfg.proxyBaseUrl) return [];
  const query = new URLSearchParams({ artist: track.artist, title: track.title, providers: proxyProviders(cfg).join(',') });
  const data = await fetchJson(`${cfg.proxyBaseUrl}/api/track/identify?${query}`, cfg.requestTimeoutMs);
  if (!data) return [];

  const candidates = [];
  const push = candidate => candidate && candidates.push(candidate);
  if (Array.isArray(data.candidates)) {
    for (const candidate of data.candidates) push(normalizeProviderCandidate(candidate));
  } else if (data.found || data.title || data.track) {
    push(normalizeProviderCandidate(data.track || data));
  }
  if (Array.isArray(data.spotify?.tracks?.items)) data.spotify.tracks.items.forEach(item => push(normalizeSpotifyCandidate(item)));
  if (Array.isArray(data.itunes?.results)) data.itunes.results.forEach(item => push(normalizeItunesCandidate(item)));
  return candidates.filter(Boolean);
}

function normalizeProviderCandidate(candidate) {
  if (!candidate) return null;
  if (candidate.title || candidate.artist || candidate.providerId || candidate.artworkUrl || candidate.appleMusicUrl || candidate.spotifyUrl) return normalizeResolvedCandidate(candidate);
  if (candidate.provider === 'spotify' || candidate.external_urls || candidate.album?.images) return normalizeSpotifyCandidate(candidate.raw || candidate);
  if (candidate.provider === 'itunes' || candidate.trackName || candidate.artistName || candidate.trackViewUrl) return normalizeItunesCandidate(candidate.raw || candidate);
  return normalizeResolvedCandidate(candidate);
}

function normalizeResolvedCandidate(candidate) {
  if (!candidate) return null;
  return {
    provider: candidate.provider || candidate.source || 'proxy',
    providerId: candidate.providerId || candidate.id || '',
    title: candidate.title || candidate.trackName || '',
    artist: candidate.artist || candidate.artistName || '',
    album: candidate.album || candidate.collectionName || '',
    releaseYear: candidate.releaseYear || (candidate.releaseDate ? String(candidate.releaseDate).slice(0, 4) : ''),
    genre: candidate.genre || candidate.primaryGenreName || '',
    isrc: candidate.isrc || '',
    durationMs: candidate.durationMs,
    artworkUrl: candidate.artworkUrl || candidate.artworkUrl100 || '',
    previewUrl: candidate.previewUrl || '',
    appleMusicUrl: candidate.appleMusicUrl || candidate.trackViewUrl || '',
    spotifyUrl: candidate.spotifyUrl || candidate.externalUrl || '',
    raw: candidate
  };
}

async function resolveViaItunes(track, cfg) {
  if (!cfg.iTunesDirectEnabled) return [];
  const term = encodeURIComponent([track.artist, track.title].filter(Boolean).join(' ').trim());
  if (!term) return [];
  const limit = clamp(cfg.maxCandidates, 1, 25);
  const data = await fetchJson(`https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${term}`, cfg.requestTimeoutMs);
  return Array.isArray(data?.results) ? data.results.map(normalizeItunesCandidate).filter(Boolean) : [];
}

function mergeCandidates(candidates) {
  const byKey = new Map();
  for (const c of candidates.filter(c => c?.title)) {
    const key = [normalize(c.artist), normalize(c.title), c.isrc || ''].join('|');
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...c, providers: [c.provider], sources: [c] });
    else {
      prev.providers = [...new Set([...prev.providers, c.provider])];
      prev.sources.push(c);
      prev.appleMusicUrl ||= c.appleMusicUrl;
      prev.spotifyUrl ||= c.spotifyUrl;
      prev.artworkUrl ||= c.artworkUrl;
      prev.previewUrl ||= c.previewUrl;
      prev.genre ||= c.genre;
      prev.isrc ||= c.isrc;
    }
  }
  return [...byKey.values()];
}

function buildSearchLinks(track, identity) {
  const query = encodeURIComponent([identity?.artist || track.artist, identity?.title || track.title].filter(Boolean).join(' ').trim());
  return {
    spotify: identity?.spotifyUrl || `https://open.spotify.com/search/${query}`,
    appleMusic: identity?.appleMusicUrl || `https://music.apple.com/search?term=${query}`,
    youtubeMusic: `https://music.youtube.com/search?q=${query}`,
    tidal: `https://tidal.com/search?q=${query}`
  };
}

async function identify(track) {
  const cfg = config();
  const key = trackKey(track);
  const cached = getCached(key);
  if (cached) return { ...cached, cache: 'hit' };

  const providerCandidates = [];
  const proxyCandidates = await resolveViaProxy(track, cfg);
  providerCandidates.push(...proxyCandidates);
  if (!cfg.proxyBaseUrl || proxyCandidates.length === 0) {
    providerCandidates.push(...await resolveViaItunes(track, cfg));
  }

  const merged = mergeCandidates(providerCandidates);
  const isrcCounts = merged.reduce((acc, c) => {
    if (c.isrc) acc[c.isrc] = (acc[c.isrc] || 0) + 1;
    return acc;
  }, {});
  const commonIsrc = Object.entries(isrcCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  let best = null;
  for (const candidate of merged) {
    const scored = scoreCandidate(track, candidate, { isrc: commonIsrc });
    const entry = { ...candidate, confidence: scored.score, reasons: scored.reasons };
    if (!best || entry.confidence > best.confidence) best = entry;
  }

  if (!canPromoteCandidate(track, best, merged)) {
    const identity = rawIcyIdentity(track, best ? blockedPromotionReason(track) : 'no catalog match above confidence threshold');
    setCached(key, identity, cfg.cacheTtlMissMs);
    return { ...identity, cache: 'miss' };
  }

  const stateLabel = best.confidence >= cfg.minIdentifiedConfidence ? 'Identified' : 'Likely match';

  const identity = {
    version: VERSION,
    found: true,
    state: stateLabel,
    confidence: best.confidence,
    title: best.title || track.title,
    artist: best.artist || track.artist,
    album: best.album || '',
    releaseYear: best.releaseYear || '',
    genre: best.genre || '',
    isrc: best.isrc || '',
    durationMs: best.durationMs,
    explicit: Boolean(best.explicit),
    artworkUrl: best.artworkUrl || '',
    previewUrl: best.previewUrl || '',
    links: buildSearchLinks(track, best),
    sources: [
      { provider: 'icy', confidence: 1, fetchedAt: nowIso(), raw: track.raw },
      ...best.providers.map(provider => ({ provider, confidence: best.confidence / 100, fetchedAt: nowIso(), providerId: best.providerId || '' }))
    ],
    reasons: best.reasons,
    raw: track.raw
  };

  const ttl = identity.confidence >= cfg.minIdentifiedConfidence ? cfg.cacheTtlHighMs : cfg.cacheTtlLowMs;
  setCached(key, identity, ttl);
  return { ...identity, cache: 'miss' };
}

function rawIcyIdentity(track, reason = TITLE_ONLY_PROMOTION_REASON) {
  return {
    version: VERSION,
    found: false,
    state: 'Raw ICY only',
    confidence: track.artist ? 42 : 28,
    title: track.title,
    artist: track.artist,
    links: {},
    sources: [{ provider: 'icy', confidence: track.artist ? 0.42 : 0.28, fetchedAt: nowIso(), raw: track.raw }],
    reasons: [reason],
    raw: track.raw
  };
}

function canPromoteCandidate(track, best, candidates = []) {
  if (!best || best.confidence < config().minLikelyConfidence) return false;
  if (track.artist) return true;
  return hasCrossProviderIsrcAgreement(best, candidates);
}

function hasCrossProviderIsrcAgreement(best, candidates) {
  if (!best?.isrc) return false;
  return candidates.some(candidate => candidate !== best && candidate.isrc === best.isrc && candidate.provider !== best.provider);
}

function blockedPromotionReason(track) {
  if (!track.artist) {
    return isAmbiguousTitleOnly(track.title)
      ? 'title-only ICY metadata looks like a station, geography, or common label'
      : TITLE_ONLY_PROMOTION_REASON;
  }
  return 'catalog candidate did not pass identity trust gates';
}

function isAmbiguousTitleOnly(title) {
  const value = normalize(title);
  if (!value) return true;
  if (AMBIGUOUS_TITLE_ONLY_TERMS.has(value)) return true;
  return value.length <= 2 || /\b(radio|fm|am|live|news|hits?)\b/.test(value);
}

function ensureMetadataUI() {
  const nowcard = byId('nowcard');
  const links = byId('nowcard-links');
  if (!nowcard || !links) return null;
  nowcard.classList.add('nowcard--metadata-enhanced');
  const actions = ensureWorkflowUI(nowcard, links);

  let card = byId('metadata-card');
  if (!card) {
    card = document.createElement('section');
    card.id = 'metadata-card';
    card.className = 'metadata-card';
    card.setAttribute('aria-label', 'Track metadata confidence');
    card.innerHTML = `
      <div class="metadata-status-row">
        <span class="metadata-state" id="metadata-state">Station metadata only</span>
        <span class="metadata-confidence" id="metadata-confidence" title="Metadata confidence">-</span>
      </div>
      <div class="metadata-providers" id="metadata-providers" aria-label="Metadata providers"></div>
      <dl class="metadata-details" id="metadata-details"></dl>
      <div class="metadata-raw" id="metadata-raw"></div>
      <div class="metadata-fingerprint-row" id="metadata-fingerprint-row" hidden>
        <button type="button" class="nowcard-action" id="metadata-fingerprint-btn">Identify song</button>
        <span class="metadata-fingerprint-status" id="metadata-fingerprint-status" role="status"></span>
      </div>
    `;
    (actions || links).insertAdjacentElement('afterend', card);
    card.querySelector('#metadata-fingerprint-btn')?.addEventListener('click', () => void runFingerprint('manual'));
  }
  syncWorkflowButtons();
  syncFingerprintButton();
  return card;
}

function ensureWorkflowUI(nowcard, links) {
  let actions = byId('nowcard-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.id = 'nowcard-actions';
    actions.className = 'nowcard-actions';
    actions.setAttribute('aria-label', 'Station actions');
    actions.innerHTML = `
      <button type="button" class="nowcard-action" data-nowcard-action="prev">Previous</button>
      <button type="button" class="nowcard-action" data-nowcard-action="next">Next</button>
      <button type="button" class="nowcard-action" data-nowcard-action="similar">Similar</button>
      <button type="button" class="nowcard-action" data-nowcard-action="favorite" aria-pressed="false">Favorite</button>
      <button type="button" class="nowcard-action nowcard-action--wide" data-nowcard-action="filters">Filters</button>
    `;
    links.insertAdjacentElement('afterend', actions);
    actions.addEventListener('click', handleNowcardAction);
  }
  nowcard.classList.add('nowcard--workflow-enhanced');
  return actions;
}

function handleNowcardAction(event) {
  const button = event.target?.closest?.('[data-nowcard-action]');
  if (!button || button.disabled) return;
  const targets = {
    prev: 'btn-prev',
    next: 'btn-next',
    similar: 'btn-similar',
    favorite: 'btn-favorite',
    filters: 'filters-toggle'
  };
  const target = byId(targets[button.dataset.nowcardAction] || '');
  target?.click();
  setTimeout(syncWorkflowButtons, 0);
}

function syncWorkflowButtons() {
  const actions = byId('nowcard-actions');
  if (!actions) return;
  // Locale-independent: the idle label varies by language, but an active stream or a
  // selected station card only exists when a station is actually chosen.
  const hasStation = Boolean(currentStreamUrl()) || Boolean(document.querySelector('.station-card--active'));
  const favoritePressed = byId('btn-favorite')?.getAttribute('aria-pressed') === 'true';
  for (const button of actions.querySelectorAll('[data-nowcard-action]')) {
    const action = button.dataset.nowcardAction;
    button.disabled = action !== 'filters' && !hasStation;
    if (action === 'favorite') button.setAttribute('aria-pressed', String(favoritePressed));
  }
}

function pill(textValue, className = '') {
  const el = document.createElement('span');
  el.className = `metadata-pill ${className}`.trim();
  el.textContent = textValue;
  return el;
}

function detailRow(term, value) {
  if (!value) return [];
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  if (typeof value === 'string') dd.textContent = value;
  else dd.appendChild(value);
  return [dt, dd];
}

// Provider-supplied URLs become clickable hrefs; only web schemes are acceptable
// (a compromised provider response must never deliver javascript:/data: links).
// Pure and exported for unit tests.
export function safeLinkHref(url) {
  const candidate = String(url || '');
  return /^https?:\/\//i.test(candidate) ? candidate : '';
}

function link(label, url) {
  const a = document.createElement('a');
  const href = safeLinkHref(url);
  if (href) a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  return a;
}

function renderStationOnly() {
  ensureMetadataUI();
  const stateEl = byId('metadata-state');
  const confidenceEl = byId('metadata-confidence');
  const providersEl = byId('metadata-providers');
  const detailsEl = byId('metadata-details');
  const rawEl = byId('metadata-raw');
  if (stateEl) stateEl.textContent = 'Station metadata only';
  if (confidenceEl) confidenceEl.textContent = '-';
  if (providersEl) providersEl.replaceChildren(pill('station', 'metadata-pill--muted'));
  if (detailsEl) detailsEl.replaceChildren(...detailRow('Status', 'Waiting for live ICY StreamTitle metadata'));
  if (rawEl) rawEl.textContent = '';
}

function renderIdentifying(track) {
  ensureMetadataUI();
  const stateEl = byId('metadata-state');
  const confidenceEl = byId('metadata-confidence');
  const providersEl = byId('metadata-providers');
  const detailsEl = byId('metadata-details');
  const rawEl = byId('metadata-raw');
  if (stateEl) stateEl.textContent = 'Identifying...';
  if (confidenceEl) confidenceEl.textContent = 'ICY';
  if (providersEl) {
    const cfg = config();
    providersEl.replaceChildren(
      pill('ICY', 'metadata-pill--live'),
      pill('iTunes', 'metadata-pill--pending'),
      cfg.proxyBaseUrl && cfg.spotifyProxyEnabled ? pill('Spotify', 'metadata-pill--pending') : pill('Spotify via proxy', 'metadata-pill--disabled')
    );
  }
  if (detailsEl) detailsEl.replaceChildren(
    ...detailRow('Detected', [track.artist, track.title].filter(Boolean).join(' - ') || track.raw),
    ...detailRow('Method', 'Parsed from ICY StreamTitle; resolving against catalog providers')
  );
  if (rawEl) rawEl.textContent = `Raw ICY: ${track.raw}`;
}

function renderIdentity(track, identity) {
  ensureMetadataUI();
  const cfg = config();
  const stateEl = byId('metadata-state');
  const confidenceEl = byId('metadata-confidence');
  const providersEl = byId('metadata-providers');
  const detailsEl = byId('metadata-details');
  const rawEl = byId('metadata-raw');

  const stateText = identity.state || (identity.found ? 'Identified' : 'Raw ICY only');
  if (stateEl) stateEl.textContent = stateText;
  if (confidenceEl) {
    confidenceEl.textContent = `${Math.round(identity.confidence || 0)}%`;
    confidenceEl.dataset.level = identity.confidence >= cfg.minIdentifiedConfidence ? 'high' : identity.confidence >= cfg.minLikelyConfidence ? 'medium' : 'low';
  }
  if (providersEl) {
    const providers = (identity.sources || []).map(s => s.provider).filter(Boolean);
    if (identity.sourceFeed && identity.sourceFeed !== 'fingerprint') providers.unshift(identity.sourceFeed);
    providersEl.replaceChildren(...[...new Set(providers)].map(provider => pill(provider,
      provider === 'icy' ? 'metadata-pill--live'
        : /^fingerprint/.test(provider) ? 'metadata-pill--fingerprint'
          : /^(platform:|hls-id3)/.test(provider) ? 'metadata-pill--feed' : '')));
  }

  const linkWrap = document.createElement('span');
  const links = identity.found ? (identity.links || buildSearchLinks(track, identity)) : {};
  const items = [
    links.spotify && link('Spotify', links.spotify),
    links.appleMusic && link('Apple', links.appleMusic),
    links.youtubeMusic && link('YouTube Music', links.youtubeMusic),
    links.tidal && link('Tidal', links.tidal)
  ].filter(Boolean);
  items.forEach((item, idx) => { if (idx) linkWrap.append(' | '); linkWrap.append(item); });

  if (detailsEl) {
    detailsEl.replaceChildren(
      ...detailRow('Title', identity.title || track.title),
      ...detailRow('Artist', identity.artist || track.artist),
      ...detailRow('Album', [identity.album, identity.releaseYear].filter(Boolean).join(' | ')),
      ...detailRow('Genre', identity.genre),
      ...detailRow('ISRC', identity.isrc),
      ...detailRow('Source', describeSourceFeed(identity.sourceFeed)),
      ...detailRow('Links', linkWrap),
      ...detailRow('Why', (identity.reasons || []).slice(0, 4).join(', ')),
      ...detailRow('Cache', identity.cache === 'hit' ? 'cached' : 'fresh lookup')
    );
  }
  if (rawEl) rawEl.textContent = `Raw ICY: ${identity.raw || track.raw}`;

  // If the catalog match is strong, upgrade the visible nowcard without hiding the confidence trail.
  if (identity.found && identity.confidence >= cfg.minIdentifiedConfidence) {
    const titleEl = byId('nowcard-title');
    const artistEl = byId('nowcard-artist');
    if (titleEl && identity.title) titleEl.textContent = identity.title;
    if (artistEl) artistEl.textContent = [identity.artist, identity.album, identity.releaseYear, identity.genre].filter(Boolean).join(' | ');
    if (identity.artworkUrl && /^https:\/\//i.test(identity.artworkUrl)) {
      const artEl = byId('nowcard-art');
      if (artEl) {
        const img = document.createElement('img');
        img.className = 'nowcard-art-img';
        img.alt = '';
        img.loading = 'lazy';
        img.src = identity.artworkUrl;
        artEl.replaceChildren(img);
      }
    }
  }
}

function describeSourceFeed(sourceFeed) {
  if (!sourceFeed) return '';
  if (sourceFeed === 'fingerprint') return 'Audio fingerprint of the live stream';
  if (sourceFeed === 'hls-id3') return 'HLS timed ID3 metadata in the stream';
  if (sourceFeed.startsWith('platform:')) return `Station platform API (${sourceFeed.slice(9)})`;
  return sourceFeed;
}

// The player meta line shows station facts ("The Republic Of Korea \u00B7 192 kbps \u00B7 OGG \u00B7
// quality 100") whenever no live title is available. Its first segment is a country or
// codec, never a track \u2014 treating it as ICY text is how a station's country ended up
// rendered as a song title.
function isStationFactsLine(metaLine) {
  return /\b(\d+\s*kbps|quality\s*\d+|aac|mp3|ogg|opus|flac|hls)\b/i.test(metaLine);
}

function extractRawCandidate() {
  const eyebrow = text(byId('nowcard-eyebrow')).toLowerCase();
  const meta = text(byId('player-meta'));
  const nowTitle = text(byId('nowcard-title'));
  const station = text(byId('player-station'));

  let raw = '';
  if (eyebrow.includes('now playing') && nowTitle && nowTitle !== '-' && nowTitle !== '\u2014' && nowTitle !== station) {
    const artistLine = text(byId('nowcard-artist'));
    const maybeArtist = artistLine.split(/\s(?:\||\u00B7)\s/)[0];
    raw = maybeArtist && maybeArtist !== 'Live radio' ? `${maybeArtist} - ${nowTitle}` : nowTitle;
  } else if (meta && !isStationFactsLine(meta)) {
    raw = meta.split(/\s(?:\||\u00B7)\s/)[0].trim();
  }
  if (!raw || raw === station || raw === 'Live radio') return '';
  return raw;
}

// --- Live metadata feeds (platform APIs, HLS ID3, fingerprinting) ---

function audioElement() {
  return byId('audio-player');
}

// hls.js plays through MediaSource, which makes currentSrc a blob: URL; the selected
// station's canonical HTTP(S) stream URL is tracked separately so platform polling and
// fingerprinting keep working for HLS-backed stations. Pure and exported so the
// blob-vs-selected precedence is unit-testable: a real HTTP(S) media source wins,
// anything else (blob:, empty) falls back to the explicitly selected station URL.
function validHttpStreamUrl(value) {
  const url = String(value || '').trim();
  try {
    const parsed = new URL(url);
    // Keep the event's exact trimmed string as identity. Client-side metadata accepts
    // syntactically valid private/credential URLs only as identity; Pages/Node own the
    // authoritative target and credential rejection before performing network I/O.
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

export function resolveStreamUrl(audioLike, selectedUrl) {
  const src = validHttpStreamUrl(audioLike?.currentSrc || audioLike?.src);
  return src || validHttpStreamUrl(selectedUrl);
}

function currentStreamUrl() {
  // The runtime's `earthradio:station-selected` event is authoritative for the selected
  // identity; the IndexedDB directory lookup (state.streamUrl) remains as a fallback
  // for reloads where playback resumes without a fresh selection event.
  return resolveStreamUrl(audioElement(), state.selectedStreamUrl || state.streamUrl);
}

function currentStationIdentity() {
  return { streamUrl: currentStreamUrl(), stationUuid: state.selectedStationUuid };
}

export function shouldInvalidateStationIdentity(previous, next) {
  return previous?.streamUrl !== next?.streamUrl || previous?.stationUuid !== next?.stationUuid;
}

export function stationIdentityAfterTransition(previous, transition = {}) {
  const current = {
    streamUrl: validHttpStreamUrl(previous?.streamUrl),
    stationUuid: String(previous?.stationUuid || '')
  };
  if (transition.type === 'clear') return { streamUrl: '', stationUuid: '' };
  if (transition.type !== 'selected') return current;
  const streamUrl = validHttpStreamUrl(transition.streamUrl);
  if (!streamUrl) return current;
  return { streamUrl, stationUuid: String(transition.stationUuid || '') };
}

export function pollResultIsCurrent(started, current) {
  return started?.generation === current?.generation && !shouldInvalidateStationIdentity(started, current);
}

function invalidateSelectedStationData() {
  state.trustedTrack = null;
  state.inFlight = null;
  state.fingerprintAutoKey = '';
  state.currentIdentity = null;
  state.lastRaw = '';
  state.lastTrackKey = '';
  state.platformPollGeneration += 1;
}

// The runtime dispatches this after playback actually starts for a clicked station.
// A new selection invalidates every identity derived from the previous stream.
function handleStationSelected(event) {
  const previous = { streamUrl: state.selectedStreamUrl, stationUuid: state.selectedStationUuid };
  const next = stationIdentityAfterTransition(previous, {
    type: 'selected',
    streamUrl: event?.detail?.streamUrl,
    stationUuid: event?.detail?.stationUuid
  });
  if (shouldInvalidateStationIdentity(previous, next)) {
    invalidateSelectedStationData();
    setFingerprintStatus('');
    renderStationOnly();
  }
  state.selectedStreamUrl = next.streamUrl;
  state.selectedStationUuid = next.stationUuid;
  syncFingerprintButton();
}

function handleStationCleared() {
  const previous = { streamUrl: state.selectedStreamUrl, stationUuid: state.selectedStationUuid };
  const next = stationIdentityAfterTransition(previous, { type: 'clear' });
  if (shouldInvalidateStationIdentity(previous, next)) invalidateSelectedStationData();
  state.streamUrl = '';
  state.selectedStreamUrl = next.streamUrl;
  state.selectedStationUuid = next.stationUuid;
  setFingerprintStatus('');
  syncFingerprintButton();
  renderStationOnly();
}

// Resolves the active station's stream URL from the runtime's IndexedDB directory
// cache when the media element only exposes a blob: URL.
function refreshCanonicalStreamUrl() {
  const audio = audioElement();
  const src = validHttpStreamUrl(audio?.currentSrc || audio?.src);
  if (src) {
    state.streamUrl = src;
    return;
  }
  const uuid = document.querySelector('.station-card--active')?.dataset?.uuid || '';
  if (!uuid) return;
  try {
    const open = indexedDB.open('earthRadio', 1);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('cache', 'readonly');
        const get = tx.objectStore('cache').get('stations.v3');
        get.onsuccess = () => {
          const station = (get.result?.stations || []).find(item => item?.stationuuid === uuid);
          const url = validHttpStreamUrl(station?.url_resolved || station?.url);
          if (url) {
            state.streamUrl = url;
            syncFingerprintButton();
          }
          open.result.close();
        };
        get.onerror = () => open.result.close();
      } catch {
        open.result.close();
      }
    };
  } catch { /* best effort */ }
}

function isPlaying() {
  const audio = audioElement();
  return Boolean(audio && !audio.paused && !audio.ended && audio.currentSrc);
}

// Detects the same-origin Pages Function API (public web deployments). Once three
// probes fail the deployment is treated as static-only for this page load.
async function detectSameOriginApi() {
  const cfg = config();
  if (!cfg.sameOriginApiEnabled || cfg.proxyBaseUrl) return false;
  if (state.sameOriginApi !== null) return state.sameOriginApi;
  if (state.sameOriginApiMisses >= 3) { state.sameOriginApi = false; return false; }
  if (!state.sameOriginApiProbe) {
    state.sameOriginApiProbe = (async () => {
      const data = await fetchJson('/api/nowplaying', 5000);
      if (data && data.service === 'earth-radio-pages-fn') {
        state.sameOriginApi = true;
      } else if (data) {
        state.sameOriginApi = false;
      } else {
        state.sameOriginApiMisses += 1;
      }
      return state.sameOriginApi === true;
    })().finally(() => { state.sameOriginApiProbe = null; });
  }
  return state.sameOriginApiProbe;
}

// Base for metadata API calls: the authorized desktop proxy when present, otherwise the
// same-origin Pages Function API when detected, otherwise null (browser-direct only).
async function metadataApiBase() {
  const cfg = config();
  if (cfg.proxyBaseUrl) return cfg.proxyBaseUrl;
  return (await detectSameOriginApi()) ? '' : null;
}

// Mirrors server/platform-nowplaying.mjs detection for browser-direct mode; endpoints
// that do not send CORS headers simply fail the fetch and fall through.
function detectPlatformEndpoints(streamUrl) {
  let url;
  try { url = new URL(streamUrl); } catch { return []; }
  if (!/^https?:$/.test(url.protocol)) return [];
  const origin = url.origin;
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const endpoints = [];

  if (host === 'listen.moe' || host.endsWith('.listen.moe')) {
    const kpop = /kpop/i.test(pathname) || /kpop/i.test(host);
    endpoints.push({ platform: 'listenmoe', kind: 'ws', url: `wss://listen.moe${kpop ? '/kpop' : ''}/gateway_v2` });
  }

  const zenoMount = host === 'stream.zeno.fm' ? pathname.replace(/^\/+/, '').split('/')[0] : '';
  if (zenoMount) endpoints.push({ platform: 'zeno', kind: 'sse', url: `https://api.zeno.fm/mounts/metadata/subscribe/${encodeURIComponent(zenoMount)}` });

  const radioCoStation = host.endsWith('.radio.co') ? (pathname.match(/^\/(s[0-9a-f]{9})\b/i)?.[1] || '') : '';
  if (radioCoStation) endpoints.push({ platform: 'radioco', kind: 'json', url: `https://public.radio.co/stations/${encodeURIComponent(radioCoStation)}/status` });

  const lautStation = (host === 'stream.laut.fm' || host.endsWith('.stream.laut.fm')) ? pathname.replace(/^\/+/, '').split('/')[0] : '';
  if (lautStation) endpoints.push({ platform: 'lautfm', kind: 'json', url: `https://api.laut.fm/station/${encodeURIComponent(lautStation)}/current_song` });

  const radiojarMount = host.endsWith('.radiojar.com') ? pathname.replace(/^\/+/, '').split('/')[0] : '';
  if (radiojarMount) endpoints.push({ platform: 'radiojar', kind: 'json', url: `https://www.radiojar.com/api/stations/${encodeURIComponent(radiojarMount)}/now_playing/` });

  const azuracastStation = pathname.match(/^\/listen\/([^/]+)\//)?.[1] || '';
  if (azuracastStation) endpoints.push({ platform: 'azuracast', kind: 'json', url: `${origin}/api/nowplaying/${encodeURIComponent(azuracastStation)}` });

  endpoints.push({ platform: 'icecast', kind: 'json', url: `${origin}/status-json.xsl`, mount: pathname });
  endpoints.push({ platform: 'shoutcast', kind: 'json', url: `${origin}/stats?json=1` });
  return endpoints;
}

function parsePlatformPayload(endpoint, data) {
  if (endpoint.platform === 'azuracast') {
    const song = data?.now_playing?.song;
    if (!song) return null;
    return platformTrack('azuracast', song.artist, song.title, song.text, song.art);
  }
  if (endpoint.platform === 'radioco') return platformTrack('radioco', '', '', data?.current_track?.title, data?.current_track?.artwork_url);
  if (endpoint.platform === 'lautfm') {
    const artist = typeof data?.artist === 'object' ? data?.artist?.name : data?.artist;
    if (!data?.title) return null;
    return platformTrack('lautfm', artist, data.title, '');
  }
  if (endpoint.platform === 'radiojar') return platformTrack('radiojar', data?.artist, data?.title, '', data?.thumb);
  if (endpoint.platform === 'icecast') {
    let sources = data?.icestats?.source;
    if (!sources) return null;
    if (!Array.isArray(sources)) sources = [sources];
    const wanted = String(endpoint.mount || '').replace(/\/+$/, '');
    const match = sources.find(source => {
      try { return new URL(String(source?.listenurl || '')).pathname.replace(/\/+$/, '') === wanted; } catch { return false; }
    }) || (sources.length === 1 ? sources[0] : null);
    if (!match) return null;
    return platformTrack('icecast', match.artist, match.title, '');
  }
  if (endpoint.platform === 'shoutcast') return platformTrack('shoutcast', '', '', data?.songtitle);
  return null;
}

function platformTrack(platform, artist, title, combined, artworkUrl) {
  const cleanArtist = String(artist || '').trim();
  const cleanTitle = String(title || '').trim();
  const raw = String(combined || '').trim() || [cleanArtist, cleanTitle].filter(Boolean).join(' - ');
  let track = cleanArtist && cleanTitle ? { artist: cleanArtist, title: cleanTitle, raw: raw || `${cleanArtist} - ${cleanTitle}` } : parseNowPlaying(raw);
  if (!track?.title) return null;
  // An artist-only payload parses into title === artist; that is not a track identity.
  if (cleanArtist && !cleanTitle && track.title === cleanArtist) return null;
  const art = String(artworkUrl || '').trim();
  return { platform, track, artworkUrl: /^https:\/\//i.test(art) ? art : '' };
}

function fetchListenMoe(endpoint, timeoutMs) {
  return new Promise(resolve => {
    let socket;
    try {
      socket = new WebSocket(endpoint.url);
    } catch {
      resolve(null);
      return;
    }
    const finish = result => {
      try { socket.close(); } catch { /* already closed */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        // Gateway v2 pushes the current track as op 1 immediately after the welcome.
        const song = message?.op === 1 ? message?.d?.song : null;
        if (!song?.title) return;
        const artists = (song.artists || []).map(item => item?.name || item?.nameRomaji).filter(Boolean).join(', ');
        clearTimeout(timer);
        finish(platformTrack('listenmoe', artists, song.title, ''));
      } catch { /* keep listening until timeout */ }
    });
    socket.addEventListener('error', () => { clearTimeout(timer); finish(null); });
    socket.addEventListener('close', () => { clearTimeout(timer); resolve(null); });
  });
}

async function fetchPlatformDirect(endpoint, timeoutMs) {
  if (endpoint.kind === 'ws') return fetchListenMoe(endpoint, timeoutMs);
  if (endpoint.kind === 'sse') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint.url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
      if (!response.ok || !response.body) return null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      while (buffered.length < 16384) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const match = buffered.match(/^data:(.*)$/m);
        if (match) {
          try {
            const payload = JSON.parse(match[1].trim());
            const raw = String(payload?.streamTitle || '').trim();
            if (raw) return platformTrack('zeno', '', '', raw);
          } catch { /* keep reading */ }
        }
        if (buffered.includes('\n\n')) break;
      }
      return null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  const data = await fetchJson(endpoint.url, timeoutMs);
  return data ? parsePlatformPayload(endpoint, data) : null;
}

async function resolvePlatformNowPlaying(streamUrl) {
  const cfg = config();
  const endpoints = detectPlatformEndpoints(streamUrl);

  // WebSocket gateways (listen.moe) only work from the browser; try them first.
  for (const endpoint of endpoints.filter(item => item.kind === 'ws')) {
    try {
      const result = await fetchPlatformDirect(endpoint, Math.min(cfg.requestTimeoutMs, 6000));
      if (result) return result;
    } catch { /* fall through */ }
  }

  if (cfg.proxyBaseUrl) {
    const data = await fetchJson(`${cfg.proxyBaseUrl}/api/streams/platform-nowplaying?url=${encodeURIComponent(streamUrl)}`, cfg.requestTimeoutMs);
    if (!data?.found || !data.title && !data.raw) return null;
    return platformTrack(data.platform || 'platform', data.artist, data.title, data.raw, data.artworkUrl);
  }

  // Public web: the same-origin Pages Function also covers one-shot ICY reads, which
  // the browser cannot do itself.
  if (await detectSameOriginApi()) {
    const data = await fetchJson(`/api/nowplaying?url=${encodeURIComponent(streamUrl)}`, 25000);
    if (data?.found && (data.title || data.raw)) {
      return platformTrack(data.platform || data.source || 'platform', data.artist, data.title, data.raw, data.artworkUrl);
    }
    return null;
  }

  for (const endpoint of endpoints.filter(item => item.kind !== 'ws')) {
    try {
      const result = await fetchPlatformDirect(endpoint, Math.min(cfg.requestTimeoutMs, 5000));
      if (result) return result;
    } catch { /* endpoint without CORS or offline; try the next candidate */ }
  }
  return null;
}

async function pollPlatformNowPlaying() {
  const cfg = config();
  if (!cfg.enabled || !cfg.platformNowPlayingEnabled) return;
  if (document.hidden || !isPlaying()) return;
  const identity = currentStationIdentity();
  if (!identity.streamUrl) return;
  const started = { ...identity, generation: ++state.platformPollGeneration };
  try {
    const result = await resolvePlatformNowPlaying(identity.streamUrl);
    const current = { ...currentStationIdentity(), generation: state.platformPollGeneration };
    if (!result || !pollResultIsCurrent(started, current)) return;
    await applyTrustedTrack(result.track, `platform:${result.platform}`, { artworkUrl: result.artworkUrl });
  } catch { /* best effort */ }
}

function startPlatformPolling() {
  const cfg = config();
  if (!cfg.platformNowPlayingEnabled || state.platformTimer) return;
  state.platformTimer = setInterval(() => { void pollPlatformNowPlaying(); }, Math.max(15000, cfg.platformPollMs));
}

// hls.js exposes in-stream timed ID3 as a hidden metadata text track on the media element.
function watchHlsMetadataTracks() {
  if (!config().hlsId3Enabled) return;
  const audio = audioElement();
  if (!audio?.textTracks) return;
  const attach = track => {
    if (track.kind !== 'metadata' || state.hlsWatchedTracks.has(track)) return;
    state.hlsWatchedTracks.add(track);
    track.mode = 'hidden';
    track.addEventListener('cuechange', () => handleId3CueChange(track));
  };
  for (const track of audio.textTracks) attach(track);
  audio.textTracks.addEventListener?.('addtrack', event => event.track && attach(event.track));
}

function handleId3CueChange(track) {
  const cues = track.activeCues && track.activeCues.length ? track.activeCues : null;
  if (!cues) return;
  let title = '';
  let artist = '';
  let combined = '';
  for (const cue of cues) {
    const value = cue?.value;
    if (!value?.key) continue;
    const data = typeof value.data === 'string' ? value.data.trim() : '';
    if (value.key === 'TIT2' && data) title = data;
    else if (value.key === 'TPE1' && data) artist = data;
    else if (value.key === 'TXXX' && /streamtitle|nowplaying|song/i.test(String(value.info || '')) && data) combined = data;
  }
  const trackInfo = artist && title
    ? { artist, title, raw: `${artist} - ${title}` }
    : parseNowPlaying(title || combined);
  if (!trackInfo?.title) return;
  void applyTrustedTrack(trackInfo, 'hls-id3');
}

// Single identify->render sequence shared by the DOM-ICY and trusted-feed paths, so
// invalidation semantics (token check, lastTrackKey/currentIdentity updates) cannot
// diverge. State is only committed after the token survives the await.
async function identifyAndRender(track, { sourceFeed = '', artworkUrl = '' } = {}) {
  renderIdentifying(track);
  const token = Symbol('metadata-request');
  state.inFlight = token;
  const identity = await identify(track);
  if (state.inFlight !== token) return null;
  if (sourceFeed) identity.sourceFeed = sourceFeed;
  if (!identity.artworkUrl && artworkUrl) identity.artworkUrl = artworkUrl;
  if (!identity.found && sourceFeed && sourceFeed !== 'fingerprint' && track.artist && track.title) {
    // The station's own feed named artist and title; catalogs simply could not
    // confirm it (common for K-pop/J-pop and regional releases).
    identity.state = 'Station feed';
    identity.confidence = Math.max(identity.confidence || 0, 65);
    identity.title = track.title;
    identity.artist = track.artist;
    identity.reasons = ['structured now-playing feed from the station', ...(identity.reasons || [])];
  }
  state.lastTrackKey = trackKey(track);
  state.currentIdentity = identity;
  renderIdentity(track, identity);
  maybeAutoFingerprint(identity);
  return identity;
}

// Feeds artist/title from a higher-trust live source through the normal identify
// pipeline; the catalog match still decides promotion, but the raw text no longer
// depends on scraping the DOM for ICY fragments.
async function applyTrustedTrack(track, source, extras = {}) {
  const key = trackKey(track);
  const previous = state.trustedTrack;
  if (previous && previous.key === key && Date.now() - previous.at < TRUSTED_TRACK_FRESH_MS) {
    previous.at = Date.now();
    return;
  }
  // A fingerprint identity outranks text feeds until it goes stale.
  if (previous && previous.source === 'fingerprint' && source !== 'fingerprint' && Date.now() - previous.at < TRUSTED_TRACK_FRESH_MS) return;
  state.trustedTrack = { key, source, at: Date.now(), artworkUrl: extras.artworkUrl || '' };
  await identifyAndRender(track, { sourceFeed: source, artworkUrl: extras.artworkUrl || '' });
}

// --- On-demand fingerprinting through the proxy ---

function fingerprintConfigured() {
  const cfg = config();
  if (!cfg.fingerprintEnabled) return false;
  return Boolean(cfg.proxyBaseUrl) || (cfg.sameOriginApiEnabled && state.sameOriginApi !== false);
}

async function checkFingerprintAvailability() {
  if (!fingerprintConfigured()) { state.fingerprintAvailable = false; return false; }
  if (state.fingerprintAvailable !== null) return state.fingerprintAvailable;
  const cfg = config();
  const base = await metadataApiBase();
  if (base === null) { state.fingerprintAvailable = false; syncFingerprintButton(); return false; }
  const data = await fetchJson(`${base}/api/track/fingerprint`, cfg.requestTimeoutMs);
  // Only an explicit answer latches; a failed probe stays unknown and is retried later.
  state.fingerprintAvailable = data ? Boolean(data.available) : null;
  syncFingerprintButton();
  return Boolean(state.fingerprintAvailable);
}

function fingerprintButton() {
  return byId('metadata-fingerprint-btn');
}

function syncFingerprintButton() {
  const button = fingerprintButton();
  if (!button) return;
  const row = byId('metadata-fingerprint-row');
  const usable = fingerprintConfigured() && state.fingerprintAvailable !== false;
  if (row) row.hidden = !usable;
  button.disabled = state.fingerprintBusy || !isPlaying() || !currentStreamUrl();
  if (!state.fingerprintBusy) button.textContent = 'Identify song';
}

function setFingerprintStatus(message) {
  const statusEl = byId('metadata-fingerprint-status');
  if (statusEl) statusEl.textContent = message || '';
}

function maybeAutoFingerprint(identity) {
  const cfg = config();
  if (!cfg.fingerprintAutoOnRawIcy || !fingerprintConfigured()) return;
  if (identity?.state !== 'Raw ICY only' || !isPlaying()) return;
  const autoKey = `${currentStreamUrl()}::${state.lastTrackKey}`;
  if (state.fingerprintAutoKey === autoKey) return;
  state.fingerprintAutoKey = autoKey;
  setTimeout(() => {
    if (state.currentIdentity?.state === 'Raw ICY only' && isPlaying()) void runFingerprint('auto');
  }, 8000);
}

// The listener's storefront market from the browser locale ('' when undeterminable).
// Pure enough to export for unit tests via an explicit locale argument.
export function listenerCountry(locale = typeof navigator !== 'undefined' ? navigator.language : '') {
  try {
    const region = new Intl.Locale(String(locale || '')).maximize().region || '';
    return /^[A-Z]{2}$/.test(region) ? region : '';
  } catch {
    return '';
  }
}

async function runFingerprint(trigger) {
  const cfg = config();
  if (!fingerprintConfigured() || state.fingerprintBusy) return;
  const identity = currentStationIdentity();
  const streamUrl = identity.streamUrl;
  if (!streamUrl || !isPlaying()) return;
  const sinceLast = Date.now() - state.fingerprintLastAt;
  if (sinceLast < cfg.fingerprintMinIntervalMs) {
    setFingerprintStatus(`Wait ${Math.ceil((cfg.fingerprintMinIntervalMs - sinceLast) / 1000)}s before identifying again`);
    return;
  }
  if (!(await checkFingerprintAvailability())) return;

  state.fingerprintBusy = true;
  state.fingerprintLastAt = Date.now();
  const button = fingerprintButton();
  if (button) { button.disabled = true; button.textContent = 'Listening…'; }
  setFingerprintStatus(trigger === 'auto' ? 'Raw ICY only; sampling audio for a fingerprint match' : 'Sampling ~12s of audio…');
  // Claim the render token so an identify() already in flight cannot paint over
  // the fingerprint result the user explicitly requested.
  const token = Symbol('fingerprint-request');
  state.inFlight = token;

  try {
    const base = await metadataApiBase();
    if (base === null) { setFingerprintStatus('Fingerprinting is not available on this deployment'); return; }
    const params = new URLSearchParams({ url: streamUrl });
    // Catalog enrichment (artwork, storefront links) is market-specific and the
    // server keys its cache on the country — send the listener's market.
    const country = listenerCountry();
    if (country) params.set('country', country);
    const data = await fetchJson(`${base}/api/track/fingerprint?${params}`, 45000);
    // The sample takes ~15-20s; if the user switched stations meanwhile, this result
    // belongs to the old stream and must be dropped.
    if (shouldInvalidateStationIdentity(identity, currentStationIdentity()) || state.inFlight !== token) { setFingerprintStatus(''); return; }
    if (!data) { setFingerprintStatus('Fingerprint request failed'); return; }
    if (data.available === false) {
      state.fingerprintAvailable = false;
      setFingerprintStatus('Fingerprinting is not configured on this proxy');
      return;
    }
    if (!data.found) {
      if (data.providerError) setFingerprintStatus('Recognition service unreachable; try again shortly');
      else setFingerprintStatus(data.reason === 'no fingerprint match' ? 'No match; may be talk, ads, or an unreleased mix' : `No match: ${data.reason || 'unknown'}`);
      return;
    }

    const track = { artist: data.artist || '', title: data.title || '', raw: [data.artist, data.title].filter(Boolean).join(' - ') };
    // Named distinctly from the captured station `identity` above: a same-name const
    // here would shadow it across the whole try block and turn the staleness guard
    // into a temporal-dead-zone ReferenceError on every successful match.
    const resolvedIdentity = {
      version: VERSION,
      found: true,
      state: data.state || 'Identified',
      confidence: clamp(Number(data.confidence) || 90, 0, 100),
      title: data.title || '',
      artist: data.artist || '',
      album: data.album || '',
      releaseYear: data.releaseYear || '',
      genre: data.genre || '',
      isrc: data.isrc || '',
      artworkUrl: data.artworkUrl || '',
      previewUrl: data.previewUrl || '',
      spotifyUrl: data.spotifyUrl || '',
      appleMusicUrl: data.appleMusicUrl || '',
      links: data.links && Object.keys(data.links).length ? data.links : buildSearchLinks(track, data),
      sources: Array.isArray(data.sources) && data.sources.length ? data.sources : [{ provider: `fingerprint:${data.provider || 'unknown'}`, confidence: (Number(data.confidence) || 90) / 100, fetchedAt: nowIso() }],
      reasons: Array.isArray(data.reasons) && data.reasons.length ? data.reasons : ['audio fingerprint match'],
      raw: state.lastRaw || track.raw,
      sourceFeed: 'fingerprint'
    };
    state.trustedTrack = { key: trackKey(track), source: 'fingerprint', at: Date.now(), artworkUrl: resolvedIdentity.artworkUrl };
    state.lastTrackKey = trackKey(track);
    state.currentIdentity = resolvedIdentity;
    renderIdentity(track, resolvedIdentity);
    setFingerprintStatus(`Matched by audio fingerprint (${data.provider || 'provider'})`);
  } finally {
    state.fingerprintBusy = false;
    syncFingerprintButton();
  }
}

// --- Map tooltip: progressive disclosure of a station before selection ---
// The runtime map binds a Leaflet tooltip whose content is delegated to
// window.earthRadioMapTooltip.render(station); hover() starts a best-effort
// now-playing lookup so users can see what a dot is playing before pressing it.

const MAP_TOOLTIP_NP_TTL_MS = 30 * 1000;
const MAP_TOOLTIP_MAX_ENTRIES = 200;
const mapTooltip = { nowPlaying: new Map(), inFlight: new Set(), hoverTimer: null, hoverUuid: '' };

function rememberMapTooltip(uuid, text) {
  mapTooltip.nowPlaying.set(uuid, { text, at: Date.now() });
  if (mapTooltip.nowPlaying.size <= MAP_TOOLTIP_MAX_ENTRIES) return;
  const oldest = [...mapTooltip.nowPlaying.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
  if (oldest !== undefined) mapTooltip.nowPlaying.delete(oldest);
}

function escapeHtmlText(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function stationStreamUrl(station) {
  const url = String(station?.url_resolved || station?.url || '');
  return /^https?:\/\//i.test(url) ? url : '';
}

function mapTooltipNowPlayingLine(uuid) {
  const entry = mapTooltip.nowPlaying.get(uuid);
  const fresh = entry && Date.now() - entry.at < MAP_TOOLTIP_NP_TTL_MS ? entry : null;
  if (fresh?.text) return `<span class="er-tt-np">♪ ${escapeHtmlText(fresh.text)}</span>`;
  if (!fresh && mapTooltip.inFlight.has(uuid)) return '<span class="er-tt-np er-tt-np--pending">Checking what’s playing…</span>';
  return '<span class="er-tt-np" hidden></span>';
}

function renderMapTooltip(station) {
  const uuid = String(station?.stationuuid || '');
  const meta = [station?.country, station?.codec, station?.bitrate ? `${station.bitrate} kbps` : '']
    .filter(Boolean)
    .map(escapeHtmlText)
    .join(' · ');
  return `
    <div class="er-tt" data-station-uuid="${escapeHtmlText(uuid)}">
      <strong class="er-tt-name">${escapeHtmlText(station?.name || 'Unknown station')}</strong>
      ${meta ? `<span class="er-tt-meta">${meta}</span>` : ''}
      ${mapTooltipNowPlayingLine(uuid)}
      <span class="er-tt-hint">Click to listen</span>
    </div>
  `;
}

function updateOpenMapTooltip(uuid) {
  const wrap = document.querySelector(`.er-station-tooltip .er-tt[data-station-uuid="${CSS.escape(uuid)}"]`);
  if (!wrap) return;
  const line = wrap.querySelector('.er-tt-np');
  if (!line) return;
  const entry = mapTooltip.nowPlaying.get(uuid);
  const fresh = entry && Date.now() - entry.at < MAP_TOOLTIP_NP_TTL_MS ? entry : null;
  if (fresh?.text) {
    line.hidden = false;
    line.classList.remove('er-tt-np--pending');
    line.textContent = `♪ ${fresh.text}`;
  } else if (!fresh && mapTooltip.inFlight.has(uuid)) {
    line.hidden = false;
    line.classList.add('er-tt-np--pending');
    line.textContent = 'Checking what’s playing…';
  } else {
    line.hidden = true;
    line.textContent = '';
  }
}

function handleMapTooltipHover(station) {
  const cfg = config();
  if (!cfg.enabled || !cfg.platformNowPlayingEnabled) return;
  const uuid = String(station?.stationuuid || '');
  const streamUrl = stationStreamUrl(station);
  if (!uuid || !streamUrl) return;
  const cached = mapTooltip.nowPlaying.get(uuid);
  if (cached && Date.now() - cached.at < MAP_TOOLTIP_NP_TTL_MS) return;
  if (mapTooltip.inFlight.has(uuid)) return;

  // Debounce sweeps across dense marker fields; only the dot the pointer rests on resolves.
  mapTooltip.hoverUuid = uuid;
  clearTimeout(mapTooltip.hoverTimer);
  mapTooltip.hoverTimer = setTimeout(() => {
    if (mapTooltip.hoverUuid !== uuid || mapTooltip.inFlight.has(uuid)) return;
    mapTooltip.inFlight.add(uuid);
    updateOpenMapTooltip(uuid);
    resolvePlatformNowPlaying(streamUrl)
      .then(result => {
        const track = result?.track;
        rememberMapTooltip(uuid, track ? [track.artist, track.title].filter(Boolean).join(' – ') : '');
      })
      .catch(() => rememberMapTooltip(uuid, ''))
      .finally(() => {
        mapTooltip.inFlight.delete(uuid);
        updateOpenMapTooltip(uuid);
      });
  }, 250);
}

if (typeof window !== 'undefined') {
  window.earthRadioMapTooltip = Object.freeze({ render: renderMapTooltip, hover: handleMapTooltipHover });
}

async function processCurrentMetadata() {
  const cfg = config();
  if (!cfg.enabled) return;
  // A fresh higher-trust feed (platform API, HLS ID3, fingerprint) owns the panel;
  // DOM-scraped ICY text only drives identification when nothing better is live.
  if (state.trustedTrack && Date.now() - state.trustedTrack.at < TRUSTED_TRACK_FRESH_MS) return;
  const raw = extractRawCandidate();
  if (!raw) {
    if (!state.lastRaw) renderStationOnly();
    return;
  }
  if (raw === state.lastRaw) return;
  state.lastRaw = raw;

  const track = parseNowPlaying(raw);
  if (!track) {
    renderStationOnly();
    return;
  }
  const key = trackKey(track);
  if (key === state.lastTrackKey && state.currentIdentity) {
    renderIdentity(track, state.currentIdentity);
    return;
  }
  await identifyAndRender(track);
}

function scheduleProcess() {
  clearTimeout(state.timer);
  syncWorkflowButtons();
  state.timer = setTimeout(processCurrentMetadata, 180);
}

function init() {
  if (state.initialized) return;
  const cfg = config();
  if (!cfg.enabled) return;
  state.initialized = true;
  ensureMetadataUI();
  renderStationOnly();

  const targets = [byId('player-meta'), byId('player-station'), byId('nowcard-title'), byId('nowcard-artist'), byId('nowcard-eyebrow'), byId('btn-favorite')].filter(Boolean);
  const observer = new MutationObserver(scheduleProcess);
  targets.forEach(target => observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed'] }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleProcess(); });
  window.addEventListener('earthradio:metadata-refresh', scheduleProcess);
  window.addEventListener('earthradio:station-selected', handleStationSelected);
  window.addEventListener('earthradio:station-cleared', handleStationCleared);

  const audio = audioElement();
  if (audio) {
    audio.addEventListener('loadstart', () => {
      // MediaSource reattachment for the same HLS station also emits loadstart. The
      // selected event/explicit clear event is the correlated identity boundary, so a
      // media lifecycle signal alone must preserve the canonical URL and UUID.
      state.streamUrl = '';
      refreshCanonicalStreamUrl();
      syncFingerprintButton();
    });
    audio.addEventListener('play', () => {
      refreshCanonicalStreamUrl();
      syncFingerprintButton();
      void checkFingerprintAvailability();
      setTimeout(() => void pollPlatformNowPlaying(), 1500);
    });
    audio.addEventListener('pause', syncFingerprintButton);
    audio.addEventListener('emptied', syncFingerprintButton);
  }
  watchHlsMetadataTracks();
  startPlatformPolling();
  scheduleProcess();
}

// Browser-only bootstrap; guarded so the exported pure helpers stay importable from
// Node unit tests without a DOM.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

// Minimal debug hook for smoke tests and local validation. Does not expose secrets.
if (typeof window !== 'undefined') window.earthRadioMetadata = Object.freeze({
  version: VERSION,
  parseNowPlaying,
  scoreCandidate,
  normalize,
  detectPlatformEndpoints,
  parsePlatformPayload,
  describeSourceFeed
});
