// Maintained, pure discovery algorithms. Scores are engineering heuristics, not
// calibrated probabilities of stream uptime. No network, storage, or browser globals.
import {fold,canonicalGenre,canonicalLanguage,countryWords,genreWords,languageWords,closeWord,searchTerms,facetLabel,isPlaceTerm,isGenreTerm,correctGenre} from './search-core.js?v=0.32.2';
export {fold} from './search-core.js?v=0.32.2';
import {stationLocation} from './station-location.js?v=0.32.2';
const SORTS = new Set(['best', 'reliable', 'explore', 'bitrate', 'name', 'similar']);
const COOLDOWN_MS = 15 * 60 * 1000;
const clamp = (value, max = 100) => Math.min(max, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
const parts = value => [...new Set(String(value ?? '').split(/[,;]+/).map(fold).filter(Boolean))];
const tags = station => [...new Set(parts((Array.isArray(station.tagList) ? station.tagList : String(station.tags ?? '').split(',')).join(',')).map(canonicalGenre))];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const stable = (a, b) => compare(fold(a.name), fold(b.name)) || compare(String(a.stationuuid), String(b.stationuuid));

export function sanitizePreferences(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    query: String(input.query ?? '').slice(0, 160), sort: SORTS.has(input.sort) ? input.sort : 'best',
    genre: String(input.genre ?? '').slice(0, 64), language: String(input.language ?? '').slice(0, 64),
    minBitrate: clamp(input.minBitrate, 1536), secureOnly: input.secureOnly === true, avoidFailures: input.avoidFailures === true
  };
}

