import { AUTH_DEPLOYMENT, isWebAuthOrigin } from './assets/auth-deployment.js?v=0.31.0';
import { isDesktopAuthAvailable } from './assets/desktop-auth.js?v=0.31.0';
// Runtime configuration, loaded as a same-origin script so a strict Content-Security-Policy
// (script-src 'self') stays intact. Deployers edit this file; the `|| ` guard preserves any
// value injected earlier (e.g. by tests or a server-rendered runtime).
const desktopProxyBaseUrl = window.earthRadio && window.earthRadio.isDesktop && typeof window.earthRadio.proxyBaseUrl === 'string'
  ? window.earthRadio.proxyBaseUrl
  : '';
const authOriginAllowed = isWebAuthOrigin(window.location.origin);

window.RADIO_CONFIG = window.RADIO_CONFIG || {
  // Public Cloudflare Pages use the finite same-origin directory snapshot, not
  // the desktop proxy, so this must remain empty.
  // The authorized loopback value is injected only by the packaged Electron preload bridge.
  proxyBaseUrl: desktopProxyBaseUrl || '',
  // Direct/desktop limit; the shared web snapshot is a fixed 10,000-row sample.
  stationLimit: 3000,
  stationCacheTtlMs: 3600000,
  directorySnapshotUrl: '/directory/snapshot',
  useFederatedIndex: true,
  enabledSources: ['radio-browser', 'icecast-yp'],
  // Radio Browser uses GB for the United Kingdom.
  featuredCountryCodes: ['KR', 'US', 'GB', 'NL', 'FR', 'DE', 'CA'],
  // Bounded initial load: the directory-expansion overlay adds further countries on
  // demand (map "Explore", country picker/filter), so boot no longer pays for them.
  featuredCountryLimit: 150,
  streamProbeEnabled: true,
  nowPlayingEnabled: true,
  auth: {
    // The publishable key is intentionally public; authorization is enforced by RLS.
    enabled: authOriginAllowed || isDesktopAuthAvailable(window.earthRadio, window.location),
    ...AUTH_DEPLOYMENT,
    providers: {
      github: true,
      google: true,
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
    maxCandidates: 8,
    // Hosting-platform now-playing APIs (AzuraCast, Zeno.FM, Radio.co, Laut.fm,
    // Radiojar, Icecast/Shoutcast status). Browser-direct where CORS allows;
    // routed through the desktop proxy when one is present.
    platformNowPlayingEnabled: true,
    platformPollMs: 30000,
    // Real track metadata carried as HLS timed ID3, read from the hls.js metadata text track.
    hlsId3Enabled: true,
    // Audio fingerprinting identifies the playing stream when ICY/platform feeds miss.
    // Requests are metered; the button stays hidden until /api/track/fingerprint
    // reports available: true (AUDD_API_TOKEN or ACR_* on the Pages project).
    fingerprintEnabled: true,
    fingerprintAutoOnRawIcy: true,
    fingerprintMinIntervalMs: 30000
  }
};

// Authentication is an additive overlay so the recovered application bundle remains immutable.
void import('./assets/auth-ui.js?v=0.31.0').catch(error => console.warn('Earth Radio account UI:', error));
