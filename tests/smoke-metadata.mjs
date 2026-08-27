import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearIdentifyCache,
  getIdentifyCacheSize,
  parseNowPlaying,
  identifyTrack,
  scoreAndRank
} from '../server/metadata-providers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'site/index.html',
  'site/config.js',
  'site/assets/metadata-enrichment.js',
  'site/assets/pinned-stations.js',
  'site/assets/metadata-enrichment.css',
  'server/metadata-providers.mjs',
  'server/metadata-api.mjs',
  'server/net-guard.mjs',
  'server/platform-nowplaying.mjs',
  'server/platform-detect.mjs',
  'server/icy-title.mjs',
  'server/fingerprint-providers.mjs',
  'server/hls-playlist.mjs',
  'functions/api/nowplaying.js',
  'functions/api/track/fingerprint.js',
  'docs/recovered/METADATA_ENRICHMENT_IMPLEMENTATION.md',
  'docs/LIVE_METADATA.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}

const index = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
if (!index.includes('metadata-enrichment.js')) throw new Error('index.html does not load metadata-enrichment.js');
if (!index.includes('pinned-stations.js')) throw new Error('index.html does not load pinned-stations.js');
if (!index.includes('wss://listen.moe')) throw new Error('index.html meta CSP does not admit the Listen.moe gateway');
if (!index.includes('metadata-enrichment.css')) throw new Error('index.html does not load metadata-enrichment.css');

const config = fs.readFileSync(path.join(root, 'site/config.js'), 'utf8');
if (!config.includes('metadataEnrichment')) throw new Error('config.js lacks metadataEnrichment config block');
for (const key of ['platformNowPlayingEnabled', 'hlsId3Enabled', 'fingerprintEnabled', 'fingerprintAutoOnRawIcy']) {
  if (!config.includes(key)) throw new Error(`config.js lacks live-metadata option ${key}`);
}

const overlay = fs.readFileSync(path.join(root, 'site/assets/metadata-enrichment.js'), 'utf8');
for (const symbol of ['detectPlatformEndpoints', 'watchHlsMetadataTracks', 'runFingerprint', 'applyTrustedTrack', 'metadata-fingerprint-btn']) {
  if (!overlay.includes(symbol)) throw new Error(`metadata overlay lacks live-metadata integration: ${symbol}`);
}

const parsed = parseNowPlaying('Kate Bush - Running Up That Hill');
if (parsed.artist !== 'Kate Bush' || parsed.title !== 'Running Up That Hill') {
  throw new Error('parseNowPlaying failed artist-title pattern');
}

const enDash = parseNowPlaying('Kate Bush \u2013 Running Up That Hill');
if (enDash.artist !== 'Kate Bush' || enDash.title !== 'Running Up That Hill') {
  throw new Error('parseNowPlaying failed en dash pattern');
}

const emDash = parseNowPlaying('Kate Bush \u2014 Running Up That Hill');
if (emDash.artist !== 'Kate Bush' || emDash.title !== 'Running Up That Hill') {
  throw new Error('parseNowPlaying failed em dash pattern');
}

const titleByArtist = parseNowPlaying('Running Up That Hill by Kate Bush');
if (titleByArtist.artist !== 'Kate Bush' || titleByArtist.title !== 'Running Up That Hill') {
  throw new Error('parseNowPlaying failed title-by-artist pattern');
}

const titleOnly = parseNowPlaying('Bohemian Rhapsody');
if (titleOnly.artist !== '' || titleOnly.title !== 'Bohemian Rhapsody') throw new Error('parseNowPlaying failed title-only pattern');

if (parseNowPlaying('Weather update sponsored by Example') !== null) {
  throw new Error('sponsorship metadata should be rejected as non-track content');
}

clearIdentifyCache();
const miss = await identifyTrack({ raw: 'Advertisement' });
if (miss.found !== false) throw new Error('junk metadata should not resolve');
const cachedMiss = await identifyTrack({ raw: 'Advertisement' });
if (!cachedMiss.cached || getIdentifyCacheSize() !== 1) throw new Error('negative identification result was not cached');

const track = { artist: 'Kate Bush', title: 'Running Up That Hill', raw: 'Kate Bush - Running Up That Hill' };
const [exact] = scoreAndRank(track, [{
  provider: 'itunes',
  title: 'Running Up That Hill',
  artist: 'Kate Bush',
  album: 'Hounds of Love',
  genre: 'Pop',
  artworkUrl: 'https://example.invalid/art.jpg'
}]);
if (!exact || exact.confidence < 78) throw new Error('exact candidate should score as identified');

const [mismatch] = scoreAndRank(track, [{
  provider: 'itunes',
  title: 'Running Up That Hill',
  artist: 'Wrong Artist'
}]);
if (mismatch && mismatch.confidence >= 58) throw new Error('artist mismatch should not score as likely');

const [tribute] = scoreAndRank(track, [{
  provider: 'itunes',
  title: 'Running Up That Hill',
  artist: 'Kate Bush Tribute Band',
  album: 'Karaoke Tribute'
}]);
if (tribute && tribute.confidence >= 58) throw new Error('tribute candidate should be penalized');

const stableCandidates = [
  { provider: 'itunes', title: track.title, artist: track.artist, id: 'second' },
  { provider: 'itunes', title: track.title, artist: track.artist, id: 'first' }
];
const stableOrder = scoreAndRank(track, stableCandidates).map(candidate => candidate.id).join(',');
if (stableOrder !== 'second,first') throw new Error('equal-scoring candidates did not preserve input order');

clearIdentifyCache();
for (let index = 0; index < 520; index += 1) {
  await identifyTrack({ raw: `Advertisement ${index}` });
}
if (getIdentifyCacheSize() !== 512) throw new Error(`identify cache is not bounded at 512 entries: ${getIdentifyCacheSize()}`);
clearIdentifyCache();

const bundle = fs.readFileSync(path.join(root, 'site/assets/index-690938fe.js'), 'utf8');
if (bundle.includes('Ya(Yh(i))')) throw new Error('runtime bundle still seeds provider links from station metadata');

const panelSource = fs.readFileSync(path.join(root, 'src-recovered/ui/nowPlayingPanel.ts'), 'utf8');
if (panelSource.includes('renderLinks(seedTrack')) throw new Error('source panel still seeds provider links from station metadata');

console.log('metadata smoke checks passed');
