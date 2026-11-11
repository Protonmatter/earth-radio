// A view over stream identities. No UUID, favorite record or account document is
// rewritten by grouping. The same pure model is used by the scheduled producer.
import {fold} from './search-core.js?v=0.32.2';
import {streamIdentity} from './discovery-core.js?v=0.32.2';

const compare=(a,b)=>a<b?-1:a>b?1:0;
const id=value=>typeof value==='string'&&value.trim()&&value.length<=160&&!['__proto__','prototype','constructor'].includes(value)?value.trim():'';
const state=station=>[fold(station.state||''),fold(station.city||'')].join('|').replace(/^\|$|^\||\|$/g,'');
const displayName=name=>String(name||'').trim()
  .replace(/\s*[([]\s*(?:(?:\d{2,4}\s*(?:k(?:b(?:p?s)?)?|kbps))|(?:flac|alac|aac\+?|mp3|ogg|hls)(?:\s*\d{2,4}\s*(?:kbps|k))?)\s*[)\]]\s*$/i,'')
  .replace(/\s*[|·–-]\s*(?:flac|alac|aac\+?|mp3|ogg|hls)(?:\s*\d{2,4}\s*(?:kbps|k))?\s*$/i,'').trim();
export const stationFamilyKey=station=>`${String(station.countrycode||fold(station.country)||'??').toUpperCase()}|${fold(displayName(station.name)).replace(/[^\p{L}\p{N}]/gu,'')}`;
const readable=name=>(/[A-Z]/.test(name)&&/[a-z]/.test(name)?2:/[A-Z]/.test(name)?1:0);
const stamp=station=>{let value=String(station.lastchecktime||station.lastcheckoktime||'');if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value))value=value.replace(' ','T')+'Z';return Date.parse(value)||0;};
const finite=(value,max=1e9)=>Math.max(0,Math.min(max,Number(value)||0));
function quality(station,securePreferred=true){
  return (securePreferred&&/^https:/i.test(station.url_resolved||station.url||'')?1e13:0)+
    (Number(station.lastcheckok)===1?1e11:0)+(/^(flac|alac)$/i.test(station.codec||'')?1e9:0)+
    finite(station.bitrate,1536)*1e5+finite(station.quality?.score,100)*100+Math.log1p(finite(station.clickcount));
}
const order=(a,b,secure=true)=>quality(b,secure)-quality(a,secure)||stamp(b)-stamp(a)||compare(String(a.stationuuid),String(b.stationuuid));

export function groupStationVariants(stations){
  const unique=new Map();
  for(const station of Array.isArray(stations)?stations:[]){
    const uuid=id(station?.stationuuid);if(!uuid||!String(station.name||'').trim()||!streamIdentity(station))continue;
    const old=unique.get(uuid);
    if(!old||stamp(station)>stamp(old)||stamp(station)===stamp(old)&&compare(JSON.stringify(station),JSON.stringify(old))<0)unique.set(uuid,station);
  }
  const familyStreams=new Map();
  for(const station of unique.values()){
    const key=stationFamilyKey(station);if(!familyStreams.has(key))familyStreams.set(key,new Set());familyStreams.get(key).add(streamIdentity(station));
  }
  const technicalAliases=new Map();
  for(const station of unique.values())if(/\s+zstream$/i.test(station.name)){
    const name=displayName(station.name).replace(/\s+zstream$/i,''),key=stationFamilyKey({...station,name});
    if(familyStreams.get(key)?.has(streamIdentity(station)))technicalAliases.set(station.stationuuid,{name,key});
  }
  const families=new Map();
  for(const station of unique.values()){const key=technicalAliases.get(station.stationuuid)?.key||stationFamilyKey(station);if(!families.has(key))families.set(key,[]);families.get(key).push(station);}
  const groups=[];
  for(const [family,rows]of families){
    const regions=[...new Set(rows.map(state).filter(Boolean))].sort(compare),buckets=new Map();
    for(const station of rows){
      const region=regions.length<=1?regions[0]||'':state(station)||'?';
      if(!buckets.has(region))buckets.set(region,[]);buckets.get(region).push(station);
    }
    for(const [region,members]of buckets){
      const streams=new Map();
      for(const station of members){const url=streamIdentity(station);if(!streams.has(url))streams.set(url,[]);streams.get(url).push(station);}
      const variants=[...streams].map(([url,records])=>{
        const ids=records.map(row=>row.stationuuid).sort(compare),best=[...records].sort(order)[0];
        return{url,ids,station:{...best,stationuuid:ids[0]}};
      }).sort((a,b)=>order(a.station,b.station)||compare(a.url,b.url));
      const names=[...new Set(members.map(row=>technicalAliases.get(row.stationuuid)?.name||displayName(row.name)))].sort((a,b)=>readable(b)-readable(a)||compare(a,b));
      const tags=[...new Set(members.flatMap(row=>Array.isArray(row.tagList)?row.tagList:String(row.tags||'').split(',')).map(value=>String(value).trim()).filter(Boolean))].sort(compare).slice(0,24);
      const language=[...new Set(members.flatMap(row=>String(row.language||'').split(',')).map(value=>value.trim()).filter(Boolean))].sort(compare).slice(0,12).join(',');
      groups.push({key:`${family}|${region}`,name:names[0],station:{...variants[0].station,name:names[0],tags:tags.join(','),tagList:tags,language},variants,memberIds:members.map(row=>row.stationuuid).sort(compare)});
    }
  }
  return groups.sort((a,b)=>compare(a.key,b.key));
}

