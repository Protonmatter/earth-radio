// "Now playing" sidecar over the map: cover art, identified track, streaming-service links,
// the station, and cool facts about its country. Spotify-like, but tied to the world map.
import type { CountryFacts, NowPlayingTrack, TrackEnrichment } from '../core/enrich';
import { musicLinks } from '../core/enrich';
import type { Station } from '../core/types';
import { byId, countryCodeToFlag, createEl } from './dom';

let panel: HTMLElement | null = null;
let eyebrowEl: HTMLElement | null = null;
let artEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let artistEl: HTMLElement | null = null;
let linksEl: HTMLElement | null = null;
let stationEl: HTMLButtonElement | null = null;
let factsEl: HTMLElement | null = null;

let current: Station | null = null;
let onExploreCountry: ((country: string) => void) | null = null;

export function initNowPlayingPanel(options: { onExploreCountry?: (country: string) => void } = {}): void {
  panel = byId('nowcard');
  eyebrowEl = byId('nowcard-eyebrow');
  artEl = byId('nowcard-art');
  titleEl = byId('nowcard-title');
  artistEl = byId('nowcard-artist');
  linksEl = byId('nowcard-links');
  stationEl = byId<HTMLButtonElement>('nowcard-station');
  factsEl = byId('nowcard-facts');
  onExploreCountry = options.onExploreCountry ?? null;

  byId('nowcard-close')?.addEventListener('click', hideNowPlayingPanel);
  stationEl?.addEventListener('click', () => {
    const country = current?.country;
    if (country && country !== 'Unknown') onExploreCountry?.(country);
  });
}

export function showNowPlayingStation(station: Station): void {
  if (!panel) return;
  current = station;
  panel.hidden = false;

  // Until (and unless) the station broadcasts a real track title, this is the station, not a
  // song — so label it "On air" and show the station name + genre rather than faking a track.
  if (eyebrowEl) eyebrowEl.textContent = 'On air';
  if (titleEl) titleEl.textContent = station.name || 'Live radio';
  if (artistEl) artistEl.textContent = 'Live radio';
  setArtwork('', station);
  renderGenre(station);
  renderStationChip(station);
  clearLinks();
  renderFacts(null);
}

export function setNowPlayingTrack(track: NowPlayingTrack, enrichment: TrackEnrichment): void {
  if (!panel || panel.hidden) return;

  // A real broadcast track title arrived — now it's genuinely "Now playing".
  if (eyebrowEl) eyebrowEl.textContent = 'Now playing';
  const title = enrichment.title || track.title || current?.name || 'Live radio';
  const artistBits = [enrichment.artist || track.artist, enrichment.album, enrichment.releaseYear].filter(Boolean);
  if (titleEl) titleEl.textContent = title;
  if (artistEl) artistEl.textContent = artistBits.length ? artistBits.join(' · ') : 'Live radio';

  setArtwork(enrichment.artworkUrl || '', current);
  renderLinks(track, enrichment.appleMusicUrl);
}

function renderLinks(track: NowPlayingTrack, appleMusicUrl = ''): void {
  if (!linksEl) return;
  linksEl.replaceChildren();
  if (!track.title && !track.artist) return;
  for (const link of musicLinks(track, appleMusicUrl)) {
    linksEl.appendChild(buildServiceLink(link));
  }
}

function clearLinks(): void {
  linksEl?.replaceChildren();
}

export function setNowPlayingCountryFacts(facts: CountryFacts | null): void {
  renderFacts(facts);
}

export function hideNowPlayingPanel(): void {
  if (!panel) return;
  panel.hidden = true;
  current = null;
}

function renderStationChip(station: Station): void {
  if (!stationEl) return;
  stationEl.replaceChildren();
  const flag = countryCodeToFlag(station.countrycode || '');
  if (flag) stationEl.appendChild(createEl('span', 'nowcard-flag', flag));
  const text = [station.name, station.country].filter(Boolean).join(' — ');
  stationEl.appendChild(createEl('span', 'nowcard-stationname', text));
  const canExplore = Boolean(station.country && station.country !== 'Unknown');
  stationEl.disabled = !canExplore;
  stationEl.title = canExplore ? `Explore ${station.country}` : '';
}

function renderGenre(station: Station): void {
  // Genre chips live under the artist line via the links container's sibling; we keep it
  // simple and fold the top tags into the artist line when no track is identified yet.
  const tags = (station.tagList || []).slice(0, 3).join(' · ');
  if (artistEl && tags) artistEl.textContent = tags;
}

function renderFacts(facts: CountryFacts | null): void {
  if (!factsEl) return;
  factsEl.replaceChildren();
  if (!facts) return;

  const heading = createEl('div', 'nowcard-facts-head');
  if (facts.flag) heading.appendChild(createEl('span', 'nowcard-facts-flag', facts.flag));
  heading.appendChild(createEl('span', 'nowcard-facts-country', facts.name || facts.code));
  factsEl.appendChild(heading);

  const rows: Array<[string, string]> = [];
  if (facts.capital) rows.push(['Capital', facts.capital]);
  if (facts.population) rows.push(['Population', formatNumber(facts.population)]);
  if (facts.region) rows.push(['Region', facts.region]);
  if (facts.languages?.length) rows.push(['Languages', facts.languages.slice(0, 3).join(', ')]);
  if (facts.currencies?.length) rows.push(['Currency', facts.currencies.slice(0, 2).join(', ')]);
  if (facts.income) rows.push(['Income', facts.income]);

  const list = createEl('dl', 'nowcard-facts-list');
  for (const [key, value] of rows) {
    list.appendChild(createEl('dt', 'nowcard-fact-key', key));
    list.appendChild(createEl('dd', 'nowcard-fact-val', value));
  }
  factsEl.appendChild(list);
}

function setArtwork(url: string, station: Station | null): void {
  if (!artEl) return;
  artEl.replaceChildren();
  const httpsArt = url && url.startsWith('https://') ? url : '';
  const favicon = station?.favicon && station.favicon.startsWith('https://') ? station.favicon : '';
  const src = httpsArt || favicon;

  if (src) {
    const img = createEl('img', 'nowcard-art-img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => setArtPlaceholder(station));
    artEl.appendChild(img);
  } else {
    setArtPlaceholder(station);
  }
}

function setArtPlaceholder(station: Station | null): void {
  if (!artEl) return;
  artEl.replaceChildren();
  const letter = (station?.name || '?').trim().charAt(0).toUpperCase() || '?';
  artEl.appendChild(createEl('span', 'nowcard-art-mono', letter));
}

function buildServiceLink(link: { id: string; label: string; url: string }): HTMLAnchorElement {
  const anchor = createEl('a', `nowcard-link nowcard-link--${link.id}`);
  anchor.href = link.url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.appendChild(createEl('span', 'nowcard-link-dot'));
  anchor.appendChild(createEl('span', 'nowcard-link-label', link.label));
  return anchor;
}

function formatNumber(value: number): string {
  try {
    return new Intl.NumberFormat().format(value);
  } catch {
    return String(value);
  }
}
