// Deterministic Radio Browser fixture used by the e2e suite. Coordinates are real
// city locations so map clustering/zoom behaves like production data.

function station(overrides) {
  return {
    changeuuid: `${overrides.stationuuid}-change`,
    stationuuid: '',
    name: '',
    url: '',
    url_resolved: '',
    homepage: 'https://example.org/',
    favicon: '',
    tags: 'music,pop',
    country: '',
    countrycode: '',
    state: '',
    language: 'english',
    votes: 100,
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    clickcount: 500,
    geo_lat: null,
    geo_long: null,
    ...overrides
  };
}

export const FIXTURE_STATIONS = [
  station({
    stationuuid: 'e2e-seoul-0001',
    name: 'E2E Seoul Pop',
    url: 'https://streams.e2e.example/seoul.mp3',
    url_resolved: 'https://streams.e2e.example/seoul.mp3',
    country: 'The Republic Of Korea',
    countrycode: 'KR',
    tags: 'kpop,pop',
    clickcount: 900,
    geo_lat: 37.5665,
    geo_long: 126.978
  }),
  // The HLS pair shares a stream URL intentionally: switching UUIDs must still fence
  // stale metadata responses while hls.js exposes the active source as MediaSource/blob.
  station({
    stationuuid: 'e2e-hls-0009',
    name: 'E2E HLS Source',
    url: 'https://streams.e2e.example/hls/master.m3u8',
    url_resolved: 'https://streams.e2e.example/hls/master.m3u8',
    country: 'The Republic Of Korea',
    countrycode: 'KR',
    tags: 'kpop,hls',
    codec: 'AAC',
    hls: 1,
    clickcount: 880,
    geo_lat: 37.5665,
    geo_long: 126.978
  }),
  station({
    stationuuid: 'e2e-hls-0010',
    name: 'E2E HLS Mirror',
    url: 'https://streams.e2e.example/hls/master.m3u8',
    url_resolved: 'https://streams.e2e.example/hls/master.m3u8',
    country: 'The Republic Of Korea',
    countrycode: 'KR',
    tags: 'kpop,hls',
    codec: 'AAC',
    hls: 1,
    clickcount: 870,
    geo_lat: 37.5665,
    geo_long: 126.978
  }),
  station({
    stationuuid: 'e2e-london-0002',
    name: 'E2E London Jazz',
    url: 'https://streams.e2e.example/london.mp3',
    url_resolved: 'https://streams.e2e.example/london.mp3',
    country: 'The United Kingdom Of Great Britain And Northern Ireland',
    countrycode: 'GB',
    tags: 'jazz',
    clickcount: 800,
    geo_lat: 51.5072,
    geo_long: -0.1276
  }),
  station({
    stationuuid: 'e2e-newyork-0003',
    name: 'E2E New York News',
    url: 'https://streams.e2e.example/newyork.mp3',
    url_resolved: 'https://streams.e2e.example/newyork.mp3',
    country: 'The United States Of America',
    countrycode: 'US',
    tags: 'news,talk',
    clickcount: 700,
    geo_lat: 40.7128,
    geo_long: -74.006
  }),
  station({
    stationuuid: 'e2e-berlin-0004',
    name: 'E2E Berlin Techno',
    url: 'https://streams.e2e.example/berlin.mp3',
    url_resolved: 'https://streams.e2e.example/berlin.mp3',
    country: 'Germany',
    countrycode: 'DE',
    tags: 'techno,electronic',
    clickcount: 600,
    geo_lat: 52.52,
    geo_long: 13.405
  }),
  station({
    stationuuid: 'e2e-paris-0005',
    name: 'E2E Paris Chanson',
    url: 'https://streams.e2e.example/paris.mp3',
    url_resolved: 'https://streams.e2e.example/paris.mp3',
    country: 'France',
    countrycode: 'FR',
    tags: 'chanson',
    clickcount: 500,
    geo_lat: 48.8566,
    geo_long: 2.3522
  })
];

// Stations that are NOT part of the initial directory: they only appear once the
// directory-expansion overlay adds their country (JP) to the featured set.
export const EXPANSION_STATIONS = [
  station({
    stationuuid: 'e2e-tokyo-0006',
    name: 'E2E Tokyo FM',
    url: 'https://streams.e2e.example/tokyo.mp3',
    url_resolved: 'https://streams.e2e.example/tokyo.mp3',
    country: 'Japan',
    countrycode: 'JP',
    tags: 'jpop,pop',
    clickcount: 950,
    geo_lat: 35.6762,
    geo_long: 139.6503
  }),
  station({
    stationuuid: 'e2e-rio-0008',
    name: 'E2E Rio Samba',
    url: 'https://streams.e2e.example/rio.mp3',
    url_resolved: 'https://streams.e2e.example/rio.mp3',
    country: 'Brazil',
    countrycode: 'BR',
    tags: 'samba',
    // High click count keeps the card inside the virtualized viewport in e2e runs.
    clickcount: 930,
    geo_lat: -22.9068,
    geo_long: -43.1729
  }),
  station({
    stationuuid: 'e2e-osaka-0007',
    name: 'E2E Osaka Beats',
    url: 'https://streams.e2e.example/osaka.mp3',
    url_resolved: 'https://streams.e2e.example/osaka.mp3',
    country: 'Japan',
    countrycode: 'JP',
    tags: 'electronic',
    clickcount: 400,
    geo_lat: 34.6937,
    geo_long: 135.5023
  })
];

// Radio Browser /json/countries shape used by the expansion overlay's country index.
export const FIXTURE_COUNTRIES = [
  { name: 'The Republic Of Korea', iso_3166_1: 'KR', stationcount: 1 },
  { name: 'The United Kingdom Of Great Britain And Northern Ireland', iso_3166_1: 'GB', stationcount: 1 },
  { name: 'The United States Of America', iso_3166_1: 'US', stationcount: 1 },
  { name: 'Germany', iso_3166_1: 'DE', stationcount: 1 },
  { name: 'France', iso_3166_1: 'FR', stationcount: 1 },
  { name: 'Japan', iso_3166_1: 'JP', stationcount: 2 },
  { name: 'Brazil', iso_3166_1: 'BR', stationcount: 1 }
];
