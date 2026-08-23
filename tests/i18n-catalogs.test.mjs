import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  CATALOGS,
  DEFAULT_LOCALE,
  REQUIRED_KEYS,
  SUPPORTED_LOCALES,
  applyDeclarativeI18n,
  applyDocumentLocale,
  catalogPlaceholders,
  detectBrowserLocale,
  hasUnsafeHtml,
  interpolate,
  normalizeLocale,
  t,
  validateCatalogs
} from '../site/i18n/index.js';

test('locale source files do not declare duplicate keys', async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const source = await readFile(path.join(import.meta.dirname, '..', 'site', 'i18n', `${locale}.js`), 'utf8');
    const keys = [...source.matchAll(/^\s*'([^']+)'\s*:/gm)].map(match => match[1]);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], `${locale} contains duplicate catalog keys`);
  }
});

test('six catalogs share identical keys and placeholders', () => {
  const errors = validateCatalogs();
  assert.deepEqual(errors, []);
  assert.equal(REQUIRED_KEYS.length > 80, true);
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'es', 'ar', 'ko', 'zh-Hans', 'zh-Hant']);
  assert.deepEqual(catalogPlaceholders(CATALOGS.en), catalogPlaceholders(CATALOGS['zh-Hant']));
});

test('locale normalization preserves Chinese variants and rejects bare zh', () => {
  assert.equal(normalizeLocale('zh-Hans'), 'zh-Hans');
  assert.equal(normalizeLocale('zh-Hant'), 'zh-Hant');
  assert.equal(normalizeLocale('zh-CN'), 'zh-Hans');
  assert.equal(normalizeLocale('zh-TW'), 'zh-Hant');
  assert.equal(normalizeLocale('zh-HK'), 'zh-Hant');
  assert.equal(normalizeLocale('zh-hans'), 'zh-Hans');
  assert.equal(normalizeLocale('zh'), DEFAULT_LOCALE);
  assert.equal(normalizeLocale('ko-KR'), 'ko');
  assert.equal(normalizeLocale('xx'), DEFAULT_LOCALE);
  assert.equal(normalizeLocale(''), DEFAULT_LOCALE);
  assert.notEqual(normalizeLocale('zh-Hans'), normalizeLocale('zh-Hant'));
});

test('safe interpolation strips markup and keeps unknown placeholders', () => {
  assert.equal(interpolate('Hello {name}', { name: 'Earth' }), 'Hello Earth');
  assert.equal(interpolate('Hello {name}', { name: '<em>x</em>' }), 'Hello emx/em');
  assert.equal(interpolate('Hello {name}', {}), 'Hello {name}');
  assert.equal(hasUnsafeHtml('<script>alert(1)</script>'), true);
  assert.equal(hasUnsafeHtml('Quality {score}'), false);
});

test('translations distinguish CJK locales and fall back to English', () => {
  assert.equal(t('nav.listen', undefined, 'ko'), '듣기');
  assert.equal(t('nav.listen', undefined, 'zh-Hans'), '收听');
  assert.equal(t('nav.listen', undefined, 'zh-Hant'), '收聽');
  assert.notEqual(t('nav.listen', undefined, 'zh-Hans'), t('nav.listen', undefined, 'zh-Hant'));
  assert.equal(t('missing.key', undefined, 'ko'), 'missing.key');
  assert.match(t('grid.count', { count: 12 }, 'en'), /12/);
});

test('document locale updates lang, dir, and font profile', () => {
  const fake = {
    documentElement: { lang: '', dir: '', dataset: {}, style: { setProperty() {} } }
  };
  assert.equal(applyDocumentLocale('ar', fake), 'ar');
  assert.equal(fake.documentElement.lang, 'ar');
  assert.equal(fake.documentElement.dir, 'rtl');
  assert.equal(applyDocumentLocale('zh-Hant', fake), 'zh-Hant');
  assert.equal(fake.documentElement.lang, 'zh-Hant');
  assert.equal(fake.documentElement.dir, 'ltr');
  assert.equal(fake.documentElement.dataset.fontProfile, 'zh-Hant');
});

test('declarative i18n keeps icon glyphs when only an attribute is localized', () => {
  const icon = {
    attrs: { 'data-i18n': 'player.play', 'data-i18n-attr': 'aria-label' },
    textContent: '▶',
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; }
  };
  const label = {
    attrs: { 'data-i18n': 'header.refresh' },
    textContent: 'Refresh',
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; }
  };
  applyDeclarativeI18n({
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [icon, label];
      return [];
    }
  }, 'en');
  assert.equal(icon.textContent, '▶');
  assert.equal(icon.attrs['aria-label'], 'Play');
  assert.equal(label.textContent, 'Refresh');
});

test('first-use browser language selects a supported locale', () => {
  assert.equal(detectBrowserLocale(['zh-TW', 'en']), 'zh-Hant');
  assert.equal(detectBrowserLocale(['fr-FR', 'ko-KR']), 'ko');
  assert.equal(detectBrowserLocale(['fr-FR']), 'en');
});
