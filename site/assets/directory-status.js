import {getLocale,t} from '../i18n/index.js?v=0.32.0';
export function directorySnapshotStale(metadata,now=Date.now()){
  const generated=Date.parse(metadata?.generatedAt);return Number.isFinite(generated)&&now-generated>7200000;
}
export function directorySnapshotStatus(result,count,locale=getLocale()){
  const time=Date.parse(result?.directorySnapshot?.generatedAt);if(!Number.isFinite(time))return null;
  let updated;try{updated=new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC',timeZoneName:'short'}).format(time);}catch{updated=new Date(time).toISOString();}
  return t('discovery.snapshotStatus',{count:Number(count).toLocaleString(locale),updated})+(result.stale||directorySnapshotStale(result.directorySnapshot)?' · '+t('discovery.savedCopy'):'');
}
