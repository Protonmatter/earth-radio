import {isIpAddress,isPublicIpAddress} from './public-ip-policy.mjs';
import {COUNTRY_LOCATIONS} from '../site/assets/country-locations.js';
import {catalogText,cleanDirectoryTags,cleanDirectoryLanguages,resolveDirectoryCountries} from '../site/assets/catalog-fields.js';

const sensitiveParameter=/^(?:access_token|refresh_token|api[_-]?key|authorization|auth|password|passwd|secret|token)$/i;
const reservedIds=new Set(['__proto__','prototype','constructor']);
const count=(value,max=1e9)=>Number.isFinite(Number(value))?Math.max(0,Math.min(max,Math.trunc(Number(value)))):0;
function publicUrl(value,{httpsOnly=false}={}){
  const text=catalogText(value,4096);if(!text)return '';
  try{
    const url=new URL(text),hostname=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
    if(!['http:','https:'].includes(url.protocol)||httpsOnly&&url.protocol!=='https:'||url.username||url.password)return '';
    if(hostname==='localhost'||hostname.endsWith('.localhost')||/\.(?:local|internal|home\.arpa)$/.test(hostname))return '';
    if(!isIpAddress(hostname)&&!hostname.includes('.'))return '';
    if(isIpAddress(hostname)&&!isPublicIpAddress(hostname))return '';
    if([...url.searchParams.keys()].some(key=>sensitiveParameter.test(key)))return '';
    url.hash='';return url.href;
  }catch{return '';}
}
function timestamp(value){
  let text=catalogText(value,40);if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text))text=text.replace(' ','T')+'Z';
  if(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(text))text+='Z';
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(text))return '';
  const time=Date.parse(text);return Number.isFinite(time)&&time>=0?new Date(time).toISOString():'';
}
function point(row,code){
  const values=[row.geo_lat,row.geo_long];
  if(values.some(value=>value==null||typeof value==='boolean'||String(value).trim()===''))return null;
  const [lat,lng]=values.map(Number);if(![lat,lng].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lng)>180||lat===0&&lng===0)return null;
  const reference=COUNTRY_LOCATIONS[code];
  if(reference&&!reference.boxes.some(b=>lng>=b[0]/10000-1&&lng<=b[2]/10000+1&&lat>=b[1]/10000-1&&lat<=b[3]/10000+1))return null;
  return[lat,lng];
}

export function normalizeDirectory(input,{maxRecords=75000}={}){
  if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>75000)throw Error('Invalid directory record budget');
  if(!Array.isArray(input)||input.length>maxRecords)throw Error('Directory record limit exceeded');
  const stats={inputRows:input.length,validRows:0,rejectedRows:0,duplicateIds:0,countryInferred:0,unknownCountry:0,httpStreams:0,invalidCoordinates:0};
  const unique=new Map();
  for(const raw of input){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){stats.rejectedRows++;continue;}
    const stationuuid=catalogText(raw.stationuuid),name=catalogText(raw.name),url=publicUrl(raw.url_resolved||raw.url),original=publicUrl(raw.url||raw.url_resolved);
    if(!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(stationuuid)||reservedIds.has(stationuuid)||!name||!url||raw.lastcheckok!==undefined&&Number(raw.lastcheckok)===0){stats.rejectedRows++;continue;}
    const row={stationuuid,name,url:original||url,...(original&&original!==url?{url_resolved:url}:{}),
      homepage:publicUrl(raw.homepage),favicon:publicUrl(raw.favicon,{httpsOnly:true}),
      country:catalogText(raw.country,128),countrycode:catalogText(raw.countrycode,8),state:catalogText(raw.state,128),city:catalogText(raw.city,128),
      tags:cleanDirectoryTags(raw.tagList||raw.tags).join(','),language:cleanDirectoryLanguages(raw.language).join(','),codec:catalogText(raw.codec,24).toUpperCase()||'UNKNOWN',
      bitrate:count(raw.bitrate,1536),clickcount:count(raw.clickcount),votes:count(raw.votes),lastcheckok:Number(raw.lastcheckok)===1?1:0,
      lastchecktime:timestamp(raw.lastchecktime),lastcheckoktime:timestamp(raw.lastcheckoktime),hls:Number(raw.hls)===1?1:0,
      transport:url.startsWith('https:')?'https':'http-only',geo_lat:raw.geo_lat,geo_long:raw.geo_long};
    const old=unique.get(stationuuid);
    if(old){stats.duplicateIds++;if(row.lastchecktime<old.lastchecktime||row.lastchecktime===old.lastchecktime&&JSON.stringify(row)>=JSON.stringify(old))continue;}
    unique.set(stationuuid,row);
  }
  const stations=resolveDirectoryCountries([...unique.values()]).map(row=>{
    if(!row.countrycode)stats.unknownCountry++;
    else if(!['directory-code','unknown'].includes(row.countryProvenance))stats.countryInferred++;
    const position=point(row,row.countrycode);
    if(!position&&row.geo_lat!=null&&row.geo_long!=null)stats.invalidCoordinates++;
    delete row.geo_lat;delete row.geo_long;
    if(position)[row.geo_lat,row.geo_long]=position;
    if(row.transport==='http-only')stats.httpStreams++;
    return Object.fromEntries(Object.entries(row).filter(([key,value])=>value!==''||key==='countrycode'));
  }).sort((a,b)=>b.clickcount-a.clickcount||(a.stationuuid<b.stationuuid?-1:a.stationuuid>b.stationuuid?1:0));
  stats.validRows=stations.length;return{stations,stats};
}
