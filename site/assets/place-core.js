// Conservative presentation metadata, not broadcaster-site geocoding. No I/O,
// listener location, account storage, implicit clock or device timezone.
import {CURATED_PLACES} from './curated-places.js?v=0.36.0';
import {COUNTRY_LOCATIONS} from './country-locations.js?v=0.36.0';
import {stationLocation} from './station-location.js?v=0.36.0';
import {fold} from './search-core.js?v=0.36.0';

export const CITY_EVIDENCE_RADIUS_KM=25;
const zoneName=/^(?:UTC|[-A-Za-z_]+(?:\/[-A-Za-z0-9_+]+){1,3})$/;
const text=value=>typeof value==='string'&&value.length<=512?fold(value):'';
const numeric=value=>(typeof value==='number'||typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))&&Number.isFinite(Number(value));
const validCity=city=>city&&typeof city.id==='string'&&/^ne-[1-9]\d*$/.test(city.id)&&typeof city.name==='string'&&city.name.trim()&&city.name.length<=160&&Array.isArray(city.point)&&city.point.length===2&&city.point.every(Number.isFinite)&&Math.abs(city.point[0])<=90&&Math.abs(city.point[1])<=180&&typeof city.timeZone==='string'&&city.timeZone.length<=96&&zoneName.test(city.timeZone)&&Array.isArray(city.aliases)&&city.aliases.length>0&&city.aliases.length<=8&&city.aliases.every(alias=>typeof alias==='string'&&alias.trim()&&alias.length<=160);
const mentions=(value,city)=>value&&city.aliases.some(alias=>{const term=text(alias);return term&&(' '+value+' ').includes(' '+term+' ');});
function distanceKm(a,b){
 const radians=value=>value*Math.PI/180,dLat=radians(b[0]-a[0]),dLng=radians(b[1]-a[1]);
 const h=Math.sin(dLat/2)**2+Math.cos(radians(a[0]))*Math.cos(radians(b[0]))*Math.sin(dLng/2)**2;
 // An explicit spherical candidate gate, not a municipal boundary or a claim of
 // empirical accuracy. Clamp roundoff before taking the square roots.
 const bounded=Math.max(0,Math.min(1,h));return 2*6371*Math.atan2(Math.sqrt(bounded),Math.sqrt(1-bounded));
}

export function stationPlace(station,places=CURATED_PLACES){
 if(!station||typeof station!=='object'||Array.isArray(station))return null;
 const countrycode=typeof station.countrycode==='string'?station.countrycode.trim().toUpperCase():'';
 if(!/^[A-Z]{2}$/.test(countrycode)||!Object.hasOwn(COUNTRY_LOCATIONS,countrycode))return null;
 if(!Array.isArray(places)||places.length>64)throw TypeError('Place set must be an array of at most 64 records');
 const country={confidence:'country',countrycode,provenance:'country-only'};
 if(![station.geo_lat,station.geo_long].every(numeric))return country;
 const location=stationLocation({...station,countrycode});if(!location||location.approximate)return country;
 const base={confidence:'exact',countrycode,point:[...location.point],provenance:'directory-coordinates'};
 const cities=places.filter(city=>validCity(city)&&city.countrycode===countrycode);
 const explicit=text(station.city),state=text(station.state),name=text(station.name);
 if(station.city!=null&&typeof station.city!=='string'||typeof station.city==='string'&&station.city.length>512)return base;
 const cityMatches=cities.filter(city=>mentions(explicit,city)),stateMatches=cities.filter(city=>mentions(state,city));
 let candidates;
 if(explicit){
  // An explicit but unrecognized/conflicting city is not repaired by the brand
  // name. State/province text only adds city evidence when it names a city.
  // Multiple geographic records with one folded name (e.g. Springfield) may
  // be disambiguated by coordinates. Two different explicit names may not.
  if(!cityMatches.length||new Set(cityMatches.map(city=>text(city.name))).size>1||stateMatches.some(city=>!cityMatches.includes(city)))return base;
  candidates=cityMatches;
 }else candidates=stateMatches.length?stateMatches:cities.filter(city=>mentions(name,city));
 const nearby=candidates.filter(city=>distanceKm(location.point,city.point)<=CITY_EVIDENCE_RADIUS_KM);
 if(nearby.length!==1)return base;
 const city=nearby[0];if(formatPlaceTime(city,0)===null)return base;
 return{...base,confidence:'city',cityId:city.id,city:city.name,timeZone:city.timeZone,provenance:'directory-coordinate-and-city-name'};
}

function explicitInstant(value){
 if(value instanceof Date)value=value.getTime();
 if(typeof value==='number')return Number.isFinite(value)&&Math.abs(value)<=8640000000000000?value:null;
 if(typeof value!=='string'||value.length>64)return null;
 const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/);
 if(!match)return null;
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(part=>Number(part||0)),offset=match[7];
 const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59||offset!=='Z'&&(Number(offset.slice(1,3))>23||Number(offset.slice(4))>59))return null;
 const milliseconds=Date.parse(value);return Number.isFinite(milliseconds)?milliseconds:null;
}

export function formatPlaceTime(place,instant,locale='en'){
 const timeZone=place?.timeZone,milliseconds=explicitInstant(instant);
 if(milliseconds===null||typeof timeZone!=='string'||timeZone.length>96||!zoneName.test(timeZone)||typeof locale!=='string'||!locale||locale.length>80)return null;
 try{
  if(!Intl.DateTimeFormat.supportedLocalesOf([locale],{localeMatcher:'lookup'}).length)return null;
  return new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(milliseconds);
 }catch{return null;}
}
