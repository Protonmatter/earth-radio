// Earth Radio metadata enrichment overlay v0.24.0
// Adds confidence-scored ICY -> iTunes/Spotify metadata identity without requiring a renderer rebuild.
// The canonical source implementation is mirrored under recovered_src/ for the next full desktop build.

const VERSION = '0.24.0-metadata-overlay';
const CACHE_KEY = 'earth-radio-track-identity-cache-v1';
const RECENT_RAW_KEY = 'earth-radio-last-raw-title-v1';
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
  maxCandidates: 8
};

const state = {
  initialized: false,
  lastRaw: '',
  lastTrackKey: '',
  inFlight: null,
  timer: null,
  currentIdentity: null
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
    .replace(/^['\"]|['\"];?$/g, '')
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

  // Some stations send "Title by Artist".
  const byMatch = raw.match(/^(.+?)\s+by\s+(.+?)$/i);
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
    const identity = rawIcyIdentity(track, best ? blockedPromotionReason(track, best) : 'no catalog match above confidence threshold');
    setCached(key, identity, cfg.cacheTtlMissMs);
    return { ...identity, cache: 'miss' };
  }

  let stateLabel = 'Raw ICY only';
  if (best && best.confidence >= cfg.minIdentifiedConfidence) stateLabel = 'Identified';
  else if (best && best.confidence >= cfg.minLikelyConfidence) stateLabel = 'Likely match';

  const identity = best ? {
    version: VERSION,
    found: best.confidence >= cfg.minLikelyConfidence,
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
  } : {
    version: VERSION,
    found: false,
    state: 'Raw ICY only',
    confidence: track.artist ? 42 : 28,
    title: track.title,
    artist: track.artist,
    links: {},
    sources: [{ provider: 'icy', confidence: track.artist ? 0.42 : 0.28, fetchedAt: nowIso(), raw: track.raw }],
    reasons: ['no catalog match above confidence threshold'],
    raw: track.raw
  };

  const ttl = identity.found ? (identity.confidence >= cfg.minIdentifiedConfidence ? cfg.cacheTtlHighMs : cfg.cacheTtlLowMs) : cfg.cacheTtlMissMs;
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
    `;
    (actions || links).insertAdjacentElement('afterend', card);
  }
  syncWorkflowButtons();
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
  const station = text(byId('player-station'));
  const hasStation = Boolean(station && station !== 'Select a station');
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

function link(label, url) {
  const a = document.createElement('a');
  a.href = url;
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
    providersEl.replaceChildren(...[...new Set(providers)].map(provider => pill(provider, provider === 'icy' ? 'metadata-pill--live' : '')));
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
        img.addEventListener('error', () => {});
        artEl.replaceChildren(img);
      }
    }
  }
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
  } else if (meta) {
    raw = meta.split(/\s(?:\||\u00B7)\s/)[0].trim();
  }
  if (!raw || raw === station || raw === 'Live radio') return '';
  return raw;
}

async function processCurrentMetadata() {
  const cfg = config();
  if (!cfg.enabled) return;
  const raw = extractRawCandidate();
  if (!raw) {
    if (!state.lastRaw) renderStationOnly();
    return;
  }
  if (raw === state.lastRaw) return;
  state.lastRaw = raw;
  try { localStorage.setItem(RECENT_RAW_KEY, raw); } catch { /* ignore */ }

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
  state.lastTrackKey = key;
  renderIdentifying(track);

  const token = Symbol('metadata-request');
  state.inFlight = token;
  const identity = await identify(track);
  if (state.inFlight !== token) return;
  state.currentIdentity = identity;
  renderIdentity(track, identity);
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
  scheduleProcess();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Minimal debug hook for smoke tests and local validation. Does not expose secrets.
window.earthRadioMetadata = Object.freeze({ version: VERSION, parseNowPlaying, scoreCandidate, normalize });
