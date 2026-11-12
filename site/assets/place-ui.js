// Facts rendering only. Never selects, plays, persists or calls a provider.
import {stationFacts} from './place-copy.js?v=0.34.1';
import {streamIdentity} from './discovery-core.js?v=0.34.1';
import {getLocale} from '../i18n/index.js?v=0.34.1';

const rows=new WeakMap();
let player=null,playerKey='',playerTitle='',playerFacts=null;
let ticker=0,frame=0;
const key=station=>station?String(station.stationuuid||'')+'|'+streamIdentity(station):'';
const visible=node=>node.isConnected&&node.getClientRects().length>0;
const playerFailed=()=>document.getElementById('player-bar')?.classList.contains('is-failed');

function paint(node,state,force=false){
 const now=Date.now(),minute=Math.floor(now/60000),locale=getLocale();
 if(!force&&state.locale===locale&&(!state.hasClock||state.minute===minute))return;
 const facts=stationFacts(state.station,{locale,now});
 if(state.copy?.parentNode!==node||state.time?.parentNode!==node){
  state.copy=document.createElement('span');state.copy.className='er-place-copy';
  state.time=document.createElement('bdi');state.time.className='er-place-time';node.replaceChildren(state.copy,state.time);
 }
 const copy=[facts.place,facts.genre].filter(Boolean).join(' · '),time=facts.time?' · '+facts.time:'';
 if(state.copy.textContent!==copy)state.copy.textContent=copy;
 if(state.time.textContent!==time)state.time.textContent=time;
 state.time.hidden=!facts.time;
 if(node.title!==facts.text)node.title=facts.text;
 if(node.dir!=='auto')node.dir='auto';
 state.minute=minute;state.locale=locale;state.hasClock=Boolean(facts.cityId);
}

export function refreshPlaceFacts(){
 if(typeof document==='undefined'||document.hidden||frame)return;
 frame=requestAnimationFrame(()=>{
  frame=0;
  for(const node of document.querySelectorAll('.er-place-facts')){
   const state=rows.get(node);if(state&&visible(node))paint(node,state);
  }
  const node=document.getElementById('player-meta');
  if(node&&playerFacts&&visible(node)&&!playerFailed())paint(node,playerFacts);
 });
}

function startClock(){
 if(ticker||typeof window==='undefined')return;
 ticker=setInterval(refreshPlaceFacts,60000);
 document.addEventListener('visibilitychange',refreshPlaceFacts);
 window.addEventListener('focus',refreshPlaceFacts);
 window.addEventListener('earthradio:locale-changed',refreshPlaceFacts);
 window.addEventListener('pagehide',event=>{
  if(event.persisted)return;
  clearInterval(ticker);cancelAnimationFrame(frame);ticker=frame=0;
 });
}

export function createStationFacts(station){
 const node=document.createElement('span'),state={station};
 node.className='er-station-meta-text er-place-facts';rows.set(node,state);
 paint(node,state,true);startClock();return node;
}

export function updatePlayerFacts(station,options={}){
 const node=document.getElementById('player-meta');if(!node)return;
 const next=key(station),changed=next!==playerKey,previousTitle=playerTitle;
 if(changed)playerTitle='';
 if(typeof options.rawTitle==='string')playerTitle=options.rawTitle.length<=512?options.rawTitle.trim():'';
 else if(!playerTitle&&typeof options.probeTitle==='string'&&options.probeTitle.length<=512)playerTitle=options.probeTitle.trim();
 if(changed||station!==player)playerFacts=station?{station}:null;
 player=station;playerKey=next;
 if(node.dataset.erStationFacts!=='true')node.dataset.erStationFacts='true';
 if(node.dataset.erRawTitle!==playerTitle)node.dataset.erRawTitle=playerTitle;
 if(playerFacts){if(!playerFailed())paint(node,playerFacts,true);}
 else{node.textContent='';node.title='';}
 if(changed||previousTitle!==playerTitle)window.dispatchEvent(new Event('earthradio:metadata-refresh'));
 startClock();
}
