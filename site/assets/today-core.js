// A separately frozen v1 UTC calendar: adding general place data cannot change
// an existing day's city. Selection is recommendation-only; it never plays audio.
import {CURATED_PLACES} from './curated-places.js?v=0.33.0';
import {stationPlace,formatPlaceTime} from './place-core.js?v=0.33.0';
import {programComponents,nativeProgramSupport} from './program-components.js?v=0.33.0';
import {rankStations} from './discovery-core.js?v=0.33.0';

export const TODAY_CALENDAR_V1=Object.freeze([
 'ne-1159151529','ne-1159151563','ne-1159151575','ne-1159151503',
 'ne-1159151579','ne-1159151577','ne-1159151557','ne-1159151309',
 'ne-1159151599','ne-1159151491','ne-1159151523'
]);
const identity=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value.toLowerCase():value;

export function todayPlaceForUTCDate(dayKey,places=CURATED_PLACES){
 if(typeof dayKey!=='string'||!/^\d{4}-\d\d-\d\d$/.test(dayKey)||dayKey.startsWith('0000')||!Array.isArray(places)||places.length>64)return null;
 const instant=Date.parse(dayKey+'T00:00:00.000Z');
 if(!Number.isFinite(instant)||new Date(instant).toISOString().slice(0,10)!==dayKey)return null;
 const index=((instant/86400000)%TODAY_CALENDAR_V1.length+TODAY_CALENDAR_V1.length)%TODAY_CALENDAR_V1.length;
 const id=TODAY_CALENDAR_V1[index],place=places.find(city=>city?.id===id);
 return place&&typeof place.name==='string'&&/^[A-Z]{2}$/.test(place.countrycode)&&formatPlaceTime(place,instant)!==null?place:null;
}

function supportedComponents(stations){
 return programComponents(stations).components.map(rows=>{
  const observations=rows.map(row=>({row,place:stationPlace(row)}));
  const countries=new Set(observations.map(item=>item.place?.countrycode).filter(Boolean));
  const cities=new Set(observations.map(item=>item.place?.cityId).filter(Boolean));
  let cityId=countries.size===1&&cities.size===1?[...cities][0]:null;
  // A sampled subset may omit a bridge or conflicting place. Native evidence can
  // restrict qualification; it cannot confer city evidence on an unsupported row.
  if(rows.some(row=>{const support=nativeProgramSupport(row);return support!==undefined&&(!support||support.cityId!==cityId);}))cityId=null;
  return{rows,observations,cityId};
 });
}

function choices(components,cityId,options={}){
 const byRow=new Map(),candidates=[];
 for(const component of components)if(component.cityId===cityId){
  for(const item of component.observations)if(item.place?.cityId===cityId){candidates.push(item.row);byRow.set(item.row,component);}
 }
 const ranked=rankStations(candidates,{sort:'reliable',secureOnly:options.secureOnly!==false,avoidFailures:true,badStations:options.badStations,health:options.health,now:Number.isFinite(options.now)?options.now:0});
 const seen=new Set(),result=[];
 for(const entry of ranked){const component=byRow.get(entry.station);if(!seen.has(component)){seen.add(component);result.push({station:entry.station,component});}}
 return result;
}

export function cityProgramChoices(stations,cityId,options={}){
 if(!TODAY_CALENDAR_V1.includes(cityId))return[];
 return choices(supportedComponents(stations),cityId,options).map(item=>item.station);
}

export function appendCitySeeds(prefix,root){
 if(!Array.isArray(prefix)||!Array.isArray(root)||prefix.length>6500||root.length>10000)throw TypeError('Invalid native city seed budgets');
 if(!root.length)return[...prefix];
 const components=supportedComponents([...prefix,...root]);
 const prefixRows=new Set(prefix),rootRows=new Set(root),ids=new Set(prefix.map(row=>identity(row.stationuuid))),result=[...prefix];
 for(const cityId of TODAY_CALENDAR_V1){
  const ranked=choices(components,cityId,{secureOnly:false});
  const present=new Set(components.filter(component=>component.cityId===cityId&&component.observations.some(item=>prefixRows.has(item.row)&&item.place?.cityId===cityId)));
  for(const item of ranked){
   if(present.size>=5)break;
   if(present.has(item.component))continue;
   // Select a corroborated root variant, never an unsupported sibling or a
   // duplicate UUID that the existing native merge would discard.
   const eligible=item.component.observations.filter(observation=>observation.place?.cityId===cityId&&rootRows.has(observation.row)&&!ids.has(identity(observation.row.stationuuid))).map(observation=>observation.row);
   const station=rankStations(eligible,{sort:'reliable',now:0})[0]?.station;
   if(station){result.push(station);ids.add(identity(station.stationuuid));present.add(item.component);}
  }
 }
 const evidence=new Map();
 for(const component of components){
  const support={id:identity(component.rows[0].stationuuid),cityId:component.cityId};
  for(const row of component.rows)evidence.set(row,support);
 }
 return result.map(row=>({...row,nativeProgram:evidence.get(row)||null}));
}
