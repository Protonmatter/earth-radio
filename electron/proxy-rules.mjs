const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:']);

// File-renderer GETs can omit Origin in Electron. Assert the opaque file Origin
// only for the known packaged frame, owned window, and exact capability API.
// The proxy continues to require both its unpredictable route and an allowed Origin.
export function withDesktopProxyOrigin({ requestUrl, proxyBaseUrl, requestHeaders,
  webContentsId, expectedWebContentsId, documentUrl, expectedDocumentUrl }) {
  if (!Number.isInteger(expectedWebContentsId) || expectedWebContentsId <= 0 || webContentsId !== expectedWebContentsId ||
    !requestHeaders || typeof requestHeaders !== 'object' || Array.isArray(requestHeaders) ||
    Object.keys(requestHeaders).some(name => name.toLowerCase() === 'origin')) return requestHeaders;
  try {
    const request = new URL(requestUrl), proxy = new URL(proxyBaseUrl);
    const document = new URL(documentUrl), expected = new URL(expectedDocumentUrl);
    document.hash = ''; document.search = ''; expected.hash = ''; expected.search = '';
    if (document.protocol !== 'file:' || expected.protocol !== 'file:' || document.href !== expected.href ||
      proxy.protocol !== 'http:' || proxy.hostname !== '127.0.0.1' || !proxy.port || proxy.username || proxy.password || proxy.search || proxy.hash ||
      !/^\/[A-Za-z0-9_-]{32,}$/.test(proxy.pathname) || request.origin !== proxy.origin || request.username || request.password ||
      !request.pathname.startsWith(`${proxy.pathname}/api/`)) return requestHeaders;
    return { ...requestHeaders, Origin: 'null' };
  } catch { return requestHeaders; }
}

export function installDesktopProxyOrigin(session, { proxyBaseUrl, webContents, expectedDocumentUrl }) {
  session.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    let documentUrl = '';
    try { documentUrl = details.frame?.url || ''; } catch { /* A destroyed frame is not authorized. */ }
    callback({ requestHeaders: withDesktopProxyOrigin({ requestUrl: details.url, proxyBaseUrl,
      requestHeaders: details.requestHeaders, webContentsId: details.webContentsId,
      expectedWebContentsId: webContents.isDestroyed() ? -1 : webContents.id,
      documentUrl, expectedDocumentUrl }) });
  });
}

export function parseNetworkProxyRule(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value || value.toLowerCase() === 'direct') return value.toLowerCase();

  const hasScheme = value.includes('://');
  let parsed;
  try {
    parsed = new URL(hasScheme ? value : `http://${value}`);
  } catch {
    throw invalidProxyRule();
  }
  const hasUnexpectedPath = parsed.pathname !== '' && parsed.pathname !== '/';
  if ((hasScheme && !ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) || !parsed.hostname ||
      !explicitPort(value, parsed, hasScheme) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || hasUnexpectedPath) {
    throw invalidProxyRule();
  }
  return value;
}

function explicitPort(value, parsed, hasScheme) {
  if (parsed.port) return parsed.port;
  const hostPart = hasScheme ? value.slice(value.indexOf('://') + 3) : value;
  if (hostPart.startsWith('[')) {
    const close = hostPart.indexOf(']');
    if (close === -1) return '';
    const match = hostPart.slice(close + 1).match(/^:(\d{1,5})(?=[/?#]|$)/);
    return match ? match[1] : '';
  }
  const match = hostPart.match(/^[^/?#]*:(\d{1,5})(?=[/?#]|$)/);
  return match ? match[1] : '';
}

function invalidProxyRule() {
  return new Error('Invalid proxy rule. Use direct, host:port, http://host:port, https://host:port, or socks5://host:port.');
}