export function chooseGroupStation(group,{selectedId='',currentId='',favoriteIds=new Set(),securePreferred=true}={}){
  if(!group?.variants?.length)return null;
  for(const wanted of [selectedId,currentId,...group.memberIds.filter(uuid=>favoriteIds.has(uuid))]){
    const variant=group.variants.find(item=>item.ids.includes(wanted));
    if(variant)return{...variant.station,stationuuid:wanted,name:group.name};
  }
  const variant=[...group.variants].sort((a,b)=>order(a.station,b.station,securePreferred)||compare(a.url,b.url))[0];
  return{...variant.station,stationuuid:variant.ids.includes(variant.station.stationuuid)?variant.station.stationuuid:variant.ids[0],name:group.name};
}

export function expandFavoriteIds(groups,favorites){
  const expanded=new Set(favorites);
  for(const group of groups)if(group.memberIds.some(uuid=>favorites.has(uuid)))for(const uuid of group.memberIds)expanded.add(uuid);
  return expanded;
}

export function projectVariantResults(entries,groups,options={}){
  const byId=new Map();for(const group of groups)for(const uuid of group.memberIds)byId.set(uuid,group);
  const matching=new Set(entries.map(entry=>entry.station.stationuuid)),seen=new Set(),result=[];
  for(const entry of entries){
    const full=byId.get(entry.station.stationuuid)||groupStationVariants([entry.station])[0];if(!full||seen.has(full.key))continue;seen.add(full.key);
    const variants=full.variants.filter(variant=>variant.ids.some(uuid=>matching.has(uuid))).map(variant=>({...variant,ids:variant.ids.filter(uuid=>matching.has(uuid))}));
    const group={...full,variants};
    const station=chooseGroupStation(group,{...options,selectedId:options.selections?.get(full.key)||options.selectedId});
    result.push({...entry,station,groupKey:full.key,variants,group:full});
  }
  return result;
}

const sharedFields=['name','country','countrycode','state','city','tags','language','homepage','favicon','countryProvenance'];
const streamFields=['url','url_resolved','codec','bitrate','clickcount','votes','lastcheckok','lastchecktime','lastcheckoktime','hls','geo_lat','geo_long','transport'];
const pick=(record,fields)=>Object.fromEntries(fields.filter(key=>record[key]!==undefined&&record[key]!==null&&record[key]!=='').map(key=>[key,record[key]]));
export function serializeVariantGroups(stations){
  return groupStationVariants(stations).map(group=>({key:group.key,...pick(group.station,sharedFields),name:group.name,
    variants:group.variants.map(variant=>({stationuuid:variant.ids[0],...pick(variant.station,streamFields),...(variant.ids.length>1?{aliases:variant.ids.slice(1)}:{})}))}));
}

export function expandVariantGroups(groups,{maxGroups=10000,maxRecords=10000}={}){
  if(!Array.isArray(groups)||groups.length>maxGroups)throw Error('Invalid station groups');
  const records=[],seen=new Set();
  for(const group of groups){
    if(!group||typeof group.name!=='string'||!group.name.trim()||!Array.isArray(group.variants)||!group.variants.length)throw Error('Invalid station group');
    const shared=pick(group,sharedFields);
    for(const variant of group.variants){
      if(!variant||!streamIdentity(variant)||variant.aliases!==undefined&&!Array.isArray(variant.aliases))throw Error('Invalid station stream');
      for(const uuid of [variant.stationuuid,...variant.aliases||[]]){
        if(!id(uuid)||id(uuid)!==uuid||seen.has(uuid)||records.length>=maxRecords)throw Error('Duplicate or excessive stream identity');
        seen.add(uuid);records.push({...shared,...pick(variant,streamFields),stationuuid:uuid});
      }
    }
  }
  return records;
}
