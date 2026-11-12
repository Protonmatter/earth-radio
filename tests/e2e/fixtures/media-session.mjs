export async function installNativeMediaCapture(page){
  await page.addInitScript(()=>{
    window.fixtureNativeMediaHandlers={};
    window.fixtureNativeMediaRegistration={};
    window.fixtureNativeMediaApi=Boolean(navigator.mediaSession&&typeof MediaMetadata==='function');
    if(!navigator.mediaSession)return;
    // A per-instance expando can be lost when a DOM wrapper is renewed. Observe
    // the shared native prototype and preserve its receiver/return/exception.
    const prototype=Object.getPrototypeOf(navigator.mediaSession),set=prototype.setActionHandler;
    Object.defineProperty(prototype,'setActionHandler',{configurable:true,value(action,handler){
      try{
        const result=Reflect.apply(set,this,[action,handler]);
        window.fixtureNativeMediaRegistration[action]={registered:true};window.fixtureNativeMediaHandlers[action]=handler;return result;
      }catch(error){
        window.fixtureNativeMediaRegistration[action]={registered:false,errorName:String(error?.name||''),message:String(error?.message||'').slice(0,256)};
        throw error;
      }
    }});
  });
}
export const readNativeMediaFields=page=>page.evaluate(()=>{
  const value=navigator.mediaSession?.metadata;
  return value?{title:value.title,artist:value.artist,album:value.album}:null;
});
