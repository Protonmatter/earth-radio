// Pure search vocabulary and bounded suggestions; no storage, network or browser state.
import {PLACE_TERMS} from './place-vocabulary.js?v=0.33.0';
export const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const compare=(a,b)=>a<b?-1:a>b?1:0;
const genreGroups={
  'hip hop':['hiphop','hip-hop'],lofi:['lo-fi','lo fi','lowfi'], 'r b':['rnb','r&b','rhythm and blues'],
  'drum and bass':['dnb','drum bass'],jazz:['재즈','爵士','جاز'],classical:['clásica','clasica','클래식','古典','كلاسيكي'],
  news:['noticias','뉴스','新闻','新聞','أخبار'],rock:['록','摇滚','搖滾'],pop:['팝','流行','pop music'],
  '80s':['80 s',"80's"], '90s':['90 s',"90's"], '70s':['70 s',"70's"]
};
for(const genre of ['ambient','electronic','trance','techno','dance','soul','funk','metal','reggae','country','folk','blues','house','disco','talk','chill','chillout','lounge','oldies','latin','salsa'])genreGroups[genre]||=[];
const languageGroups={
  english:['en','eng','英語','英语','영어'],spanish:['es','spa','espanol','español','스페인어','西班牙语','西班牙語'],
  french:['fr','fra','fre','francais','français'],german:['de','deu','ger','deutsch'],japanese:['ja','jpn','日本語','일본어'],
  korean:['ko','kor','한국어','한국','韓国語'],chinese:['zh','zho','chi','中文','汉语','漢語'],
  arabic:['ar','ara','العربية'],portuguese:['pt','por','portugues','português'],italian:['it','ita','italiano'],
  russian:['ru','rus','русский'],dutch:['nl','nld','dut','nederlands'],hindi:['hi','hin'],turkish:['tr','tur','turkce','türkçe']
};
const countryGroups={
  KR:['South Korea','The Republic Of Korea','Republic of Korea','Korea','대한민국','한국'],KP:['North Korea','DPRK'],
  US:['United States','United States Of America','The United States Of America','USA','America'],
  GB:['United Kingdom','The United Kingdom','United Kingdom of Great Britain and Northern Ireland','The United Kingdom Of Great Britain And Northern Ireland','UK','Britain'],
  JP:['Japan','日本','일본'],FR:['France','Francia'],DE:['Germany','Deutschland','Alemania'],ES:['Spain','España'],
  BR:['Brazil','Brasil'],CA:['Canada'],AU:['Australia'],NZ:['New Zealand'],MX:['Mexico','México'],IN:['India'],
  CZ:['Czechia','Czech Republic'],TR:['Turkey','Türkiye'],RU:['Russia','Russian Federation'],
  AE:['United Arab Emirates','UAE'],CN:['China',"People's Republic of China",'中国','中國'],TW:['Taiwan','Taiwan, Republic Of China','台灣','台湾'],
  NL:['Netherlands','The Netherlands'],PH:['Philippines','The Philippines']
};
// Generate vocabulary from the browser's CLDR data in every supported UI locale.
// Keep explicit directory/colloquial aliases and exclude retired region aliases.
const locales=['en','es','ar','ko','zh-Hans','zh-Hant'];
const retired=new Set(['AN','BU','CS','DD','FX','NH','NT','RH','SU','TP','UK','VD','YD','YU','ZR']);
for(const type of ['region','language']){
  try{
    const names=locales.map(locale=>new Intl.DisplayNames([locale],{type,fallback:'none'}));
    for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
      const code=String.fromCharCode(a,b),key=type==='region'?code:code.toLowerCase();
      if(type==='region'&&retired.has(code))continue;
      if(type==='language'&&Intl.getCanonicalLocales(key)[0]!==key)continue;
      const values=names.map(name=>name.of(key)).filter(value=>value&&value!==key);
      if(!values.length)continue;
      if(type==='region')countryGroups[key]=[...new Set([...(countryGroups[key]||[]),...values])];
      else {const canonical=fold(names[0].of(key)||key);languageGroups[canonical]=[...new Set([...(languageGroups[canonical]||[]),key,...values])];}
    }
  }catch{/* Explicit aliases remain available in older WebViews. */}
}
function vocabulary(groups){const index=new Map();for(const [canonical,aliases]of Object.entries(groups))for(const value of [canonical,...aliases])index.set(fold(value),canonical);return index;}
const genreIndex=vocabulary(genreGroups),languageIndex=vocabulary(languageGroups),countryIndex=vocabulary(countryGroups);
export const isGenreTerm=value=>genreIndex.has(fold(value));
export const countryCode=value=>countryIndex.get(fold(value))||'';
export const canonicalGenre=value=>genreIndex.get(fold(value))||fold(value);
export const canonicalLanguage=value=>languageIndex.get(fold(value))||fold(value);
export const genreWords=value=>[canonicalGenre(value),...(genreGroups[canonicalGenre(value)]||[])].join(' ');
export const languageWords=value=>[canonicalLanguage(value),...(languageGroups[canonicalLanguage(value)]||[])].join(' ');
export function countryWords(station){const code=String(station.countrycode||'').toUpperCase();return [station.country,code,...(countryGroups[code]||[])].filter(Boolean).join(' ');}
export function displayCountry(station,locale='en'){
  const code=String(station?.countrycode||'').toUpperCase();
  try{if(/^[A-Z]{2}$/.test(code))return new Intl.DisplayNames([locale],{type:'region',style:'short',fallback:'none'}).of(code)||station.country||code;}catch{/* Raw directory name remains usable. */}
  return station?.country||'';
}
const placeTerms=new Set(PLACE_TERMS.flatMap(value=>[value,...value.split(' ')]));
for(const value of countryIndex.keys())for(const word of value.split(' '))placeTerms.add(word);
export function isPlaceTerm(term){return countryIndex.has(fold(term))||placeTerms.has(term);}
export function correctGenre(term,available=[]){
  const curated=Object.keys(genreGroups).filter(value=>!value.includes(' ')&&value!==term&&closeWord(term,value));
  if(curated.length===1)return curated[0];
  if(curated.length>1)return null;
  const values=[...new Set([...Object.keys(genreGroups),...available].map(canonicalGenre))];
  if(values.includes(term))return null;
  const close=values.filter(value=>!value.includes(' ')&&closeWord(term,value));
  return close.length===1?close[0]:null;
}
export function matchesCountry(station,wanted){
  const term=fold(wanted);if(!term)return true;
  const code=String(station?.countrycode||'').toUpperCase(),expected=countryIndex.get(term)||(/^\w{2}$/.test(term)?term.toUpperCase():'');
  const actual=countryIndex.get(fold(station?.country));
  return Boolean((expected&&(code===expected||actual===expected))||fold(station?.country)===term);
}
const connectors={en:new Set(['in','from','and']),es:new Set(['en','de','desde','y']),ar:new Set(['في','من'])};
export function searchTerms(query,locale='en'){
  const words=[...new Set(fold(query).split(' ').filter(Boolean))],ignored=connectors[String(locale).split('-')[0]]||connectors.en;
  return words.filter((word,index)=>words.length<3||index===0||index===words.length-1||!ignored.has(word)).slice(0,8);
}
// At most one insertion, deletion, substitution or adjacent transposition.
export function closeWord(a,b){
  if(a.length<5||a.length>32||b.length>36||Math.abs(a.length-b.length)>1||!/^[\p{L}]+$/u.test(a))return false;
  if(a===b)return true;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++edits>1)return false;
    if(a.length===b.length){
      if(a[i]===b[j+1]&&a[i+1]===b[j]){i+=2;j+=2;}else{i++;j++;}
    }else if(a.length>b.length)i++;else j++;
  }
  return edits+(i<a.length||j<b.length?1:0)<=1;
}
const genreLabels={'hip hop':'Hip-hop',lofi:'Lo-fi','r b':'R&B','drum and bass':'Drum & bass',kpop:'K-pop',jpop:'J-pop'};
export function facetLabel(value,field){const text=String(value);return field==='genre'&&genreLabels[text]||text.charAt(0).toUpperCase()+text.slice(1);}
export function filterFacetOptions(options,query='',limit=24){
  const wanted=fold(query).slice(0,64),terms=[...new Set([wanted,canonicalGenre(wanted),canonicalLanguage(wanted)])];
  const scored=[];
  for(const option of Array.isArray(options)?options:[]){
    if(!option||typeof option.value!=='string'||typeof option.label!=='string')continue;
    const values=[fold(option.value),fold(option.label)];let score=wanted?-1:0;
    for(const term of terms){
      if(!term)continue;
      for(const value of values){
        if(value===term)score=Math.max(score,4);else if(value.startsWith(term))score=Math.max(score,3);
        else if(value.includes(term)||value.replaceAll(' ','').includes(term.replaceAll(' ','')))score=Math.max(score,2);
        else if(value.split(' ').some(word=>closeWord(term,word)))score=Math.max(score,1);
      }
    }
    if(score>=0)scored.push({option,score,count:Number.isFinite(option.count)?Math.max(0,option.count):0});
  }
  const cap=Math.min(24,Math.max(0,Number.isFinite(Number(limit))?Math.trunc(Number(limit)):24));
  return scored.sort((a,b)=>b.score-a.score||b.count-a.count||compare(fold(a.option.label),fold(b.option.label))||compare(a.option.value,b.option.value)).slice(0,cap).map(row=>row.option);
}
