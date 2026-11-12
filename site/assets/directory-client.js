import {browserDirectoryHosts,directoryJson} from './directory-hosts.js?v=0.34.1';
import {expandVariantGroups} from './station-variants.js?v=0.34.1';
import {SNAPSHOT_ACCEPT} from './snapshot-protocol.js?v=0.34.1';
const countryStatus=new Map();
export const snapshotCountryStatus=code=>countryStatus.get(code);
export function snapshotRows(value,maxRecords=10000){
  if(value?.schemaVersion===2)return expandVariantGroups(value.groups,{maxGroups:maxRecords,maxRecords}).sort((a,b)=>(Number(b.clickcount)||0)-(Number(a.clickcount)||0)||(a.stationuuid<b.stationuuid?-1:a.stationuuid>b.stationuuid?1:0));
  if(!Array.isArray(value)||value.length>maxRecords)throw Error('Invalid snapshot');return value;
}
function stationRecord(row){
  if(!row||typeof row.stationuuid!=='string'||!row.stationuuid.trim()||typeof row.name!=='string'||!row.name.trim())return false;
  try{const url=new URL(row.url_resolved||row.url);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}

export async function loadDirectorySnapshot(config,{fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  const path=config.directorySnapshotUrl;
  if(path!=='/directory/snapshot'||!/^https?:$/.test(globalThis.location?.protocol||''))return null;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  countryStatus.clear();
  try{
    const response=await fetchImpl(path,{signal:controller.signal,credentials:'omit',headers:{Accept:SNAPSHOT_ACCEPT}});
    const rows=snapshotRows(await directoryJson(response));
    if(!Array.isArray(rows)||!rows.length||rows.length>10010||!rows.some(stationRecord))throw Error('Invalid snapshot');
    const extra=[...new Set([...(config.featuredCountryCodes||[]).filter(code=>!['KR','US','GB','NL','FR','DE','CA'].includes(code)),...(config.directoryRequestedCountries||[])])].filter(code=>/^[A-Z]{2}$/.test(code)).slice(-20);
    const stations=[...rows],missing=[],countryLimit=Math.max(25,Math.min(1000,Math.trunc(Number(config.featuredCountryLimit))||150));let cursor=0;
    await Promise.all(Array.from({length:Math.min(2,extra.length)},async()=>{while(cursor<extra.length){const code=extra[cursor++];try{
      const country=snapshotRows(await directoryJson(await fetchImpl('/directory/country/'+code,{signal:controller.signal,credentials:'omit',headers:{Accept:SNAPSHOT_ACCEPT}})),1000);
      if(!Array.isArray(country)||country.length>1010)throw Error('Invalid country snapshot');
      const eligible=country.filter(row=>stationRecord(row)&&String(row.countrycode).toUpperCase()===code);
      if(country.length&&!eligible.length)throw Error('Invalid country snapshot');
      stations.push(...eligible.slice(0,countryLimit));countryStatus.set(code,'loaded');
    }catch{missing.push(code);countryStatus.set(code,'failed');}}}));
    // Merge once after parsing; avoid cloning/stringifying the multi-MB snapshot
    // in the generic fetch overlay. Runtime storage is already hydrated here.
    const {mergePinnedStations}=await import('./pinned-stations.js?v=0.34.1');
    const stale=response.headers.get('x-directory-state')==='stale';
    const generatedAt=response.headers.get('x-directory-generated-at'),producerSourceSha=response.headers.get('x-directory-producer-sha');
    const directorySnapshot=Number.isFinite(Date.parse(generatedAt))&&/^[a-f0-9]{40}$/.test(producerSourceSha||'')?{generatedAt,producerSourceSha}:null;
    return {stations:mergePinnedStations(stations),stale,directorySnapshot,source:missing.length?'directory snapshot (some countries unavailable)':stale?'directory snapshot (refresh pending)':'same-origin directory snapshot'};
  }finally{clearTimeout(timer);}
}
export {browserDirectoryHosts};
