// Versioned public snapshot protocol; deliberately small enough for the edge.
export const SNAPSHOT_ACCEPT='application/vnd.earthradio.catalog.v2+json';
export const SNAPSHOT_MANAGED_BY='earthradio.directory.v2';
export const SNAPSHOT_ROOT='https://protonmatter.github.io/earth-radio/';
export const SNAPSHOT_MAX_BYTES=16*1024*1024;
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;

export function snapshotRepresentation(headers,pathname){
  const accept=String(headers.get('accept')||'');
  if(accept.includes(SNAPSHOT_ACCEPT))return 'catalog';
  // v0.31 explicitly sends application/json for the root, but sends the default
  // Accept for country expansion. Keep both existing response shapes intact.
  return pathname==='/directory/snapshot'&&!accept.includes('application/json')?'catalog':'legacy';
}

export function validateSnapshotManifest(value,{now=Date.now()}={}){
  if(!value||value.schemaVersion!==2||value.managedBy!==SNAPSHOT_MANAGED_BY||!/^\d+\.\d+\.\d+$/.test(value.producerVersion||'')||!/^[a-f0-9]{40}$/.test(value.producerSourceSha||''))throw Error('Invalid snapshot manifest identity');
  const generated=Date.parse(value.generatedAt);
  if(!Number.isFinite(generated)||generated<Date.UTC(2020,0,1)||generated>now+300000||new Date(generated).toISOString()!==value.generatedAt)throw Error('Invalid snapshot generation time');
  const descriptor=(item,maxRecords)=>{
    if(!item||!/^[a-f0-9]{64}$/.test(item.sha256||'')||item.path!==`snapshots/${item.sha256}.json`||!integer(item.bytes,SNAPSHOT_MAX_BYTES)||item.bytes<2||!integer(item.records,maxRecords))throw Error('Invalid snapshot file');
  };
  const fileNames=['catalog','legacy','countries','servers','emptyCatalog','emptyLegacy'];
  if(!value.files||Object.keys(value.files).length!==fileNames.length||Object.keys(value.files).some(name=>!fileNames.includes(name)))throw Error('Unexpected snapshot file entries');
  for(const name of fileNames)descriptor(value.files[name],10000);
  if(!value.byCountry||typeof value.byCountry!=='object'||Array.isArray(value.byCountry)||Object.keys(value.byCountry).length>260)throw Error('Invalid snapshot country index');
  for(const[code,pair]of Object.entries(value.byCountry)){
    if(!/^[A-Z]{2}$/.test(code))throw Error('Invalid snapshot country code');
    if(!pair||Object.keys(pair).length!==2||Object.keys(pair).some(name=>!['catalog','legacy'].includes(name)))throw Error('Unexpected snapshot country files');
    descriptor(pair.catalog,1000);descriptor(pair.legacy,1000);
  }
  for(const key of ['identities','stations','streams','httpOnlyStations'])if(!integer(value.totals?.[key],10000))throw Error('Invalid snapshot totals');
  if(!value.totals.identities||!value.totals.stations||value.totals.stations>value.totals.identities||value.totals.streams>value.totals.identities)throw Error('Empty or inconsistent snapshot totals');
  return value;
}

export function snapshotDescriptor(manifest,pathname,representation='legacy'){
  if(!['catalog','legacy'].includes(representation))return null;
  if(pathname==='/directory/snapshot')return manifest.files[representation];
  if(pathname==='/directory/countries')return manifest.files.countries;
  if(pathname==='/directory/servers')return manifest.files.servers;
  const country=pathname.match(/^\/directory\/country\/([A-Z]{2})$/);
  return country?(manifest.byCountry[country[1]]?.[representation]||manifest.files[representation==='catalog'?'emptyCatalog':'emptyLegacy']):null;
}

export const snapshotEtag=descriptor=>`"directory-${descriptor.sha256}"`;
export function snapshotTagMatches(header,etag){
  return String(header||'').split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag);
}
