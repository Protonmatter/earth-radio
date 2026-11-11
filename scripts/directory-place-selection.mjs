// Publication-only selection. Input is normalized and ranked; no I/O or mutation.
import {CURATED_PLACES} from '../site/assets/curated-places.js';
import {cityProgramChoices} from '../site/assets/today-core.js';
import {programComponents,MAX_PROGRAM_OBSERVATIONS} from '../site/assets/program-components.js';
import {stationPlace} from '../site/assets/place-core.js';

export function selectDirectoryPlaces(ranked,{globalLimit=10000,minimumCityPrograms=5}={}){
  if(!Array.isArray(ranked)||ranked.length>75000)throw TypeError('Expected at most 75000 normalized directory rows');
  if(!Number.isInteger(globalLimit)||globalLimit<1||globalLimit>10000)throw RangeError('Invalid global snapshot limit');
  if(!Number.isInteger(minimumCityPrograms)||minimumCityPrograms<0||minimumCityPrograms>20)throw RangeError('Invalid city minimum policy');
  const prefix=ranked.slice(0,globalLimit);
  if(!minimumCityPrograms)return{stations:prefix,coverage:[],addedForPlaces:0,candidateRecords:0};
  if(globalLimit<CURATED_PLACES.length*minimumCityPrograms)throw RangeError('Global snapshot limit has insufficient space for the city minimum');
  // The complete proof graph is this explicit, ranked candidate pool. Do not pass
  // oversized arrays to the shared model or silently truncate inside that model.
  const candidates=ranked.slice(0,MAX_PROGRAM_OBSERVATIONS),prefixRows=new Set(prefix),byRow=new Map();
  for(const component of programComponents(candidates).components)for(const row of component)byRow.set(row,component);
  const protectedRows=new Set(),coverage=[];
  for(const city of CURATED_PLACES){
    const choices=cityProgramChoices(candidates,city.id,{secureOnly:false});
    if(choices.length<minimumCityPrograms)throw Error(`${city.name} has ${choices.length} qualified programs; minimum ${minimumCityPrograms}`);
    const existing=[],additional=[];
    for(const choice of choices){
      const witness=byRow.get(choice).find(row=>prefixRows.has(row)&&stationPlace(row)?.cityId===city.id);
      (witness?existing:additional).push(witness||choice);
    }
    const retained=existing.slice(0,minimumCityPrograms),required=[...retained,...additional.slice(0,minimumCityPrograms-retained.length)];
    for(const row of required)protectedRows.add(row);
    coverage.push({cityId:city.id,city:city.name,availablePrograms:choices.length,retainedWitnesses:retained.length});
  }
  const selected=new Set(prefix);let addedForPlaces=0;
  for(const row of protectedRows)if(!selected.has(row)){selected.add(row);addedForPlaces++;}
  // Protect every city's witnesses before evicting any row; calendar order must
  // not allow one city's additions to remove another city's fifth program.
  for(let i=prefix.length-1;selected.size>globalLimit&&i>=0;i--)if(!protectedRows.has(prefix[i]))selected.delete(prefix[i]);
  if(selected.size>globalLimit)throw Error('City minimum exceeds the global snapshot budget');
  const stations=ranked.filter(row=>selected.has(row));
  for(const row of coverage){
    row.selectedPrograms=cityProgramChoices(stations,row.cityId,{secureOnly:false}).length;
    if(row.selectedPrograms<minimumCityPrograms)throw Error(`${row.city} failed the selected-root minimum ${minimumCityPrograms}`);
  }
  return{stations,coverage,addedForPlaces,candidateRecords:candidates.length};
}
