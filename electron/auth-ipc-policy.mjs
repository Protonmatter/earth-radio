import { AUTH_OPERATIONS, AUTH_MAX_REQUEST_BYTES, PublicAuthError } from './auth-manager.mjs';

function isTrustedDocumentUrl(value, documentUrl) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === documentUrl;
  } catch { return false; }
}

export function installAuthNavigationPolicy(contents, documentUrl) {
  contents.on('will-navigate', event => {
    // Account namespace transitions reload this exact file. Every other file,
    // query-bearing document or remote URL remains blocked.
    if (!isTrustedDocumentUrl(event.url, documentUrl)) event.preventDefault();
  });
  contents.on('will-redirect', event => event.preventDefault());
}

export function isTrustedAuthSender(event, webContents, documentUrl) {
  if (!webContents || webContents.isDestroyed() || event?.sender !== webContents ||
      !event.senderFrame || event.senderFrame !== webContents.mainFrame) return false;
  return isTrustedDocumentUrl(event.senderFrame.url, documentUrl);
}

export async function handleAuthIpc({ event, request, webContents, documentUrl, manager }) {
  try {
    if (!isTrustedAuthSender(event, webContents, documentUrl) || !manager ||
        !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !['operation', 'input'].includes(key)) ||
        !AUTH_OPERATIONS.includes(request.operation) || Buffer.byteLength(JSON.stringify(request)) > AUTH_MAX_REQUEST_BYTES) {
      throw new PublicAuthError('Invalid account request.', 'INVALID_REQUEST');
    }
    return { ok: true, value: await manager.execute(request.operation, request.input) };
  } catch (error) {
    return { ok: false, error: error instanceof PublicAuthError
      ? { message: error.message, code: error.code, status: error.status }
      : { message: 'Account service unavailable. Unlock your keychain and restart Earth Radio.', code: 'AUTH_UNAVAILABLE', status: 0 } };
  }
}
