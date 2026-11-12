export async function installNativeMediaCapture(page){
  await page.addInitScript(()=>{
    window.fixtureNativeMediaHandlers={};
    window.fixtureNativeMediaApi=Boolean(navigator.mediaSession&&typeof MediaMetadata==='function');
    if(!navigator.mediaSession)return;
    const session=navigator.mediaSession,set=session.setActionHandler.bind(session);
    Object.defineProperty(session,'setActionHandler',{configurable:true,value(action,handler){
      const result=set(action,handler);window.fixtureNativeMediaHandlers[action]=handler;return result;
    }});
  });
}
export const readNativeMediaFields=page=>page.evaluate(()=>{
  const value=navigator.mediaSession?.metadata;
  return value?{title:value.title,artist:value.artist,album:value.album}:null;
});
