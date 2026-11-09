// Pure metadata cleanup, shared by publication and client fallback. URL egress
// policy remains in the existing server boundary; this module performs no I/O.
import {countryCode,displayCountry,canonicalGenre,canonicalLanguage,fold} from './search-core.js?v=0.32.1';

const excludedRegions=new Set(['ZZ','XX','EU','UN','QO','XA','XB','AC','CP','DG','EA','IC','TA']);
const noise=new Set(['radio','music','estacion','station','online','various','unknown','undefined']);
export const catalogText=(value,limit=160)=>typeof value==='string'?value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit):'';
const code=value=>{const resolved=countryCode(catalogText(value));return resolved&&!excludedRegions.has(resolved)?resolved:'';};
const host=value=>{try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}};
const stream=value=>{try{const url=new URL(value);url.hash='';return url.href;}catch{return '';}};
// A country-owned provider hostname can corroborate a same-name sibling. Shared
// generic domains and unrelated ccTLD hosts cannot establish a station's country.
const countryHost=(value,country)=>{
  const parts=host(value).replace(/\.$/,'').split('.'),region=code(parts.at(-1));
  if(!region||region!==country||parts.length<2)return '';
  const count=/^(?:co|com|net|org|ac|gov)$/.test(parts.at(-2))?3:2;
  return parts.length>=count?parts.slice(-count).join('.'):'';
};
const family=row=>fold(row.name).replace(/[^\p{L}\p{N}]/gu,'');
const add=(map,key,value)=>{if(!key)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(value);};
const names=new Map();

export function cleanDirectoryTags(value){
  const parts=Array.isArray(value)?value:String(value||'').split(/[,;]/);
  return [...new Set(parts.map(part=>canonicalGenre(catalogText(part,64))).filter(tag=>tag&&!noise.has(tag)&&tag.length<=48))].sort().slice(0,24);
}
export function cleanDirectoryLanguages(value){
  return [...new Set(String(value||'').split(/[,;]/).map(part=>canonicalLanguage(catalogText(part,64))).filter(part=>part&&!noise.has(part)))].sort().slice(0,12);
}

export function resolveDirectoryCountries(rows){
  const direct=rows.map(row=>{const byCode=code(row.countrycode),byName=code(row.country);return{code:byCode||byName,provenance:byCode?'directory-code':byName?'directory-name':'unknown'};});
  const streams=new Map(),homeFamilies=new Map(),countryProviders=new Map();
  for(let index=0;index<rows.length;index++)if(direct[index].code){
    const row=rows[index],resolved=direct[index].code;
    add(streams,stream(row.url_resolved||row.url),resolved);
    const homepage=host(row.homepage);if(homepage)add(homeFamilies,`${family(row)}|${homepage}`,resolved);
    for(const value of [row.homepage,row.url_resolved||row.url]){
      const owner=countryHost(value,resolved);if(owner)add(countryProviders,`${family(row)}|${owner}`,resolved);
    }
  }
  return rows.map((row,index)=>{
    let {code:resolved,provenance}=direct[index];
    if(!resolved){
      const byStream=streams.get(stream(row.url_resolved||row.url)),homepage=host(row.homepage),byHome=homepage?homeFamilies.get(`${family(row)}|${homepage}`):null;
      const providerEvidence=[];
      for(const value of [row.homepage,row.url_resolved||row.url]){
        const owner=countryHost(value,code(host(value).split('.').at(-1)));
        if(owner)providerEvidence.push(...countryProviders.get(`${family(row)}|${owner}`)||[]);
      }
      const evidence=new Set([...(byStream||[]),...(byHome||[]),...providerEvidence]);
      if(evidence.size===1){resolved=[...evidence][0];provenance=byStream?.size===1?'stream-agreement':byHome?.size===1?'name-homepage-agreement':'name-country-provider-agreement';}
    }
    if(resolved&&!names.has(resolved))names.set(resolved,displayCountry({countrycode:resolved},'en'));
    return {...row,countrycode:resolved,country:resolved?names.get(resolved):'Unknown',countryProvenance:provenance};
  });
}
