// Native API/decoder compatibility in a disposable sandboxed renderer. The
// fixture owns local silent media; compiled player ownership is tested in e2e.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {app,BrowserWindow} from 'electron';
import {silentWav} from './e2e/fixtures/silent-media.mjs';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'.build','native-media-session');
app.setPath('userData',path.join(directory,'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const watchdog=setTimeout(()=>{console.error('Native Media Session compatibility timed out');app.exit(2);},30000);

app.whenReady().then(async()=>{
  await mkdir(directory,{recursive:true});
  const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const moduleUrl=pathToFileURL(path.join(root,'site/assets/media-session.js')).href+'?v='+version;
  const artworkUrl=pathToFileURL(path.join(root,'site/assets/media-session-artwork.js')).href+'?v='+version;
  const cover=(await readFile(path.join(root,'site/branding/earth-radio-app-icon-512.png'))).toString('base64');
  await writeFile(path.join(directory,'silent.wav'),silentWav(8));
  await writeFile(path.join(directory,'setup.js'),"window.RADIO_CONFIG={auth:{enabled:false},metadataEnrichment:{enabled:false}};\n");
  await writeFile(path.join(directory,'fixture.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; img-src \'self\' data:; media-src \'self\'; connect-src \'self\'"><title>Native media compatibility</title><script src="./setup.js"></script><audio id="audio-player" preload="none"></audio><script type="module" src="./fixture.mjs"></script>');
  await writeFile(path.join(directory,'fixture.mjs'),`
import {createRadioMediaSession} from ${JSON.stringify(moduleUrl)};
import {createMediaArtworkLoader} from ${JSON.stringify(artworkUrl)};
window.fixtureMediaDone=(async()=>{
 const check=(condition,label)=>{if(!condition)throw Error(label);};
 const until=async(condition,label)=>{const end=performance.now()+6000;while(!condition()){if(performance.now()>end)throw Error(label);await new Promise(resolve=>setTimeout(resolve,20));}};
 check(typeof process==='undefined'&&typeof require==='undefined','Renderer must remain without Node');
 check(navigator.mediaSession&&typeof MediaMetadata==='function','Native Media Session API is unavailable');
 const session=navigator.mediaSession,actions={},set=session.setActionHandler.bind(session);
 Object.defineProperty(session,'setActionHandler',{configurable:true,value(action,handler){const result=set(action,handler);actions[action]=handler;return result;}});
 const audio=document.getElementById('audio-player');audio.volume=0;
 let index=0,status='idle',played=false,trustedPlaying=false,controller,notify;
 const stations=[1,2].map(number=>({stationuuid:'native-fixture-'+number,name:'Native signal '+number,countrycode:'DE',state:'Berlin',geo_lat:52.52,geo_long:13.405,url:new URL('./silent.wav',import.meta.url).href}));
 const currentSong=()=>({stationUuid:stations[index].stationuuid,artist:'Native fixture artist',title:'Fixture track '+(index+1),confidence:78,artworkUrl:'https://i.scdn.co/image/native-fixture'});
 const source=Uint8Array.from(atob(${JSON.stringify(cover)}),character=>character.charCodeAt(0));
 let coverFetches=0;
 const loader=createMediaArtworkLoader({fetchImpl:async(url,options)=>{
  check(url==='https://i.scdn.co/image/native-fixture'&&options.credentials==='omit'&&options.redirect==='error','Bounded cover contract');
  coverFetches++;return new Response(source,{headers:{'content-type':'image/png'}});
 }});
 const play=async()=>{status='loading';played=false;controller.selectStation();audio.src=stations[index].url;audio.load();await audio.play();played=true;status='playing';controller.refresh();notify();};
 const pause=()=>{audio.pause();status='paused';controller.refresh();};
 const stop=()=>{audio.pause();audio.removeAttribute('src');audio.load();status='idle';played=false;controller.clear();};
 audio.addEventListener('playing',event=>{trustedPlaying ||=event.isTrusted&&!audio.paused&&audio.readyState>=2;});
 controller=createRadioMediaSession({snapshot:()=>({station:stations[index],status,played}),play,pause,stop,
  next:async()=>{index=(index+1)%2;await play();},previous:async()=>{index=(index+1)%2;await play();}
 },{getSong:currentSong,subscribeSong:listener=>{notify=listener;return()=>{};},artworkLoader:loader});
 check(['play','pause','stop','previoustrack','nexttrack'].every(action=>typeof actions[action]==='function'),'Five successful native registrations');
 check(audio.paused&&session.metadata===null,'Initialization must not autoplay');
 await actions.play();await until(()=>audio.currentTime>0.05,'Silent media clock did not advance');
 await until(()=>session.metadata?.artwork.length===3,'Native cover did not complete');
 check(session.metadata.title==='Fixture track 1'&&session.metadata.artist==='Native fixture artist'&&session.metadata.album==='Native signal 1','Native song fields');
 const sizes=[];for(const artwork of session.metadata.artwork){
  check(artwork.src.startsWith('data:image/png;base64,'),'Native artwork must be bounded PNG data');
  const image=new Image();image.src=artwork.src;await image.decode();check(image.naturalWidth===image.naturalHeight,'Square native cover');sizes.push(image.naturalWidth);
 }
 check(JSON.stringify(sizes)==='[96,256,512]','Native raster dimensions');
 await actions.pause();check(audio.paused&&session.playbackState==='paused','Native Pause');
 await actions.nexttrack();check(session.metadata.album==='Native signal 2','Native Next callback');
 await actions.previoustrack();check(session.metadata.album==='Native signal 1','Native Previous callback');
 await actions.stop();check(audio.paused&&!audio.getAttribute('src')&&session.metadata===null&&session.playbackState==='none','Native Stop');
 await actions.play();check(!audio.paused&&session.metadata.title==='Fixture track 1','Native explicit replay');
 await actions.stop();controller.dispose();
 return{nativeActions:5,noAutoplay:true,nodeAbsent:true,trustedPlaying,silentMediaClock:true,metadataFields:true,sizes,
  pauseNextPreviousStopReplay:true,coverFetches,providerEvidence:'local silent WAV and in-memory cover fixture; native callbacks invoked synthetically',fullCompiledPlayerOwner:false};
})();
`);
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  try{
    await window.loadFile(path.join(directory,'fixture.html'));
    const report=await window.webContents.executeJavaScript('window.fixtureMediaDone');
    assert.equal(report.nativeActions,5);assert.equal(report.nodeAbsent,true);assert.equal(report.trustedPlaying,true);
    assert.deepEqual(report.sizes,[96,256,512]);assert.equal(report.pauseNextPreviousStopReplay,true);assert.equal(report.coverFetches,1);
    console.log(JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron,sandbox:true,contextIsolation:true,...report}));
  }finally{window.destroy();clearTimeout(watchdog);}
  app.quit();
}).catch(error=>{clearTimeout(watchdog);console.error(error?.stack||error?.message||'Native media compatibility failed');app.exit(1);});
