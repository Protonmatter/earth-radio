// Build distinct architecture artifacts; a multi-arch NSIS invocation may also
// emit a combined installer. This wrapper forwards the same config to both runs.
import {spawn} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function runBuilder(args,{root,arch}){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'node_modules/electron-builder/cli.js'),...args],{
      cwd:root,stdio:'inherit',windowsHide:true,timeout:20*60*1000,killSignal:'SIGTERM'});
    child.once('error',reject);
    child.once('close',(code,signal)=>code===0?resolve():reject(Error(`Windows ${arch} packaging failed (${signal||code})`)));
  });
}

export async function buildWindows({root=path.resolve(import.meta.dirname,'..'),configPath,run=runBuilder}={}){
  root=path.resolve(root);const options=[];
  if(configPath){
    const file=path.resolve(root,configPath),entry=await lstat(file),relative=path.relative(await realpath(root),await realpath(file));
    if(!entry.isFile()||entry.isSymbolicLink()||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Windows build config must be a regular file inside the repository');
    options.push('--config',file);
  }
  for(const arch of ['arm64','x64'])await run(['--win','--'+arch,...options,'--publish','never'],{root,arch});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);if(args.length&&(args.length!==2||args[0]!=='--config'))throw Error('Usage: build-windows.mjs [--config repository-relative-config.json]');
    await buildWindows({configPath:args[1]});
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
