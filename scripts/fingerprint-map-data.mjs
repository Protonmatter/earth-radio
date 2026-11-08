import {readFile,writeFile,rename,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),metadata=path.join(root,'docs/provenance/map-data.json');
const provenance=JSON.parse(await readFile(metadata,'utf8'));
for(const row of provenance.outputs){
  const kind=row.path.match(/^site\/assets\/map-(world|detail|terrain|roads)(?:-[a-f0-9]{8})?\.js$/)?.[1];if(!kind)throw Error('Unexpected map output');
  const bytes=await readFile(path.join(root,row.path)),sha=createHash('sha256').update(bytes).digest('hex');if(sha!==row.sha256||bytes.length!==row.bytes)throw Error('Map output integrity failed');
  const next=`site/assets/map-${kind}-${sha.slice(0,8)}.js`;if(next===row.path)continue;
  let exists=false;try{await access(path.join(root,next));exists=true;}catch{/* New hash has not been emitted. */}if(exists)throw Error('Refusing existing output overwrite');
  // Both named files are direct children of this repository's site/assets.
  await rename(path.join(root,row.path),path.join(root,next));
  for(const relative of ['site/assets/vector-atlas.js','tests/e2e/map-labels.spec.mjs']){
    const file=path.join(root,relative),source=await readFile(file,'utf8');
    await writeFile(file,source.replaceAll(path.basename(row.path),relative.startsWith('tests/')?`map-${kind}*.js`:path.basename(next)));
  }
  const headers=path.join(root,'site/_headers');await writeFile(headers,(await readFile(headers,'utf8'))+`\n/assets/${path.basename(next)}\n  Cache-Control: public, max-age=31536000, immutable\n`);
  row.path=next;
}
await writeFile(metadata,JSON.stringify(provenance,null,2)+'\n');
console.log(provenance.outputs.map(row=>({path:row.path,sha256:row.sha256})));
