import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
export const INSTALL_TIMEOUT_MS=180000;
export function installPinnedElectron({spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    // The official installer verifies against the checksums bundled in the
    // locked npm package. Do not switch to remotely supplied checksum data.
    const env={...process.env,electron_use_remote_checksums:'',npm_config_electron_use_remote_checksums:''};
    const child=spawnImpl(process.execPath,[path.join(root,'node_modules/electron/install.js')],{cwd:root,env,stdio:'inherit',timeout:INSTALL_TIMEOUT_MS,killSignal:'SIGTERM'});
    child.once('error',reject);
    child.once('close',(code,signal)=>code===0?resolve():reject(Error(`Pinned Electron installer failed (${signal||code})`)));
  });
}
export async function ensureElectronRuntime({install=installPinnedElectron,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}){
  for(let attempt=1;attempt<=3;attempt++){
    try{await install();return;}
    catch(error){if(attempt===3)throw error;onRetry(attempt);await delay(attempt*1000);}
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{
    const expected=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).devDependencies.electron;
    const installed=JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version;
    if(!/^\d+\.\d+\.\d+$/.test(expected)||installed!==expected)throw Error('Electron package does not match the exact repository pin');
    await ensureElectronRuntime({onRetry:attempt=>console.log(`Retrying pinned Electron acquisition after attempt ${attempt}`)});
    console.log(`Pinned Electron ${installed} runtime ready`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
