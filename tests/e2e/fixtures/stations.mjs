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
