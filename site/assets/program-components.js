// Conservative station-family/shared-stream components. No I/O, clock, identity
// rewriting or input mutation. City selection and offline qualification share it.
import {groupStationVariants} from './station-variants.js?v=0.32.2';
import {streamIdentity} from './discovery-core.js?v=0.32.2';

const canonicalId=value=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value.toLowerCase():value;
const compare=(a,b)=>a<b?-1:a>b?1:0;

export function programComponents(stations){
 if(!Array.isArray(stations)||stations.length>20000)throw TypeError('Expected at most 20000 station observations');
 const rows=stations.filter(row=>row&&typeof row==='object'&&typeof row.stationuuid==='string'&&row.stationuuid&&typeof row.name==='string'&&row.name.trim()&&streamIdentity(row));
 const groups=groupStationVariants(rows),parent=rows.map((_,index)=>index),ids=new Map(),streams=new Map();
 const find=value=>{let root=value;while(parent[root]!==root)root=parent[root];while(parent[value]!==value){const next=parent[value];parent[value]=root;value=next;}return root;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
 rows.forEach((row,index)=>{
  const id=canonicalId(row.stationuuid);if(ids.has(id))join(index,ids.get(id));else ids.set(id,index);
  const key=streamIdentity(row);if(streams.has(key))join(index,streams.get(key));else streams.set(key,index);
 });
 for(const group of groups){const members=group.memberIds.map(id=>ids.get(canonicalId(id)));for(const member of members.slice(1))join(members[0],member);}
 const byRoot=new Map();rows.forEach((row,index)=>{const key=find(index);if(!byRoot.has(key))byRoot.set(key,[]);byRoot.get(key).push(row);});
 const components=[...byRoot.values()].map(component=>component.sort((a,b)=>compare(canonicalId(a.stationuuid),canonicalId(b.stationuuid))||compare(JSON.stringify(a),JSON.stringify(b))))
  .sort((a,b)=>compare(canonicalId(a[0].stationuuid),canonicalId(b[0].stationuuid)));
 return{groups,components,identityCount:ids.size};
}
