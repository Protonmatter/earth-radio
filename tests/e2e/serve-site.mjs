// Minimal static file server for Playwright runs against the site/ directory.
// No dependencies; loopback only.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const websiteRoot = path.resolve(root, '..', '.build', 'website');
const port = Number(process.env.E2E_PORT || 4173);

const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}));

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if(pathname.startsWith('/assets/map-')){
      const rules=await readFile(path.join(root,'_redirects'),'utf8');
      const rule=rules.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(parts=>parts[0]===pathname);
      if(rule){res.writeHead(Number(rule[2]),{location:rule[1]}).end();return;}
    }
    const website = pathname.startsWith('/__website/');
    const selectedRoot = website ? websiteRoot : root;
    let relative = (website ? pathname.slice('/__website'.length) : pathname).replace(/\/+$/, '') || '/';
    if (website && relative === '/privacy') relative = '/privacy.html';
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
    res.end(data);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    } else {
      console.error('e2e server error:', error?.message || error);
      res.writeHead(500, { 'content-type': 'text/plain' }).end('server error');
    }
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`e2e site server on http://127.0.0.1:${port}`);
});
