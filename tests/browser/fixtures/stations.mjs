// Deterministic offline station fixtures for rendered browser regressions.
//
// The rendered harness intercepts every https request, so these records stand in for the
// live Radio Browser directory. Names deliberately cover Latin, Arabic, Korean, Simplified
// Chinese, Traditional Chinese, and mixed-script values so localization and bidi rendering
// are exercised by real layout rather than by source-string presence.

const SEED = [
  ['Atlas Editorial FM', 'The United States Of America', 'US', 'MP3', 320, 'jazz,editorial', 40.71, -74.01],
  ['Cartographer Radio', 'The United States Of America', 'US', 'AAC', 128, 'news,talk', 37.77, -122.42],
  ['Meridian Classical', 'The United Kingdom', 'GB', 'MP3', 192, 'classical', 51.51, -0.13],
  ['Radio Paper Trail', 'Canada', 'CA', 'MP3', 128, 'chill,lounge', 43.65, -79.38],
  ['Coral Coast Sessions', 'Australia', 'AU', 'AAC', 96, 'electronic', -33.87, 151.21],
  ['Radio Compás', 'Spain', 'ES', 'MP3', 192, 'flamenco,latin', 40.42, -3.7],
  ['Emisora del Sur', 'Argentina', 'AR', 'MP3', 128, 'tango,latin', -34.6, -58.38],
  ['Radio Bitácora', 'Mexico', 'MX', 'AAC', 64, 'news', 19.43, -99.13],
  ['إذاعة الأطلس', 'Morocco', 'MA', 'MP3', 128, 'world,talk', 33.97, -6.85],
  ['راديو الخليج الحي', 'Egypt', 'EG', 'AAC', 96, 'news', 30.04, 31.24],
  ['إذاعة القمر الفضية', 'Jordan', 'JO', 'MP3', 64, 'music', 31.95, 35.93],
  ['서울 라디오 아틀라스', 'The Republic Of Korea', 'KR', 'AAC', 192, 'kpop,city', 37.57, 126.98],
  ['한강 야간 방송', 'The Republic Of Korea', 'KR', 'MP3', 128, 'chill', 37.53, 126.97],
  ['부산 해변 FM', 'The Republic Of Korea', 'KR', 'MP3', 96, 'pop', 35.18, 129.08],
  ['北京晨间广播', 'China', 'CN', 'MP3', 128, 'news,talk', 39.9, 116.4],
  ['上海爵士频道', 'China', 'CN', 'AAC', 192, 'jazz', 31.23, 121.47],
  ['成都民谣电台', 'China', 'CN', 'MP3', 96, 'folk', 30.57, 104.07],
  ['臺北古典之聲', 'Taiwan', 'TW', 'AAC', 192, 'classical', 25.03, 121.57],
  ['高雄港邊電台', 'Taiwan', 'TW', 'MP3', 128, 'pop', 22.63, 120.3],
  ['香港夜行頻道', 'Hong Kong', 'HK', 'MP3', 128, 'chill,night', 22.32, 114.17],
  ['Radio Nordlicht', 'Germany', 'DE', 'MP3', 320, 'electronic', 52.52, 13.41],
  ['Rundfunk Papier', 'Germany', 'DE', 'AAC', 128, 'talk', 48.14, 11.58],
  ['Radio Estuaire', 'France', 'FR', 'AAC', 128, 'généraliste', 48.86, 2.35],
  ['Onde Marine', 'France', 'FR', 'MP3', 96, 'chill', 43.3, 5.37],
  ['Radio Polder', 'The Netherlands', 'NL', 'MP3', 192, 'dance', 52.37, 4.9],
  ['Nordvest Radio', 'Norway', 'NO', 'AAC', 128, 'rock', 59.91, 10.75],
  ['Rádio Litoral', 'Brazil', 'BR', 'MP3', 128, 'samba,latin', -23.55, -46.63],
  ['Radio Ostinato', 'Italy', 'IT', 'MP3', 192, 'classical', 41.9, 12.5],
  ['Radio Meseta', 'Portugal', 'PT', 'AAC', 96, 'folk', 38.72, -9.14],
  ['Aurora Talk Radio', 'Iceland', 'IS', 'MP3', 64, 'talk,news', 64.15, -21.94],
  ['Sahara Wave · موجة', 'Algeria', 'DZ', 'MP3', 96, 'world', 36.75, 3.06],
  ['Tokyo Paper Radio 東京', 'Japan', 'JP', 'AAC', 192, 'city,pop', 35.68, 139.69],
  ['Delhi Longwave', 'India', 'IN', 'MP3', 128, 'world', 28.61, 77.21],
  ['Nairobi Green Line', 'Kenya', 'KE', 'MP3', 96, 'afrobeat', -1.29, 36.82],
  ['Cape Meridian FM', 'South Africa', 'ZA', 'AAC', 128, 'jazz', -33.92, 18.42],
  ['Andes Alta Radio', 'Peru', 'PE', 'MP3', 64, 'folk', -12.05, -77.04],
  ['Baltic Signal', 'Poland', 'PL', 'MP3', 128, 'rock', 52.23, 21.01],
  ['Radio Karpaty', 'Ukraine', 'UA', 'AAC', 96, 'folk', 50.45, 30.52],
  ['Aegean Blue Radio', 'Greece', 'GR', 'MP3', 128, 'chill', 37.98, 23.73],
  ['Anatolia Night', 'Turkey', 'TR', 'AAC', 128, 'pop', 41.01, 28.98],
  ['Helsinki Study Loop', 'Finland', 'FI', 'MP3', 192, 'focus,lofi', 60.17, 24.94],
  ['Stockholm Slow Radio', 'Sweden', 'SE', 'AAC', 128, 'ambient', 59.33, 18.07],
  ['Dublin Harbour Radio', 'Ireland', 'IE', 'MP3', 128, 'talk', 53.35, -6.26],
  ['Praha Vinyl', 'Czechia', 'CZ', 'MP3', 320, '1970,vinyl', 50.08, 14.44],
  ['Wien Kammerton', 'Austria', 'AT', 'AAC', 192, 'classical', 48.21, 16.37],
  ['Zurich Quiet Hours', 'Switzerland', 'CH', 'MP3', 128, 'ambient', 47.38, 8.54],
  ['Reykjavik Deep Cuts', 'Iceland', 'IS', 'AAC', 96, 'electronic', 64.13, -21.9],
  ['Singapore Harbour Mix', 'Singapore', 'SG', 'MP3', 128, 'pop,city', 1.35, 103.82]
];

