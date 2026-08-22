import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNowPlaying, identifyTrack, scoreAndRank } from '../server/metadata-providers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'dist/index.html',
  'dist/config.js',
  'dist/assets/metadata-enrichment.js',
  'dist/assets/metadata-enrichment.css',
  'server/metadata-providers.mjs',
  'server/metadata-api.mjs',
  'docs/METADATA_ENRICHMENT_IMPLEMENTATION.md'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}

const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
if (!index.includes('metadata-enrichment.js')) throw new Error('index.html does not load metadata-enrichment.js');
if (!index.includes('metadata-enrichment.css')) throw new Error('index.html does not load metadata-enrichment.css');

const config = fs.readFileSync(path.join(root, 'dist/config.js'), 'utf8');
if (!config.includes('metadataEnrichment')) throw new Error('config.js lacks metadataEnrichment config block');

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

const miss = await identifyTrack({ raw: 'Advertisement' });
if (miss.found !== false) throw new Error('junk metadata should not resolve');

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

const bundle = fs.readFileSync(path.join(root, 'dist/assets/index-CosF9-ak.js'), 'utf8');
if (bundle.includes('Ya(Yh(i))')) throw new Error('runtime bundle still seeds provider links from station metadata');

const panelSource = fs.readFileSync(path.join(root, 'recovered_src/src/ui/nowPlayingPanel.ts'), 'utf8');
if (panelSource.includes('renderLinks(seedTrack')) throw new Error('source panel still seeds provider links from station metadata');

console.log('metadata smoke checks passed');
