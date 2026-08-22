// Example integration for the existing Earth Radio proxy/server.
// Import `handleTrackIdentify` and mount it before your static file handler.

import { identifyTrack } from './metadata-providers.mjs';

export async function handleTrackIdentify(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/track/identify') return false;

  const providers = String(url.searchParams.get('providers') || 'itunes,spotify')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const payload = await identifyTrack({
    artist: url.searchParams.get('artist') || '',
    title: url.searchParams.get('title') || '',
    raw: url.searchParams.get('raw') || '',
    country: url.searchParams.get('country') || 'US',
    providers
  });

  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': payload.found ? 'public, max-age=86400' : 'public, max-age=900',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(payload));
  return true;
}