export function streamIdentity(station) {
  try {
    const url = new URL(station?.url_resolved || station?.url || '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function coordinates(station) {
  const raw = [station?.geo_lat, station?.geo_long];
  if (raw.some(v => v == null || typeof v === 'boolean' || String(v).trim() === '')) return null;
  const [lat, lng] = raw.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return [lat, lng];
}

export function distanceKm(a, b) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function inBounds(station, bounds) {
  const location=stationLocation(station),point=location&&!location.approximate?location.point:null;
  if (!point || !bounds) return false;
  const { south, north, west, east } = bounds;
  if (![south, north, west, east].every(Number.isFinite) || south > north || point[0] < south || point[0] > north) return false;
  if (Math.abs(east - west) >= 360) return true;
  const wrap = n => ((n + 180) % 360 + 360) % 360 - 180;
  const left = wrap(west), right = wrap(east), lng = wrap(point[1]);
  return left <= right ? lng >= left && lng <= right : lng >= left || lng <= right;
}

function overlap(a, b) {
  const left = new Set(a), right = new Set(b);
  const shared = [...left].filter(tag => right.has(tag)).length;
  return shared / (new Set([...left, ...right]).size || 1);
}

function failureState(station, options) {
  const failure = options.badStations?.get?.(station.stationuuid);
  const date = Date.parse(failure?.lastFailureAt ?? '');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const age = now - date;
  const active = clamp(failure?.failures) > 0 && Number.isFinite(date) && age >= 0 && age < COOLDOWN_MS;
  const health = options.health?.get?.(station.stationuuid);
  const successes = clamp(health?.successes, 1000), failures = clamp(health?.failures, 1000);
  // Beta(2,1) prior; small samples never imply certainty. Counts are per tab only.
  return { active, estimate: (successes + 2) / (successes + failures + 3), observed: successes + failures > 0 };
}

const documents=new WeakMap();
function documentFor(station) {
  const signature=JSON.stringify([station.name,station.country,station.countrycode,station.state,station.city,station.tags,station.tagList,station.language,station.codec,station.bitrate]);
  const previous=documents.get(station);if(previous?.signature===signature)return previous.doc;
  const fields=[fold(station.name),fold(`${countryWords(station)} ${station.state??''} ${station.city??''}`),fold(tags(station).map(genreWords).join(' ')),fold(parts(station.language).map(languageWords).join(' ')),fold(`${station.codec??''} ${station.bitrate??''}`)];
  const words=fields.map(field=>field.split(' ').filter(Boolean));
  const doc={fields,words,length:words.reduce((sum,field)=>sum+field.length,0)};
  documents.set(station,{signature,doc});return doc;
}

function termMatch(doc,term,fuzzy=false){
  if(doc.words[0].includes(term))return 0;
  if(doc.words[0].some(word=>word.startsWith(term)))return 1;
  if(doc.words.slice(1).some(words=>words.includes(term)))return 2;
  if(term.length>=3&&doc.fields.some(field=>field.includes(term)))return 3;
  return fuzzy&&!isPlaceTerm(term)&&doc.words.some(words=>words.slice(0,40).some(word=>closeWord(term,word)))?4:Infinity;
}
function termFrequency(doc, term, fuzzy=false) {
  const weights = [6, 3, 4, 2, 1];
  return doc.fields.reduce((sum, field, index) => {
    if (doc.words[index].some(word => word.startsWith(term) || (term.length >= 3 && word.includes(term)))) return sum + weights[index];
    return sum + (fuzzy&&!isPlaceTerm(term)&&doc.words[index].slice(0, 40).some(word => closeWord(term, word)) ? weights[index] * 0.4 : 0);
  }, 0);
}

/** Field-weighted BM25 + explicit quality/health signals. Every query term must match. */
export function rankStations(stations, options = {}) {
  const prefs = sanitizePreferences(options);
  let terms = searchTerms(prefs.query,options.locale);
  const genre = canonicalGenre(prefs.genre), language = canonicalLanguage(prefs.language);
  const rows = [],genreTerms=new Set();
  const targetTags = options.current ? tags(options.current) : [];
  for (const station of Array.isArray(stations) ? stations : []) {
    if (!station || typeof station.stationuuid !== 'string' || !station.stationuuid || !streamIdentity(station)) continue;
    const endpoint = streamIdentity(station), failure = failureState(station, options), stationTags = tags(station);
    for(const tag of stationTags)for(const word of [tag,...tag.split(' ')])genreTerms.add(word);
    if ((prefs.secureOnly && !endpoint.startsWith('https:')) || (prefs.avoidFailures && failure.active) ||
      (prefs.minBitrate && clamp(station.bitrate, 1536) < prefs.minBitrate) ||
      (genre && !stationTags.includes(genre)) || (language && !parts(station.language).map(canonicalLanguage).includes(language)) ||
      (options.bounds && !inBounds(station, options.bounds))) continue;
    const doc = documentFor(station);
    const similarity = options.current ? overlap(targetTags, stationTags) : 0;
    if (prefs.sort === 'similar' && options.current && (station.stationuuid === options.current.stationuuid ||
      endpoint === streamIdentity(options.current) || (targetTags.length > 0 && similarity === 0))) continue;
    rows.push({ station, doc, failure, similarity, endpoint });
  }
  let correction='',fuzzy=false;
  const protectedTerm=term=>isPlaceTerm(term)||isGenreTerm(term)||genreTerms.has(term);
  const matches=(row,words,allowFuzzy=false)=>words.every(term=>Number.isFinite(termMatch(row.doc,term,allowFuzzy)));
  if(terms.length&&!rows.some(row=>matches(row,terms))){
    const genres=[...new Set(rows.flatMap(row=>tags(row.station)))];
    const corrected=terms.map(term=>protectedTerm(term)?term:correctGenre(term,genres)||term);
    if(corrected.some((term,index)=>term!==terms[index])&&rows.some(row=>matches(row,corrected))){terms=corrected;correction=terms.join(' ');}
    else fuzzy=true;
  }
  const fuzzyTerms=terms.map(term=>fuzzy&&!protectedTerm(term));
  for(const row of rows){row.tf=terms.map((term,index)=>termFrequency(row.doc,term,fuzzyTerms[index]));row.tiers=terms.map((term,index)=>termMatch(row.doc,term,fuzzyTerms[index]));}
  const avgLength = rows.reduce((sum, row) => sum + row.doc.length, 0) / (rows.length || 1);
  const idf = terms.map((_, index) => Math.log(1 + (rows.length - rows.filter(row => row.tf[index] > 0).length + 0.5) / (rows.filter(row => row.tf[index] > 0).length + 0.5)));
  const entries = rows.filter(row => row.tiers.every(Number.isFinite)).map(({ station, doc, tf, tiers, failure, similarity, endpoint }) => {
    const quality = clamp(station.quality?.score), reasons = [];
    let score = quality * 0.55 + failure.estimate * 18;
    score+=Math.min(12,Math.log1p(clamp(station.clickcount,1e9)));
    if (quality >= 70) reasons.push(`Directory quality ${Math.round(quality)}/100`);
    if (endpoint.startsWith('https:')) { score += 8; reasons.push('HTTPS stream'); }
    if (station.lastcheckok === true || station.lastcheckok === 1) { score += 5; reasons.push('Last directory check passed'); }
    if (failure.active) { score -= 65; reasons.push('Playback failed recently on this device'); }
    if (failure.observed) reasons.push('Includes playback outcomes from this tab');
    if (terms.length) {
      score += tf.reduce((sum, freq, i) => sum + 18 * idf[i] * freq * 2.2 / (freq + 1.2 * (0.25 + 0.75 * doc.length / avgLength)), 0);
      if (doc.fields[0] === fold(prefs.query)) score += 35;
      else if (doc.fields[0].includes(fold(prefs.query))) score += 18;
      reasons.unshift('Matches all search terms');
    }
    if (prefs.sort === 'reliable') score += failure.estimate * 20 + quality * 0.2;
    if (prefs.sort === 'similar') { score += similarity * 65; reasons.unshift(`${Math.round(similarity * 100)}% genre overlap`); }
    if (prefs.sort === 'bitrate') reasons.unshift(`${Math.round(clamp(station.bitrate, 1536))} kbps declared bitrate`);
    if (!reasons.length) reasons.push('Limited directory metadata');
    return { station, score: Math.round(score * 100) / 100, reasons, matchTier:Math.max(0,...tiers),matchTotal:tiers.reduce((sum,tier)=>sum+tier,0),...(correction?{correction}:{}) };
  });
  entries.sort((a, b) => {
    if (prefs.sort === 'name') return stable(a.station, b.station);
    if (prefs.sort === 'bitrate') return clamp(b.station.bitrate, 1536) - clamp(a.station.bitrate, 1536) || b.score - a.score || stable(a.station, b.station);
    if(prefs.sort==='best'&&terms.length){const exactA=fold(a.station.name)===fold(prefs.query),exactB=fold(b.station.name)===fold(prefs.query);if(exactA!==exactB)return exactA?-1:1;
      if(a.matchTier!==b.matchTier)return a.matchTier-b.matchTier;if(a.matchTotal!==b.matchTotal)return a.matchTotal-b.matchTotal;}
    return b.score - a.score || stable(a.station, b.station);
  });
  if ((prefs.sort !== 'explore' && !(prefs.sort==='best'&&!terms.length)) || entries.length < 2) return entries;
  // Greedy maximal marginal relevance on at most 120 candidates; the remainder
  // retain their stable base order. Avoid quadratic work over the full catalog.
  const candidates=[],candidateIds=new Set(),countries=new Set();
  const add=entry=>{if(!candidateIds.has(entry.station.stationuuid)){candidates.push(entry);candidateIds.add(entry.station.stationuuid);}};
  // Seed country representatives from the entire catalog before filling the
  // bounded MMR pool. A large same-network block cannot crowd every country out.
  for(const entry of entries){const code=entry.station.countrycode;if(code&&!countries.has(code)){countries.add(code);add(entry);if(countries.size>=60)break;}}
  for(const entry of entries){if(candidates.length>=120)break;add(entry);}
  const pool = candidates.map(entry => ({ entry, genres: tags(entry.station), redundancy: 0 })), selected = [];
  while (pool.length) {
    let best = 0, bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const value = pool[i].entry.score / 100 - pool[i].redundancy;
      if (value > bestValue) { bestValue = value; best = i; }
    }
    const [chosen] = pool.splice(best, 1);
    for (const item of pool) {
      const sameCountry=item.entry.station.countrycode&&item.entry.station.countrycode===chosen.entry.station.countrycode;
      const sameFamily=fold(item.entry.station.name).split(' ').slice(0,2).join(' ')===fold(chosen.entry.station.name).split(' ').slice(0,2).join(' ');
      item.redundancy = Math.max(item.redundancy, overlap(item.genres, chosen.genres) * 0.1 + (sameCountry?0.24:0)+(sameFamily?0.65:0));
    }
    selected.push({ ...chosen.entry, reasons: [...chosen.entry.reasons, 'Balanced for genre and country variety'] });
  }
  return [...selected, ...entries.filter(entry=>!candidateIds.has(entry.station.stationuuid))];
}

export function buildFacetOptions(stations,field){
  if(!['genre','language'].includes(field))throw new TypeError('Unknown station facet');
  const counts=new Map();
  for(const station of Array.isArray(stations)?stations:[]){
    if(!station||!streamIdentity(station))continue;
    const values=field==='genre'?tags(station):parts(station.language).map(canonicalLanguage);
    for(const value of new Set(values))if(value&&value.length<=64&&!(field==='genre'&&['radio','music','estacion','online','various'].includes(value)))counts.set(value,(counts.get(value)||0)+1);
  }
  return [...counts].map(([value,count])=>({value,label:facetLabel(value,field),count})).sort((a,b)=>b.count-a.count||compare(a.value,b.value));
}

export function rankSimilar(target, stations, limit = 12, options = {}) {
  if (!target) return [];
  const endpoints = new Set([streamIdentity(target)]);
  return rankStations(stations, { ...options, sort: 'similar', current: target, avoidFailures: true }).filter(entry => {
    const url = streamIdentity(entry.station);
    if (endpoints.has(url)) return false;
    endpoints.add(url);
    return true;
  }).slice(0, clamp(limit, 100)).map(entry => entry.station);
}

export function pickStation(stations, options = {}, random = Math.random) {
  const endpoints = new Set([streamIdentity(options.current)]);
  const entries = rankStations(stations, { ...options, sort: 'explore', avoidFailures: true }).filter(entry => {
    const url = streamIdentity(entry.station);
    if (entry.station.stationuuid === options.current?.stationuuid || endpoints.has(url)) return false;
    endpoints.add(url); return true;
  }).slice(0, 80);
  if (!entries.length) return null;
  const counts = new Map();
  for (const { station } of entries) counts.set(station.countrycode, (counts.get(station.countrycode) ?? 0) + 1);
  const weights = entries.map(entry => Math.max(1, entry.score) / Math.sqrt(counts.get(entry.station.countrycode)));
  const value = Number(random());
  let threshold = Math.min(0.999999999, Math.max(0, Number.isFinite(value) ? value : 0)) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < entries.length; i++) { threshold -= weights[i]; if (threshold < 0) return entries[i].station; }
  return entries.at(-1).station;
}
