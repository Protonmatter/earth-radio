const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:']);

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
