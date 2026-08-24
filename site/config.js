// Runtime configuration, loaded as a same-origin script so a strict Content-Security-Policy
// (script-src 'self') stays intact. Deployers edit this file; the `|| ` guard preserves any
// value injected earlier (e.g. by tests or a server-rendered runtime).
const desktopProxyBaseUrl = window.earthRadio && window.earthRadio.isDesktop && typeof window.earthRadio.proxyBaseUrl === 'string'
  ? window.earthRadio.proxyBaseUrl
  : '';

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
    // On-demand audio fingerprinting requires the desktop proxy plus server-side
    // ACRCloud or AudD credentials; recognition requests are metered, so the manual
    // button is the default and automatic retries stay off.
    fingerprintEnabled: true,
    fingerprintAutoOnRawIcy: false,
    fingerprintMinIntervalMs: 30000
  }
};
