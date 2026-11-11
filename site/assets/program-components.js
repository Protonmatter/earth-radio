// Conservative station-family/shared-stream components. No I/O, clock, identity
// rewriting or input mutation. City selection and offline qualification share it.
import {groupStationVariants} from './station-variants.js?v=0.33.0';
import {streamIdentity} from './discovery-core.js?v=0.33.0';

const canonicalId=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value.toLowerCase():value;
const compare=(a,b)=>a<b?-1:a>b?1:0;
// Existing readers: 10k root +20x1k country shards +2 pins +10k mapped rows.
// Native seed input remains separately restricted to 6500 prefix +10000 root.
export const MAX_PROGRAM_OBSERVATIONS=50000;

// Opt-in native sampling carries full-root evidence, never a replacement UUID or
// a playback recovery group. Invalid present evidence fails city qualification.
export function nativeProgramSupport(station){
 const value=station?.nativeProgram;
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string'||!value.id||value.id.length>160||value.id.trim()!==value.id||
    value.cityId!==null&&(typeof value.cityId!=='string'||!/^ne-\d{1,16}$/.test(value.cityId)))return null;
 return{id:canonicalId(value.id),cityId:value.cityId};
}

export function programComponents(stations){
 if(!Array.isArray(stations)||stations.length>MAX_PROGRAM_OBSERVATIONS)throw TypeError(`Expected at most ${MAX_PROGRAM_OBSERVATIONS} station observations`);
 const rows=stations.filter(row=>row&&typeof row==='object'&&typeof row.stationuuid==='string'&&row.stationuuid&&typeof row.name==='string'&&row.name.trim()&&streamIdentity(row));
 const groups=groupStationVariants(rows),parent=rows.map((_,index)=>index),ids=new Map(),streams=new Map(),nativeComponents=new Map();
 const find=value=>{let root=value;while(parent[root]!==root)root=parent[root];while(parent[value]!==value){const next=parent[value];parent[value]=root;value=next;}return root;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
 rows.forEach((row,index)=>{
  const id=canonicalId(row.stationuuid);if(ids.has(id))join(index,ids.get(id));else ids.set(id,index);
  const key=streamIdentity(row);if(streams.has(key))join(index,streams.get(key));else streams.set(key,index);
  const support=nativeProgramSupport(row);
  if(support){if(nativeComponents.has(support.id))join(index,nativeComponents.get(support.id));else nativeComponents.set(support.id,index);}
 });
 for(const group of groups){const members=group.memberIds.map(id=>ids.get(canonicalId(id)));for(const member of members.slice(1))join(members[0],member);}
 const byRoot=new Map();rows.forEach((row,index)=>{const key=find(index);if(!byRoot.has(key))byRoot.set(key,[]);byRoot.get(key).push(row);});
 const components=[...byRoot.values()].map(component=>component.sort((a,b)=>compare(canonicalId(a.stationuuid),canonicalId(b.stationuuid))||compare(JSON.stringify(a),JSON.stringify(b))))
  .sort((a,b)=>compare(canonicalId(a[0].stationuuid),canonicalId(b[0].stationuuid)));
 return{groups,components,identityCount:ids.size};
}