function uuid(index) {
  const hex = (index + 1).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

export function fixtureStations() {
  return SEED.map(([name, country, countrycode, codec, bitrate, tags, lat, lon], index) => {
    const secure = index % 5 !== 4;
    const scheme = secure ? 'https' : 'http';
    const host = `stream${index + 1}.example.invalid`;
    return {
      changeuuid: uuid(index),
      stationuuid: uuid(index),
      name,
      url: `${scheme}://${host}/live`,
      url_resolved: `${scheme}://${host}/live`,
      homepage: `https://${host}/`,
      favicon: '',
      tags,
      country,
      countrycode,
      state: '',
      language: '',
      languagecodes: '',
      votes: 5000 - index * 37,
      lastchangetime_iso8601: '2026-08-01T00:00:00Z',
      codec,
      bitrate,
      hls: 0,
      lastcheckok: index % 11 === 10 ? 0 : 1,
      lastchecktime_iso8601: '2026-08-21T00:00:00Z',
      lastcheckoktime_iso8601: '2026-08-21T00:00:00Z',
      clickcount: 4000 - index * 31,
      clicktrend: 0,
      geo_lat: lat,
      geo_long: lon,
      has_extended_info: false
    };
  });
}

export const FIXTURE_STATION_COUNT = SEED.length;
