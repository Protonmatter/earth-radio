import http from 'node:http';
import { randomBytes } from 'node:crypto';

// A listener belongs to one PKCE attempt. The nonce is a second binding in
// addition to PKCE; it is never published to the renderer or written to disk.
export async function beginAuthCallback({ onCode, timeoutMs = 10 * 60 * 1000 } = {}) {
  if (typeof onCode !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10 * 60 * 1000) {
    throw new Error('Invalid sign-in callback configuration.');
  }
  const pathname = `/earth-radio-auth/callback/${randomBytes(32).toString('base64url')}`;
  let host, timer, consumed = false, settled = false, closing;
  let accept, reject;
  const result = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
  // Email sends can finish before the consumer attaches its completion handler.
  result.catch(() => {});
  function finish(error, value) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error); else accept(value);
  }
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    function reply(status, text) {
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff', Connection: 'close'
      });
      res.end(text);
    }
    if (req.headers.host !== host || req.headers.origin) return reply(400, 'Invalid callback request.');
    if (Buffer.byteLength(req.url || '') > 4096) return reply(414, 'Callback request too large.');
    if (!req.url?.startsWith('/')) return reply(400, 'Invalid callback request.');
    let url;
    try { url = new URL(req.url, `http://${host}`); } catch { return reply(400, 'Invalid callback request.'); }
    if (url.origin !== `http://${host}` || url.pathname !== pathname) return reply(404, 'Not found.');
    if (req.method !== 'GET') return reply(405, 'Use the sign-in browser link.');
    if (consumed || settled) return reply(409, 'This sign-in attempt has already finished.');
    const keys = [...url.searchParams.keys()];
    const code = url.searchParams.get('code');
    const denied = url.searchParams.get('error');
    if (new Set(keys).size !== keys.length || keys.some(key => !['code', 'error', 'error_code', 'error_description'].includes(key)) ||
        Boolean(code) === Boolean(denied) || (code && (code.length > 2048 || /[\s\x00-\x1f\x7f]/.test(code)))) {
      return reply(400, 'Invalid callback request.');
    }
    consumed = true;
    try {
      if (denied) throw new Error('Sign-in was not completed. Please try again.');
      const value = await onCode(code);
      if (settled) return;
      reply(200, 'Earth Radio sign-in completed. You can close this tab and return to the app.');
      finish(null, value);
    } catch {
      if (!settled) {
        reply(400, 'Sign-in was not completed. Return to Earth Radio and try again.');
        finish(new Error('Sign-in was not completed. Please try again.'));
      }
    } finally {
      // Let the response flush before closing its socket.
      res.once('finish', () => { void close(); });
      if (res.writableFinished) void close();
    }
  });
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.on('error', () => { finish(new Error('Sign-in callback unavailable. Please try again.')); void close(); });
  await new Promise((resolve, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); resolve(); });
  });
  host = `127.0.0.1:${server.address().port}`;
  async function close() {
    if (!settled) finish(new Error('Sign-in canceled. Please start again.'));
    if (!closing) closing = new Promise(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closing;
  }
  timer = setTimeout(() => { finish(new Error('Sign-in expired. Please start again.')); void close(); }, timeoutMs);
  timer.unref();
  return { url: `http://${host}${pathname}`, result, close, cancel: close };
}
