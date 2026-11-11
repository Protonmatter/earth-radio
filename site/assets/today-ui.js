// Today is presentation only. Catalog snapshots and every playback/storage action
// stay with the existing runtime adapter. No loader, audio element or user store.
import {todayPlaceForUTCDate,cityProgramChoices} from './today-core.js?v=0.34.0';
import {formatPlaceTime} from './place-core.js?v=0.34.0';
import {rankStations,streamIdentity} from './discovery-core.js?v=0.34.0';
import {programComponents} from './program-components.js?v=0.34.0';
import {displayCountry} from './search-core.js?v=0.34.0';
import {t,getLocale} from '../i18n/index.js?v=0.34.0';

const text=(element,value)=>{if(element&&element.textContent!==value)element.textContent=value;};
const same=(a,b)=>Boolean(a&&b&&(a.stationuuid===b.stationuuid||streamIdentity(a)===streamIdentity(b)));

export function installToday(adapter){
 const root=document.getElementById('er-today');
 if(!root)return{observe(){},refresh(){},defaultStation:()=>null};
 let catalog=[],revision=null,day='',place=null,hero=null,air=[],lastLocale='',cardsKey='';
 const actions=new Map(),componentsById=new Map();
 const element=id=>document.getElementById(id);
 const current=()=>adapter.current?.()||null;
 const last=()=>adapter.last?.()||null;
 const state=()=>adapter.state?.()||'idle';
 const defaultStation=()=>current()||last()||hero;
 function playbackButton(button,station){
  if(!button)return;
  const component=componentsById.get(station?.stationuuid);
  const active=same(current(),station)||Boolean(component&&component===componentsById.get(current()?.stationuuid)),playing=active&&['playing','loading'].includes(state());
  const key=playing?(state()==='loading'?'today.cancel':'today.pause'):'today.play';
  button.disabled=!station;button.dataset.stationId=station?.stationuuid||'';
  button.setAttribute('aria-label',t(key,{station:station?.name||t('today.noStation')}));
  text(button,t(playing?(state()==='loading'?'today.cancelShort':'player.pause'):'player.play'));
  if(station)actions.set(button,station);else actions.delete(button);
 }
 function recommendations(){
  try{
  const secureOnly=adapter.native?.()!==true,options={secureOnly,now:Date.now(),badStations:adapter.badStations?.()};
  hero=place?cityProgramChoices(catalog,place.id,options)[0]||null:null;
  const model=programComponents(catalog),componentByRow=new Map();
  componentsById.clear();
  for(const component of model.components)for(const row of component){componentByRow.set(row,component);componentsById.set(row.stationuuid,component);}
  const heroComponent=componentByRow.get(hero),seen=new Set(heroComponent?[heroComponent]:[]);air=[];
  for(const entry of rankStations(catalog,{...options,sort:'reliable',avoidFailures:true})){
   const component=componentByRow.get(entry.station);if(seen.has(component)||same(entry.station,hero))continue;
   seen.add(component);air.push(entry.station);if(air.length===3)break;
  }
  cardsKey='';
  }catch{
   // This optional surface must never turn a successful shared-catalog load
   // into a player/search failure. Keep Continue and the existing refresh path.
   hero=null;air=[];componentsById.clear();cardsKey='';
   console.warn('Earth Radio Today: catalog recommendations unavailable');
  }
 }
 function render(){
  const now=Date.now(),date=new Date(now).toISOString().slice(0,10),locale=getLocale();
  if(date!==day){day=date;place=todayPlaceForUTCDate(day);recommendations();}
  root.dataset.day=day;
  const continued=current()||last(),continueCard=element('er-today-continue');
  continueCard.hidden=!continued;
  text(element('er-today-continue-name'),continued?.name||'');
  playbackButton(continueCard.querySelector('[data-today-play]'),continued);
  text(element('er-today-city'),place?.name||t('today.unavailableTitle'));
  text(element('er-today-time'),place?`${formatPlaceTime(place,now,locale)||'—'} · ${displayCountry({countrycode:place.countrycode},locale)}`:'');
  text(element('er-today-station'),hero?.name||t('today.noStation'));
  playbackButton(element('er-today-place').querySelector('[data-today-play]'),hero);
  element('er-today-unavailable').hidden=Boolean(hero);
  const refresh=root.querySelector('[data-today-refresh]');if(refresh)refresh.hidden=Boolean(hero);
  const key=day+'|'+locale+'|'+air.map(row=>row.stationuuid).join('|');
  if(cardsKey!==key){
   const list=element('er-today-onair');
   for(const [index,station]of air.entries()){
    let item=list.children[index];
    if(!item){
     item=document.createElement('li');const copy=document.createElement('div'),name=document.createElement('strong'),country=document.createElement('span'),button=document.createElement('button');
     copy.append(name,country);button.type='button';button.setAttribute('data-today-play','');item.append(copy,button);list.append(item);
    }
    text(item.querySelector('strong'),station.name);text(item.querySelector('span'),displayCountry(station,locale));playbackButton(item.querySelector('button'),station);
   }
   while(list.children.length>air.length){
    const item=list.lastElementChild;if(item.contains(document.activeElement))element('er-today-place').querySelector('[data-today-play]')?.focus();
    actions.delete(item.querySelector('button'));item.remove();
   }
   cardsKey=key;
  }else for(const button of element('er-today-onair').querySelectorAll('[data-today-play]'))playbackButton(button,actions.get(button));
  text(element('er-today-air-empty'),t('today.airEmpty'));element('er-today-air-empty').hidden=air.length>0;
  lastLocale=locale;
  adapter.defaultChanged?.(defaultStation());
 }
 root.addEventListener('click',event=>{
  const button=event.target instanceof Element?event.target.closest('[data-today-play]'):null;
  if(button){const station=actions.get(button);if(!station)return;
   const component=componentsById.get(station.stationuuid),active=same(current(),station)||Boolean(component&&component===componentsById.get(current()?.stationuuid));
   if(active&&['playing','loading'].includes(state()))adapter.pause?.();else void adapter.play?.(station);
   render();
  }
 });
 const foreground=()=>{if(!document.hidden)render();};
 document.addEventListener('visibilitychange',foreground);
 window.addEventListener('focus',foreground);
 window.addEventListener('earthradio:locale-changed',()=>{if(lastLocale!==getLocale())render();});
 // Clock text is deliberately outside any live region. Rendering never plays.
 const timer=setInterval(foreground,60000);
 window.addEventListener('pagehide',event=>{if(!event.persisted)clearInterval(timer);});
 const observe=snapshot=>{
  if(Array.isArray(snapshot?.stations)&&snapshot.stations!==revision){catalog=snapshot.stations;revision=catalog;place=todayPlaceForUTCDate(new Date().toISOString().slice(0,10));recommendations();}
  render();
 };
 render();
 return{observe,refresh:render,defaultStation};
}
