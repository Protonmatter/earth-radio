// Hash-based deep-link routing: encodes the selected station, view, and active filters in
// the URL so a view can be shared and restored. See SPEC-UI-001 (REQ-UI-DEEPLINK).

export interface RouteState {
  station?: string;
  view?: string;
  q?: string;
  countries?: string[];
  tags?: string[];
  bitrates?: string[];
  secure?: boolean;
  minQuality?: number;
}

let suppressNext = false;

export function readRoute(): RouteState {
  const hash = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '';
  const params = new URLSearchParams(hash);
  const state: RouteState = {};

  const station = params.get('station');
  if (station) state.station = station;
  const view = params.get('view');
  if (view) state.view = view;
  const q = params.get('q');
  if (q) state.q = q;
  const countries = params.get('countries');
  if (countries) state.countries = splitList(countries);
  const tags = params.get('tags');
  if (tags) state.tags = splitList(tags);
  const bitrates = params.get('bitrates');
  if (bitrates) state.bitrates = splitList(bitrates);
  if (params.has('secure')) state.secure = params.get('secure') === '1';
  if (params.has('minQuality')) {
    const value = Number.parseInt(params.get('minQuality') || '', 10);
    if (Number.isFinite(value)) state.minQuality = value;
  }
  return state;
}

export function writeRoute(state: RouteState, { replace = true } = {}): void {
  if (typeof location === 'undefined') return;
  const params = new URLSearchParams();
  if (state.station) params.set('station', state.station);
  if (state.view && state.view !== 'all') params.set('view', state.view);
  if (state.q) params.set('q', state.q);
  if (state.countries?.length) params.set('countries', state.countries.join(','));
  if (state.tags?.length) params.set('tags', state.tags.join(','));
  if (state.bitrates?.length) params.set('bitrates', state.bitrates.join(','));
  if (state.secure) params.set('secure', '1');
  if (state.minQuality) params.set('minQuality', String(state.minQuality));

  const next = params.toString();
  const target = next ? `#${next}` : '#';
  if (target === location.hash || (!next && !location.hash)) return;

  suppressNext = true;
  if (replace && typeof history !== 'undefined' && history.replaceState) {
    history.replaceState(null, '', target);
  } else {
    location.hash = next;
  }
}

export function onRouteChange(callback: (state: RouteState) => void): () => void {
  const handler = () => {
    if (suppressNext) {
      suppressNext = false;
      return;
    }
    callback(readRoute());
  };
  if (typeof window !== 'undefined') window.addEventListener('hashchange', handler);
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', handler);
  };
}

function splitList(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}
