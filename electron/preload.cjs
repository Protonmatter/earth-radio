'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function readArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => typeof arg === 'string' && arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const proxyBaseUrl = readArg('earth-radio-proxy-base') || '';

contextBridge.exposeInMainWorld('earthRadio', Object.freeze({
  isDesktop: true,
  proxyBaseUrl,
  version: '0.26.0',
  auth: Object.freeze({
    invoke: (operation, input) => ipcRenderer.invoke('earth-radio:auth', { operation, input }),
    subscribe(callback) {
      if (typeof callback !== 'function') throw new TypeError('Account callback required.');
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('earth-radio:auth-state', listener);
      return () => ipcRenderer.removeListener('earth-radio:auth-state', listener);
    }
  }),
  getProxy: () => ipcRenderer.invoke('earth-radio:get-network-proxy'),
  setProxy: url => ipcRenderer.invoke('earth-radio:set-network-proxy', String(url || '')),
  getLocalProxy: () => Promise.resolve(proxyBaseUrl)
}));
