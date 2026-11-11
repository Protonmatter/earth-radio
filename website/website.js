import {FALLBACK_RELEASE,LATEST_RELEASE_API,normalizePublicRelease,compareReleaseVersions} from './release-core.js';

function presentRelease(release) {
  for(const anchor of document.querySelectorAll('[data-download]')){
    const url=release.downloads[anchor.dataset.download];
    if(url)anchor.href=url;else anchor.removeAttribute('href');
  }
  for(const group of document.querySelectorAll('[data-download-group]'))group.hidden=group.dataset.downloadGroup==='windowsX64'&&!release.downloads.windowsX64Setup;
  for(const element of document.querySelectorAll('[data-release-version]'))element.textContent=release.tag;
  for(const anchor of document.querySelectorAll('[data-release-install]'))anchor.href=release.install;
  for(const anchor of document.querySelectorAll('[data-release-checksums]'))anchor.href=release.checksums;
  for(const anchor of document.querySelectorAll('[data-release-page]'))anchor.href=release.url;
}
async function refreshRelease() {
  presentRelease(FALLBACK_RELEASE);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try{
    const response=await fetch(LATEST_RELEASE_API,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)return;
    const reader=response.body?.getReader();if(!reader)return;
    let length=0,text='';const decoder=new TextDecoder();
    try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>262144){await reader.cancel();return;}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
    finally{reader.releaseLock();}
    const release=normalizePublicRelease(JSON.parse(text));if(release&&compareReleaseVersions(release.version,FALLBACK_RELEASE.version)>=0)presentRelease(release);
  }catch{/* Verified fallback remains usable when the public API is unavailable. */}
  finally{clearTimeout(timer);}
}
if(typeof document!=='undefined'){
  const revealInstall=()=>{if(window.location.hash==='#iphone-install')document.getElementById('iphone-install').open=true;};
  window.addEventListener('hashchange',revealInstall);revealInstall();void refreshRelease();
}
