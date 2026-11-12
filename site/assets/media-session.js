import {buildRadioMediaMetadata,currentMediaSong,mediaArtworkSource} from './media-session-core.js?v=0.37.0';
import {createMediaArtworkLoader} from './media-session-artwork.js?v=0.37.0';
import {getCurrentSongSnapshot,subscribeCurrentSong} from './metadata-enrichment.js?v=0.37.0';
import {normalizeLocale} from '../i18n/index.js?v=0.37.0';

const actionNames={play:'play',pause:'pause',stop:'stop',previoustrack:'previous',nexttrack:'next'};

// Presentation and command routing only. The adapter remains the single audio,
// source-generation and current-list owner; this controller never starts a timer
// to poll, reads an account document, or creates a second playback path.
export function createRadioMediaSession(adapter,dependencies={}){
  let session,Metadata;
  try{
    session=Object.hasOwn(dependencies,'session')?dependencies.session:globalThis.navigator?.mediaSession;
    Metadata=Object.hasOwn(dependencies,'Metadata')?dependencies.Metadata:globalThis.MediaMetadata;
  }catch{/* optional browser capability */}
  const getSong=dependencies.getSong||getCurrentSongSnapshot,subscribeSong=dependencies.subscribeSong||subscribeCurrentSong;
  const getLocale=dependencies.getLocale||(()=>normalizeLocale(globalThis.document?.documentElement.lang));
  const loader=dependencies.artworkLoader||(session?createMediaArtworkLoader():{load:async()=>null,dispose(){}});
  const setDocumentTitle=dependencies.setDocumentTitle||(value=>{if(globalThis.document)globalThis.document.title=value;});
  const onError=dependencies.onError||(action=>console.warn('Earth Radio media action could not finish: '+action));
  const events=Object.hasOwn(dependencies,'eventTarget')?dependencies.eventTarget:globalThis.window;
  let disposed=false,blocked=false,generation=0,actionSerial=0,key=null,current=null,coverController=null,unsubscribe,lastTitle;
  const handlers=new Map();
  const retire=()=>{generation++;coverController?.abort();coverController=null;};
  const setState=value=>{try{if(session)session.playbackState=value;}catch{/* unsupported optional state */}};
  function writeTitle(value){try{if(value!==lastTitle){setDocumentTitle(value);lastTitle=value;}}catch{/* optional document presentation cannot affect audio */}}
  function write(value){
    try{if(!session)return;if(value===null)session.metadata=null;else if(typeof Metadata==='function')session.metadata=new Metadata(value);}catch{/* optional native metadata must not affect audio */}
  }
  function project(forceLoading){
    if(blocked)return null;
    let snapshot;try{snapshot=adapter.snapshot();}catch{return null;}
    if(!snapshot?.station||snapshot.status==='idle'&&!forceLoading)return null;
    const status=forceLoading?'loading':snapshot.status;
    let song=null;
    if(snapshot.played&&['playing','paused'].includes(status)){try{song=currentMediaSong(snapshot.station,getSong());}catch{/* station fallback remains usable */}}
    const locale=getLocale(),data=buildRadioMediaMetadata(snapshot.station,song,{locale});
    if(!data)return null;
    const cover=song?mediaArtworkSource(song.artworkUrl):'';
    return{snapshot,song,locale,data,cover,status,key:JSON.stringify([snapshot.station.stationuuid,snapshot.station.url_resolved||snapshot.station.url||'',locale,data.title,data.artist,data.album,cover])};
  }
  function publish(forceLoading=false,forceGeneration=false){
    if(disposed)return;
    let projection;try{projection=project(forceLoading);}catch{/* optional presentation cannot interrupt the audio owner */}
    if(!projection){if(key!==null||current){retire();key=null;current=null;}write(null);writeTitle('Earth Radio');setState('none');return;}
    current=projection;
    writeTitle(projection.data.title+' · Earth Radio');
    setState(projection.status==='playing'?'playing':projection.status==='paused'||projection.status==='loading'?'paused':'none');
    if(projection.key===key&&!forceGeneration)return;
    retire();key=projection.key;write(projection.data);
    if(!session||!projection.cover||typeof Metadata!=='function')return;
    const version=generation,expected=key,controller=new AbortController();coverController=controller;
    // Native artwork receives only bounded local raster output, never a remote
    // URL that could bypass this loader's redirect/content/byte guards.
    (async()=>loader.load(projection.cover,{signal:controller.signal}))().then(artwork=>{
      if(!artwork||disposed||blocked||controller.signal.aborted||version!==generation||expected!==key)return;
      publish(); // re-read the actual station/state, even after a missed UI notice
      if(disposed||blocked||controller.signal.aborted||version!==generation||expected!==key||!current)return;
      write(buildRadioMediaMetadata(current.snapshot.station,current.song,{locale:current.locale,artwork}));
    }).catch(()=>{/* first-party fallback and song text remain; no audio side effect */});
  }
  function refresh(){publish();}
  function selectStation(){if(disposed)return;blocked=false;actionSerial++;publish(true,true);}
  function clear(){if(disposed)return;blocked=true;actionSerial++;retire();key=null;current=null;write(null);writeTitle('Earth Radio');setState('none');}
  function dispose(){
    if(disposed)return;clear();disposed=true;
    try{unsubscribe?.();}catch{/* released with the document */}
    try{loader.dispose();}catch{/* no playback dependency */}
    for(const action of handlers.keys()){try{session.setActionHandler(action,null);}catch{/* individually unsupported action */}}
    handlers.clear();events?.removeEventListener('earthradio:locale-changed',refresh);events?.removeEventListener('pageshow',refresh);events?.removeEventListener('pagehide',exit);
  }
  function exit(event){if(!event.persisted)dispose();}
  if(session)for(const [action,command]of Object.entries(actionNames)){
    const handler=typeof adapter[command]==='function'?async()=>{
      if(disposed)return;const ticket=++actionSerial;
      try{await adapter[command]();if(disposed)return;if(action==='stop'&&ticket===actionSerial)clear();else refresh();}
      catch{if(!disposed){try{onError(action);}catch{/* diagnostics cannot affect the owner */}refresh();}}
    }:null;
    try{session.setActionHandler(action,handler);handlers.set(action,handler);}catch{/* preserve other supported actions */}
  }
  try{unsubscribe=subscribeSong(refresh);}catch{/* owned state transitions still refresh station metadata */}
  events?.addEventListener('earthradio:locale-changed',refresh);events?.addEventListener('pageshow',refresh);events?.addEventListener('pagehide',exit);
  refresh();
  return{refresh,selectStation,clear,dispose};
}
