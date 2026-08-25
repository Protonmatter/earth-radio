// Runtime configuration, loaded as a same-origin script so a strict Content-Security-Policy
// (script-src 'self') stays intact. Deployers edit this file; the `|| ` guard preserves any
// value injected earlier (e.g. by tests or a server-rendered runtime).
const desktopProxyBaseUrl = window.earthRadio && window.earthRadio.isDesktop && typeof window.earthRadio.proxyBaseUrl === 'string'
  ? window.earthRadio.proxyBaseUrl
  : '';
const authOriginAllowed = ['https://earth-radio.pages.dev', 'http://localhost:8788'].includes(window.location.origin);

window.RADIO_CONFIG = window.RADIO_CONFIG || {
  // Public Cloudflare Pages deployments use browser-direct mode, so this must remain empty.
  // The authorized loopback value is injected only by the packaged Electron preload bridge.
  proxyBaseUrl: desktopProxyBaseUrl || '',
  stationLimit: 3000,
  useFederatedIndex: true,
  enabledSources: ['radio-browser', 'icecast-yp'],
  // Radio Browser uses GB for the United Kingdom.
  featuredCountryCodes: ['KR', 'US', 'GB', 'NL', 'FR', 'DE', 'CA'],
  featuredCountryLimit: 300,
  streamProbeEnabled: true,
  nowPlayingEnabled: true,
  auth: {
    // The publishable key is intentionally public; authorization is enforced by RLS.
    enabled: authOriginAllowed && !(window.earthRadio && window.earthRadio.isDesktop),
    url: 'https://ueomkorngpgvthqioqns.supabase.co',
    publishableKey: 'sb_publishable_5oaWYxR0LVs4UHplfnaP6g_ArQQSBa0',
    providers: {
      github: true,
      google: false,
      apple: false,
      azure: false
    },
    syncIntervalMs: 5000
  },
  metadataEnrichment: {
    enabled: true,
    iTunesDirectEnabled: true,
    // Spotify requires server-side Web API credentials; leave enabled so a proxy can enrich when present.
    spotifyProxyEnabled: true,
    minIdentifiedConfidence: 78,
    minLikelyConfidence: 58,
    cacheTtlHighMs: 2592000000,
    cacheTtlLowMs: 86400000,
    cacheTtlMissMs: 21600000,
    requestTimeoutMs: 6500,
    maxCandidates: 8
  }
};

// Authentication is an additive overlay so the recovered application bundle remains immutable.
void import('./assets/auth-ui.js').catch(error => console.warn('Earth Radio account UI:', error));
