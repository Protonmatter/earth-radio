import ar from './ar.js';
import en from './en.js';
import es from './es.js';
import ko from './ko.js';
import zhHans from './zh-Hans.js';
import zhHant from './zh-Hant.js';

export const DEFAULT_LOCALE = 'en';
export const SUPPORTED_LOCALES = Object.freeze(['en', 'es', 'ar', 'ko', 'zh-Hans', 'zh-Hant']);
export const RTL_LOCALES = Object.freeze(['ar']);
export const CATALOGS = Object.freeze({
  en,
  es,
  ar,
  ko,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant
});
export const REQUIRED_KEYS = Object.freeze(Object.keys(en).sort());
export const FONT_PROFILES = Object.freeze({
  en: '"Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  es: '"Iowan Old Style", "Palatino Linotype", Palatino, "Times New Roman", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  ar: '"Segoe UI", "Tahoma", "Arial", sans-serif',
  ko: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "Segoe UI", sans-serif',
  'zh-Hans': '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Segoe UI", sans-serif',
  'zh-Hant': '"PingFang TC", "Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", "Segoe UI", sans-serif'
});

let activeLocale = DEFAULT_LOCALE;

export function catalogPlaceholders(catalog) {
  const found = new Set();
  for (const value of Object.values(catalog)) {
    for (const match of String(value).matchAll(/\{(\w+)\}/g)) found.add(match[1]);
  }
  return [...found].sort();
}

export function hasUnsafeHtml(value) {
  return /<\s*\/?\s*[a-z][^>]*>/i.test(String(value ?? ''));
}

export function normalizeLocale(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return DEFAULT_LOCALE;
  if (SUPPORTED_LOCALES.includes(raw)) return raw;

  const lower = raw.toLowerCase().replace(/_/g, '-');
  if (SUPPORTED_LOCALES.includes(lower)) return lower;
  // Full script+region tags (zh-Hant-TW, zh-Hans-CN) are the standard browser form;
  // match on prefix so they resolve to a Chinese catalog instead of falling to English.
  // Bare `zh` stays ambiguous and deliberately falls through to the default locale.
  if (/^zh-(hant|tw|hk|mo)/.test(lower)) return 'zh-Hant';
  if (/^zh-(hans|cn|sg|my)/.test(lower)) return 'zh-Hans';
  if (lower === 'zh' || lower.startsWith('zh-')) return DEFAULT_LOCALE;

  const base = lower.split('-')[0];
  if (base === 'en' || base === 'es' || base === 'ar' || base === 'ko') return base;
  return DEFAULT_LOCALE;
}

export function isRtlLocale(locale = activeLocale) {
  return RTL_LOCALES.includes(normalizeLocale(locale));
}

export function interpolate(template, params) {
  const source = String(template ?? '');
  if (!params) return source;
  return source.replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
    return String(params[name]).replace(/[<>]/g, '');
  });
}

export function t(key, params, locale = activeLocale) {
  const resolved = normalizeLocale(locale);
  const template = CATALOGS[resolved]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key] ?? key;
  return interpolate(template, params);
}

export function getLocale() {
  return activeLocale;
}

export function setLocale(locale) {
  activeLocale = normalizeLocale(locale);
  return activeLocale;
}

export function applyDocumentLocale(locale = activeLocale, documentRef = globalThis.document) {
  if (!documentRef?.documentElement) return activeLocale;
  const resolved = setLocale(locale);
  documentRef.documentElement.lang = resolved;
  documentRef.documentElement.dir = isRtlLocale(resolved) ? 'rtl' : 'ltr';
  documentRef.documentElement.dataset.fontProfile = resolved;
  documentRef.documentElement.style.setProperty('--er-font', FONT_PROFILES[resolved]);
  return resolved;
}

export function applyDeclarativeI18n(documentRef = globalThis.document, locale = activeLocale) {
  if (!documentRef) return;
  // Write only when the value actually changes: unconditional writes emit mutation
  // records even for identical values, and the runtime observer that calls this
  // would otherwise feed itself into a permanent rAF loop.
  for (const element of documentRef.querySelectorAll('[data-i18n]')) {
    const key = element.getAttribute('data-i18n');
    const attr = element.getAttribute('data-i18n-attr');
    const value = t(key, undefined, locale);
    if (attr) {
      if (element.getAttribute(attr) !== value) element.setAttribute(attr, value);
    } else if (element.textContent !== value) {
      element.textContent = value;
    }
  }
  for (const element of documentRef.querySelectorAll('[data-i18n-placeholder]')) {
    const value = t(element.getAttribute('data-i18n-placeholder'), undefined, locale);
    if (element.getAttribute('placeholder') !== value) element.setAttribute('placeholder', value);
  }
}

function isRecognizedLanguageTag(input) {
  const lower = String(input || '').trim().toLowerCase().replace(/_/g, '-');
  if (!lower) return false;
  const base = lower.split('-')[0];
  if (base === 'en' || base === 'es' || base === 'ar' || base === 'ko') return true;
  return /^(zh-hans|zh-hant|zh-cn|zh-sg|zh-my|zh-tw|zh-hk|zh-mo)\b/.test(lower);
}

export function detectBrowserLocale(languages = []) {
  for (const language of languages) {
    if (!isRecognizedLanguageTag(language)) continue;
    return normalizeLocale(language);
  }
  return DEFAULT_LOCALE;
}

export function validateCatalogs(catalogs = CATALOGS) {
  const errors = [];
  const expected = REQUIRED_KEYS;
  const expectedPlaceholders = catalogPlaceholders(en);
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = catalogs[locale];
    if (!catalog) {
      errors.push(`Missing catalog: ${locale}`);
      continue;
    }
    const keys = Object.keys(catalog).sort();
    for (const key of expected) {
      if (!(key in catalog)) errors.push(`${locale} missing ${key}`);
      else if (!String(catalog[key]).trim()) errors.push(`${locale} empty ${key}`);
      else if (hasUnsafeHtml(catalog[key])) errors.push(`${locale} unsafe HTML in ${key}`);
    }
    for (const key of keys) {
      if (!expected.includes(key)) errors.push(`${locale} unknown ${key}`);
    }
    const placeholders = catalogPlaceholders(catalog);
    if (placeholders.join(',') !== expectedPlaceholders.join(',')) {
      errors.push(`${locale} placeholder drift`);
    }
  }
  return errors;
}
