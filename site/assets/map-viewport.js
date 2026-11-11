import {ATLAS_MIN_LATITUDE,ATLAS_MAX_LATITUDE} from './station-location.js?v=0.32.2';

const mercatorY=latitude=>(1-Math.log(Math.tan(Math.PI/4+latitude*Math.PI/360))/Math.PI)/2;
const latitudeAt=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
const north=mercatorY(ATLAS_MAX_LATITUDE),south=mercatorY(ATLAS_MIN_LATITUDE);
const controllers=new WeakMap();
export function atlasViewAction(map,action){const controller=controllers.get(map);return controller?controller.run(action):action();}

export function minimumAtlasZoom(height){
  if(!Number.isFinite(height)||height<=0)return 1;
  // A one-pixel margin at each edge absorbs Leaflet's pixel-origin rounding.
  return Math.max(1,Math.min(7,Math.ceil(Math.log2((height+2)/(256*(south-north)))*4)/4));
}

export function atlasCenter(center,zoom,height){
  const input=Array.isArray(center)&&center.length===2&&center.every(Number.isFinite)?center:[25,5];
  const scale=256*2**Math.max(minimumAtlasZoom(height),Number.isFinite(zoom)?zoom:1);
  const half=(Math.max(0,Number.isFinite(height)?height:0)/2+1)/scale;
  const lower=north+half,upper=south-half;
  const y=mercatorY(Math.max(ATLAS_MIN_LATITUDE,Math.min(ATLAS_MAX_LATITUDE,input[0])));
  return [latitudeAt(Math.max(lower,Math.min(upper,y))),input[1]];
}

export function installMapViewport(map){
  if(controllers.has(map))return controllers.get(map);
  const container=map.getContainer();let correcting=false,lastSize='';
  const refresh=()=>{
    if(correcting||!container.clientHeight||!container.clientWidth)return;
    const height=container.clientHeight,size=`${container.clientWidth}:${height}`;
    const minimum=minimumAtlasZoom(height),zoom=Math.max(map.getZoom(),minimum);
    const current=map.getCenter(),center=atlasCenter([current.lat,current.lng],zoom,height);
    if(size!==lastSize||map.getMinZoom()!==minimum||zoom!==map.getZoom()||Math.abs(center[0]-current.lat)>1e-7){
      correcting=true;const bounds=map.options.maxBounds;
      // Stop with the bounds handler suspended, as in the discovery adapter's
      // settledMapAction; otherwise moveend can recursively start another pan.
      map.setMaxBounds(null);
      try{
        map.stop();map.invalidateSize({pan:false});map.options.zoomSnap=0.25;
        // Raising minZoom first starts Leaflet's default CSS zoom. While that
        // transition is active, Leaflet ignores even animate:false Fit requests.
        // Establish the bounded view synchronously before installing its minimum.
        map.setView(center,zoom,{animate:false,reset:true});map.setMinZoom(minimum);lastSize=size;
      }finally{map.setMaxBounds(bounds);correcting=false;}
    }
    const bounds=map.getBounds();
    container.dispatchEvent(new CustomEvent('earthradio:map-viewport',{bubbles:true,detail:{south:bounds.getSouth(),north:bounds.getNorth(),minimumZoom:minimum,zoom:map.getZoom()}}));
  };
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(refresh):null;
  observer?.observe(container);map.on('resize moveend zoomend',refresh);map.whenReady(refresh);
  const dispose=()=>{observer?.disconnect();map.off('resize moveend zoomend',refresh);controllers.delete(map);};
  const run=action=>{const wasCorrecting=correcting;correcting=true;try{return action();}finally{correcting=wasCorrecting;if(!wasCorrecting)refresh();}};
  map.once('unload',dispose);const controller={refresh,dispose,run};controllers.set(map,controller);return controller;
}
