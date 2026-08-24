// Minimal standalone metadata proxy for local validation:
//   SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... node server/example-proxy.mjs
// Optional fingerprint credentials: ACR_HOST/ACR_ACCESS_KEY/ACR_ACCESS_SECRET or AUDD_API_TOKEN.

import http from 'node:http';
import { handleMetadataApi } from './metadata-api.mjs';

const port = Number(process.env.PORT || 8787);

http.createServer(async (req, res) => {
  try {
    if (await handleMetadataApi(req, res)) return;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error?.message || 'internal error' }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Earth Radio metadata proxy listening on http://127.0.0.1:${port}`);
});
