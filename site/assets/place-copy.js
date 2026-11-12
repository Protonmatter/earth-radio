// Presentation over the existing conservative model. No implicit clock, I/O,
// storage, identity rewriting or source-data mutation.
import {stationPlace,formatPlaceTime} from './place-core.js?v=0.36.0';
import {nativeProgramSupport} from './program-components.js?v=0.36.0';
import {countryCode,displayCountry,canonicalGenre,facetLabel} from './search-core.js?v=0.36.0';
import {normalizeLocale,t} from '../i18n/index.js?v=0.36.0';

const smallText=(value,limit)=>typeof value==='string'&&value.length<=limit?value.trim().replaceAll('\r',' ').replaceAll('\n',' ').replaceAll('\t',' '):'';
const genericTags=new Set(['radio','music','musica','estacion','station','general','misc']);
function firstGenre(station){
 const values=Array.isArray(station.tagList)?station.tagList.slice(0,24):smallText(station.tags,512).split(/[,;]/,24);
 for(const value of values){
  const raw=smallText(value,64);
  if(!/^[\p{L}\p{N}][\p{L}\p{N}\s&+/'’.-]{0,63}$/u.test(raw))continue;
  const canonical=canonicalGenre(raw);
  if(canonical&&!genericTags.has(canonical))return facetLabel(canonical,'genre');
 }
 return'';
}

export function stationFacts(station,{locale='en',now}={}){
 const record=station&&typeof station==='object'&&!Array.isArray(station)?station:{};
 locale=normalizeLocale(typeof locale==='string'?locale:'en');
 const location=stationPlace(record),suppliedCountry=smallText(record.country,512);
 const rawCountry=/^(?:unknown|unknown country|country unknown)$/i.test(suppliedCountry)?'':suppliedCountry;
 const code=location?.countrycode||countryCode(smallText(record.countrycode,2))||countryCode(rawCountry);
 const country=smallText(displayCountry({countrycode:code,country:rawCountry},locale),512)||t('place.unknownCountry',{},locale);
 const support=nativeProgramSupport(record);
 const city=location?.confidence==='city'&&(support===undefined||support&&support.cityId===location.cityId)?location:null;
 if(!city)return{place:country,genre:'',time:'',text:country,cityId:null};
 const place=t('place.cityCountry',{city:city.city,country},locale),genre=firstGenre(record),time=formatPlaceTime(city,now,locale)||'';
 return{place,genre,time,text:[place,genre,time].filter(Boolean).join(' · '),cityId:city.cityId};
}
