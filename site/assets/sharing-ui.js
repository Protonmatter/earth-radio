import {parseStationSharePath,STATION_SHARE_ORIGIN,stationSharePayload} from './sharing-core.js?v=0.37.0';
import {t,normalizeLocale} from '../i18n/index.js?v=0.37.0';

function publicPayload(value){
  if(!value||typeof value.title!=='string'||!value.title||value.title.length>220||typeof value.text!=='string'||value.text.length>320||typeof value.url!=='string')return null;
  const url=new URL(value.url),path=parseStationSharePath(url.pathname);
  if(url.origin!==STATION_SHARE_ORIGIN||url.username||url.password||url.search||url.hash||!path||path.canonicalPath!==url.pathname)return null;
  return Object.freeze({title:value.title,text:value.text,url:url.href});
}

export function createStationSharingController({getPayload,share=null,copy=null,view={},notify=()=>{},text=key=>key}={}){
  if(typeof getPayload!=='function')throw TypeError('A public station payload callback is required');
  let disposed=false,sharing=false,copying=false,epoch=0,current=null;
  const invoke=(name,...args)=>{try{if(typeof view[name]!=='function')return false;view[name](...args);return true;}catch{return false;}};
  const inform=key=>{try{notify(text(key));}catch{/* optional feedback cannot affect playback */}};
  function open(payload){
    if(disposed)return false;current=payload;epoch++;
    if(invoke('open',payload))return true;current=null;inform('sharing.unavailable');return false;
  }
  async function shareStation(){
    if(disposed||sharing)return false;
    let payload;try{payload=publicPayload(getPayload());}catch{/* unavailable selection */}
    if(!payload){inform('sharing.unavailable');return false;}
    const ticket=epoch;sharing=true;
    try{
      if(typeof share!=='function')return open(payload);
      try{await share(payload);return !disposed&&ticket===epoch;}
      catch(error){if(disposed||ticket!==epoch||error?.name==='AbortError')return false;return open(payload);}
    }finally{sharing=false;}
  }
  async function copyLink(){
    if(disposed||copying||!current)return false;
    const payload=current,ticket=epoch;copying=true;
    try{
      if(typeof copy!=='function'){invoke('manual');return false;}
      try{
        await copy(payload.url);if(disposed||ticket!==epoch||current!==payload)return false;
        invoke('copied');inform('sharing.copied');return true;
      }catch{if(!disposed&&ticket===epoch)invoke('manual');return false;}
    }finally{copying=false;}
  }
  function dismiss(){current=null;epoch++;invoke('close');}
  function dispose(){if(disposed)return;disposed=true;dismiss();}
  return Object.freeze({shareStation,copyLink,dismiss,dispose});
}

export function createStationSharing({getStation,notify,documentImpl=globalThis.document,navigatorImpl=globalThis.navigator,eventTarget=globalThis.window}={}){
  const buttons=[...documentImpl?.querySelectorAll('[data-share-station]')||[]],dialog=documentImpl?.getElementById('er-share-dialog');
  if(!buttons.length||!dialog)return{refresh(){},dispose(){}};
  const input=dialog.querySelector('#er-share-url'),station=dialog.querySelector('#er-share-station'),help=dialog.querySelector('#er-share-help'),copyButton=dialog.querySelector('[data-share-copy]'),closeButton=dialog.querySelector('[data-share-close]');
  if(!input||!station||!help||!copyButton||!closeButton)return{refresh(){},dispose(){}};
  let origin=null,disposed=false,share=null,copy=null;
  try{if(typeof navigatorImpl?.share==='function')share=payload=>navigatorImpl.share(payload);}catch{/* optional API */}
  try{if(typeof navigatorImpl?.clipboard?.writeText==='function')copy=value=>navigatorImpl.clipboard.writeText(value);}catch{/* optional permission/capability */}
  const isOpen=()=>dialog.open===true||dialog.hasAttribute('open');
  const payload=()=>stationSharePayload(getStation?.(),{locale:normalizeLocale(documentImpl.documentElement.lang)});
  function message(key){help.dataset.i18n=key;help.textContent=t(key);}
  function selectLink(){input.focus();input.select();}
  function restoreFocus(){
    const candidates=[origin,...buttons,documentImpl.getElementById('er-open-nowplaying')];
    const target=candidates.find(element=>element?.isConnected&&!element.disabled&&element.getClientRects().length);
    target?.focus();
  }
  const controller=createStationSharingController({getPayload:payload,share,copy,notify,text:t,view:{
    open(value){
      station.textContent=value.text;input.value=value.url;message('sharing.help');
      if(!isOpen()){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
      for(const button of buttons)button.setAttribute('aria-expanded','true');selectLink();
    },
    close(){
      if(isOpen()){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
      for(const button of buttons)button.setAttribute('aria-expanded','false');restoreFocus();
    },
    manual(){message('sharing.manual');selectLink();},
    copied(){message('sharing.copied');}
  }});
  function refresh(){
    if(disposed)return;let eligible=false;try{eligible=Boolean(payload());}catch{/* public selection is not yet ready */}
    for(const button of buttons){button.disabled=!eligible;button.setAttribute('aria-label',t('sharing.button'));button.title=t(eligible?'sharing.button':'sharing.unavailable');}
  }
  const open=event=>{origin=event.currentTarget;void controller.shareStation();};
  const copyLink=()=>{void controller.copyLink();},close=()=>controller.dismiss();
  const closed=()=>{if(!isOpen())controller.dismiss();};
  const cancel=event=>{event.preventDefault();event.stopPropagation();controller.dismiss();};
  function keydown(event){
    if(!isOpen())return;
    // Native button/clipboard defaults still run; background transport and modal
    // shortcuts must not react to keys pressed inside the sharing dialog.
    event.stopImmediatePropagation();
    if(event.key==='Escape'){event.preventDefault();controller.dismiss();return;}
    if(event.key!=='Tab')return;
    const targets=[closeButton,input,copyButton].filter(element=>!element.disabled&&element.getClientRects().length),index=targets.indexOf(documentImpl.activeElement);
    if(!targets.length)return;event.preventDefault();event.stopImmediatePropagation();
    targets[(index+(event.shiftKey?-1:1)+targets.length)%targets.length].focus();
  }
  function exit(event){if(!event.persisted)dispose();}
  function dispose(){
    if(disposed)return;disposed=true;controller.dispose();
    for(const button of buttons)button.removeEventListener('click',open);
    copyButton.removeEventListener('click',copyLink);closeButton.removeEventListener('click',close);dialog.removeEventListener('close',closed);dialog.removeEventListener('cancel',cancel);
    documentImpl.removeEventListener('keydown',keydown,true);for(const event of ['earthradio:locale-changed','earthradio:station-selected','earthradio:station-cleared','earthradio:stations-load-settled'])eventTarget?.removeEventListener(event,refresh);eventTarget?.removeEventListener('pagehide',exit);
  }
  for(const button of buttons)button.addEventListener('click',open);
  copyButton.addEventListener('click',copyLink);closeButton.addEventListener('click',close);dialog.addEventListener('close',closed);dialog.addEventListener('cancel',cancel);
  documentImpl.addEventListener('keydown',keydown,true);for(const event of ['earthradio:locale-changed','earthradio:station-selected','earthradio:station-cleared','earthradio:stations-load-settled'])eventTarget?.addEventListener(event,refresh);eventTarget?.addEventListener('pagehide',exit);refresh();
  return Object.freeze({refresh,dispose});
}
