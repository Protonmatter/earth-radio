import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { initBrandIdentity } from '../site/assets/brand-identity.js';

test('Windows native identity contains bounded 32-bit PNG entries through 256 pixels', async () => {
  const bytes = await readFile(new URL('../site/branding/earth-radio-desktop.ico', import.meta.url));
  assert.equal(bytes.readUInt16LE(0), 0); assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4), sizes = []; let end = 6 + count * 16;
  assert.ok(count > 0 && count <= 16);
  for (let i = 0; i < count; i++) {
    const header = 6 + i * 16, width = bytes[header] || 256, height = bytes[header + 1] || 256;
    const length = bytes.readUInt32LE(header + 8), offset = bytes.readUInt32LE(header + 12);
    assert.equal(width, height); assert.equal(bytes.readUInt16LE(header + 6), 32);
    assert.ok(offset >= end && length >= 24 && offset + length <= bytes.length);
    assert.equal(bytes.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(offset + 16), width); assert.equal(bytes.readUInt32BE(offset + 20), height);
    sizes.push(width); end = offset + length;
  }
  assert.equal(end, bytes.length); assert.ok(sizes.includes(16) && sizes.includes(32) && sizes.includes(256));
});

test('native packaging and window icons use the approved precision identity', async () => {
  const text = async relative => readFile(new URL(relative, import.meta.url), 'utf8');
  assert.match(await text('../electron-builder.yml'), /icon: site\/branding\/earth-radio-desktop\.ico/);
  const shell = await text('../electron/main.mjs');
  assert.match(shell, /earth-radio-desktop\.ico/); assert.match(shell, /earth-radio-app-icon-512\.png/);
  const mac = await text('../scripts/macos-release.mjs');
  assert.match(mac, /'site', 'branding', 'earth-radio-app-icon-512\.png'/);
  assert.match(mac, /packagedIconSha256/);
});

function fixture({ audio = true, brand = true, icons = true } = {}) {
  const classes = new Set(['earth-radio-brand']);
  const logo = {
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  const player = Object.assign(new EventTarget(), {
    paused: true, ended: false, seeking: false, error: null, readyState: 0,
    src: 'https://stream.example.invalid/radio', volume: 0.6, muted: false,
    play() { throw new Error('The branding controller must not start playback'); },
    pause() { throw new Error('The branding controller must not pause playback'); }
  });
  const links = ['16', '32', 'svg'].map(size => ({
    dataset: {
      earthRadioIcon: size,
      light: `./branding/earth-radio-favicon-pine-${size}`,
      dark: `./branding/earth-radio-favicon-obsidian-${size}`
    },
    href: `./branding/earth-radio-favicon-pine-${size}`,
    setAttribute(name, value) { this[name] = value; }
  }));
  const document = {
    getElementById(id) { return audio && id === 'audio-player' ? player : null; },
    querySelectorAll(selector) {
      if (selector === '.earth-radio-brand') return brand ? [logo] : [];
      if (selector === 'link[data-earth-radio-icon]') return icons ? links : [];
      return [];
    }
  };
  return { document, player, logo, links };
}

test('the logo starts only when playback begins and stops while audio cannot play', () => {
  const page = fixture();
  initBrandIdentity(page.document, {});
  const playing = () => page.logo.classList.contains('is-playing');
  assert.equal(playing(), false);

  page.player.paused = false;
  page.player.dispatchEvent(new Event('play'));
  assert.equal(playing(), false, 'a play request alone is not confirmed playback');

  for (const event of ['pause', 'waiting', 'ended', 'emptied', 'error', 'loadstart', 'seeking']) {
    page.player.dispatchEvent(new Event('playing'));
    assert.equal(playing(), true);
    page.player.dispatchEvent(new Event(event));
    assert.equal(playing(), false, `${event} must return the mark to its static form`);
  }
  assert.equal(page.player.src, 'https://stream.example.invalid/radio');
  assert.equal(page.player.volume, 0.6);
  assert.equal(page.player.muted, false);
});

test('a network stall preserves motion while buffered audio is still playing', () => {
  const page = fixture();
  initBrandIdentity(page.document, {});
  page.player.dispatchEvent(new Event('playing'));
  page.player.dispatchEvent(new Event('stalled'));
  assert.equal(page.logo.classList.contains('is-playing'), true);

  page.player.dispatchEvent(new Event('waiting'));
  page.player.dispatchEvent(new Event('stalled'));
  assert.equal(page.logo.classList.contains('is-playing'), false);
});

test('late initialization recognizes playable audio without mistaking buffering for playback', () => {
  for (const [state, expected] of [
    [{ paused: false, readyState: 3 }, true],
    [{ paused: false, readyState: 2 }, false],
    [{ paused: true, readyState: 4 }, false],
    [{ paused: false, readyState: 4, ended: true }, false],
    [{ paused: false, readyState: 4, seeking: true }, false],
    [{ paused: false, readyState: 4, error: { code: 2 } }, false]
  ]) {
    const page = fixture();
    Object.assign(page.player, state);
    initBrandIdentity(page.document, {});
    assert.equal(page.logo.classList.contains('is-playing'), expected, JSON.stringify(state));
  }
});

test('favicons follow the OS color scheme on startup and subsequent changes', () => {
  const page = fixture();
  const media = Object.assign(new EventTarget(), { matches: true });
  initBrandIdentity(page.document, {
    matchMedia(query) {
      assert.equal(query, '(prefers-color-scheme: dark)');
      return media;
    }
  });
  assert.deepEqual(page.links.map(link => link.href), [
    './branding/earth-radio-favicon-obsidian-16',
    './branding/earth-radio-favicon-obsidian-32',
    './branding/earth-radio-favicon-obsidian-svg'
  ]);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  assert.deepEqual(page.links.map(link => link.href), [
    './branding/earth-radio-favicon-pine-16',
    './branding/earth-radio-favicon-pine-32',
    './branding/earth-radio-favicon-pine-svg'
  ]);
});

test('legacy media-query listeners can update the favicon', () => {
  const page = fixture();
  let notify;
  const media = { matches: false, addListener(listener) { notify = listener; } };
  initBrandIdentity(page.document, { matchMedia: () => media });
  media.matches = true;
  notify();
  assert.equal(page.links[1].href, './branding/earth-radio-favicon-obsidian-32');
});

test('missing DOM nodes and unavailable media APIs preserve a usable static fallback', () => {
  assert.doesNotThrow(() => initBrandIdentity(null, {}));
  assert.doesNotThrow(() => initBrandIdentity({}, {}));
  assert.doesNotThrow(() => initBrandIdentity(fixture({ audio: false, brand: false, icons: false }).document, {}));

  for (const environment of [{}, { matchMedia() { throw new Error('Unavailable'); } }, { matchMedia: () => null }]) {
    const page = fixture();
    initBrandIdentity(page.document, environment);
    page.player.dispatchEvent(new Event('playing'));
    assert.equal(page.logo.classList.contains('is-playing'), true);
    assert.equal(page.links[0].href, './branding/earth-radio-favicon-pine-16');
  }

  const page = fixture();
  delete page.links[0].dataset.dark;
  initBrandIdentity(page.document, { matchMedia: () => ({ matches: true }) });
  assert.equal(page.links[0].href, './branding/earth-radio-favicon-pine-16');
  assert.equal(page.links[1].href, './branding/earth-radio-favicon-obsidian-32');
});
