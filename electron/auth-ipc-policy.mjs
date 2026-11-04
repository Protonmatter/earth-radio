import { AUTH_OPERATIONS, AUTH_MAX_REQUEST_BYTES, PublicAuthError } from './auth-manager.mjs';

export function isTrustedAuthSender(event, webContents, documentUrl) {
  if (!webContents || webContents.isDestroyed() || event?.sender !== webContents ||
      !event.senderFrame || event.senderFrame !== webContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    url.hash = '';
    return url.href === documentUrl;
  } catch { return false; }
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
