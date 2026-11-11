import {COUNTRY_LOCATIONS} from './country-locations.js?v=0.33.0';

export const ATLAS_MIN_LATITUDE=-60,ATLAS_MAX_LATITUDE=85;
const inAtlas=point=>point[0]>=ATLAS_MIN_LATITUDE&&point[0]<=ATLAS_MAX_LATITUDE;

// Presentation only. Approximate points never replace directory coordinates or
// enter account documents, geographic search filters, or reliability scores.
export function stationLocation(station){
  if(!station)return null;
  const reference=COUNTRY_LOCATIONS[String(station.countrycode||'').toUpperCase()];
  const raw=[station.geo_lat,station.geo_long];
  const point=raw.every(value=>value!=null&&typeof value!=='boolean'&&String(value).trim()!=='' )?raw.map(Number):null;
  const valid=point&&point.every(Number.isFinite)&&Math.abs(point[0])<=90&&Math.abs(point[1])<=180&&(point[0]!==0||point[1]!==0);
  // Polygon component envelopes tolerate coastal/offshore transmitters by one
  // degree. This rejects obvious country/ocean mistakes, not a geocoding proof.
  const plausible=valid&&(!reference||reference.boxes.some(box=>point[1]>=box[0]/10000-1&&point[1]<=box[2]/10000+1&&point[0]>=box[1]/10000-1&&point[0]<=box[3]/10000+1));
  if(plausible)return inAtlas(point)?{point,approximate:false}:null;
  const fallback=reference?.point.map(value=>value/10000);
  return fallback&&inAtlas(fallback)?{point:fallback,approximate:true}:null;
}
export function stationMapPoint(station){return stationLocation(station)?.point||null;}
export function stationMarkerStyle(station,style){return stationLocation(station)?.approximate?{...style,className:'er-map-approximate',dashArray:'3 3',fillOpacity:0.5}:{...style,dashArray:null};}
