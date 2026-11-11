import {setupApp} from '../helpers.mjs';
import {CURATED_PLACES} from '../../../site/assets/curated-places.js';

const cityRows=name=>{
 const city=CURATED_PLACES.find(place=>place.name===name),offset=name==='Berlin'?300:400;
 return Array.from({length:6},(_,index)=>({stationuuid:`00000000-0000-4000-8000-${String(offset+index).padStart(12,'0')}`,name:`${name} Radio ${index+1}`,country:city.countrycode==='DE'?'Germany':'Austria',countrycode:city.countrycode,state:city.name,geo_lat:city.point[0],geo_long:city.point[1],url:`https://streams.e2e.example/${name.toLowerCase()}-${index}.wav`,url_resolved:`https://streams.e2e.example/${name.toLowerCase()}-${index}.wav`,codec:'MP3',bitrate:128,lastcheckok:1,clickcount:100-index,tags:'jazz',language:'english'}));
};
export async function setupToday(page,{empty=false,variant=false,longName=false,enableAuth=false}={}){
 await setupApp(page,{navigate:false,enableAuth});
 await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
 const rows=empty?[]:[...cityRows('Berlin'),...cityRows('Vienna')];
 if(longName){rows.splice(1,5);rows[0].name='Berlin '+'音'.repeat(140);}
 if(variant)rows.push({...rows[0],stationuuid:'00000000-0000-4000-8000-000000000999',url:'https://streams.e2e.example/berlin-alternative.wav',url_resolved:'https://streams.e2e.example/berlin-alternative.wav'});
 await page.route(url=>url.hostname.endsWith('api.radio-browser.info')&&/\/json\/stations\/(?:topclick|search)/.test(url.pathname),route=>route.fulfill({json:rows}));
}
