import {createStationShareRoute} from '../_shared/share-document.js';
const share=createStationShareRoute();
export function onRequest(context){
  const host=new URL(context.request.url).hostname;
  // Both Pages projects share a repository; station app documents never replace
  // the marketing site's static404 contract or its future SEO pages.
  if(host==='earthradio.stream'||host==='www.earthradio.stream'||host==='earth-radio-website.pages.dev'||host.endsWith('.earth-radio-website.pages.dev'))return context.next();
  return share(context);
}
