// Minimal static file server for Playwright runs against the site/ directory.
// No dependencies; loopback only.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { silentWav } from './fixtures/silent-media.mjs';
import {SHARING_STATIONS} from './fixtures/sharing.mjs';
import {createStationShareRoute} from '../../functions/_shared/share-document.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const websiteRoot = path.resolve(root, '..', '.build', 'website');
const port = Number(process.env.E2E_PORT || 4173);

const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}));

export function createSiteServer({appRoot=root,marketingRoot=websiteRoot,shareLookup=async id=>SHARING_STATIONS.find(row=>row.stationuuid===id)||null}={}) {
 let mediaFixture;
 const stationShare=createStationShareRoute({lookup:shareLookup});
 return createServer(async (req, res) => {
  let selectedRoot=path.resolve(appRoot);
  try {
    const rawPathname = new URL(req.url || '/', 'http://localhost').pathname;
    // Execute the real generated-document handler. Only its public lookup and
    // static asset binding are controlled; no separate mock HTML implementation.
    if(rawPathname.startsWith('/s/')){
      const origin='http://127.0.0.1:'+req.socket.localPort;
      const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers});
      const response=await stationShare({request,env:{ASSETS:{async fetch(assetRequest){
        if(new URL(assetRequest.url).pathname!=='/')return new Response('missing',{status:404});
        return new Response(await readFile(path.join(appRoot,'index.html')),{headers:{'content-type':'text/html; charset=utf-8'}});
      }}}});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));return;
    }
    const pathname = decodeURIComponent(rawPathname);
    // WebKit's media process may bypass page.route. Keep this PCM fixture on
    // the loopback test server; it is never staged into the public application.
    if(pathname==='/__test-media-session.wav'){
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'}).end();return;}
      mediaFixture??=silentWav(120);
      const length=mediaFixture.length,headers={'content-type':'audio/wav','cache-control':'no-store','accept-ranges':'bytes'};
      let start=0,end=length-1,status=200;
      if(req.headers.range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if(!match||(!match[1]&&!match[2])||match.slice(1).some(value=>value&&!Number.isSafeInteger(Number(value)))){res.writeHead(416,{...headers,'content-range':`bytes */${length}`}).end();return;}
        start=match[1]?Number(match[1]):Math.max(0,length-Number(match[2]));
        end=match[1]&&match[2]?Math.min(Number(match[2]),length-1):length-1;
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=length||end<start||(!match[1]&&Number(match[2])===0)){
          res.writeHead(416,{...headers,'content-range':`bytes */${length}`}).end();return;
        }
        status=206;headers['content-range']=`bytes ${start}-${end}/${length}`;
      }
      res.writeHead(status,{...headers,'content-length':end-start+1}).end(req.method==='HEAD'?undefined:mediaFixture.subarray(start,end+1));return;
    }
    const website = pathname.startsWith('/__website/');
    selectedRoot = path.resolve(website ? marketingRoot : appRoot);
    let relative = (website ? pathname.slice('/__website'.length) : pathname).replace(/\/+$/, '') || '/';
    if(relative==='/privacy.html'||relative==='/404.html'){res.writeHead(308,{location:(website?'/__website':'')+relative.slice(0,-5)}).end();return;}
    if(relative==='/privacy'||relative==='/404')relative+='.html';
    const rules=await readFile(path.join(selectedRoot,'_redirects'),'utf8');
    const rule=rules.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(parts=>parts[0]===relative&&/^30[1278]$/.test(parts[2]));
    if(rule){res.writeHead(Number(rule[2]),{location:rule[1]}).end();return;}
    const target = path.normalize(path.join(selectedRoot, relative === '/' ? 'index.html' : relative));
    // Percent-encoded dot segments decode after URL normalization; re-check containment
    // with a separator suffix so sibling directories sharing the prefix stay unreachable.
    if (target !== selectedRoot && !target.startsWith(selectedRoot + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': types.get(path.extname(target)) || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(req.method==='HEAD'?undefined:data);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      // Match Pages' documented top-level 404 contract instead of synthesizing a
      // success response for an unknown route. Live readback is still required.
      try {
        let missing=await readFile(path.join(selectedRoot,'404.html'));
        // /__website is a local stand-in for the marketing origin. Preserve the
        // document's root-based links in that namespace; production is at /.
        if(new URL(req.url,'http://localhost').pathname.startsWith('/__website/'))missing=Buffer.from(missing.toString('utf8').replaceAll('="/','="/__website/'));
        res.writeHead(404,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(req.method==='HEAD'?undefined:missing);
      }catch{res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');}
    } else if(error instanceof URIError) {
      res.writeHead(400,{'content-type':'text/plain'}).end('invalid path');
    } else {
      console.error('e2e server error:', error?.message || error);
      res.writeHead(500, { 'content-type': 'text/plain' }).end('server error');
    }
  }
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))createSiteServer().listen(port, '127.0.0.1', () => {
  console.log(`e2e site server on http://127.0.0.1:${port}`);
});
