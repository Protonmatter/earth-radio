// Minimal synchronous i18n: catalog lookup with default-locale fallback and {placeholder}
// interpolation. RTL-aware document direction. See SPEC-I18N-001.
import ar from '../i18n/ar';
import en from '../i18n/en';
import es from '../i18n/es';

export type Catalog = Record<string, string>;

const DEFAULT_LOCALE = 'en';
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur']);

const catalogs: Record<string, Catalog> = { en, es, ar };

let activeLocale = DEFAULT_LOCALE;

export function availableLocales(): string[] {
  return Object.keys(catalogs);
}

export function getLocale(): string {
  return activeLocale;
}

export function setLocale(locale: string): void {
  const base = String(locale || '').toLowerCase().split('-')[0];
  activeLocale = catalogs[base] ? base : DEFAULT_LOCALE;
  applyDocumentLocale(activeLocale);
}

export function isRtlLocale(locale: string = activeLocale): boolean {
  return RTL_LOCALES.has(String(locale || '').toLowerCase().split('-')[0]);
}

export function t(key: string, params?: Record<string, string | number>): string {
  const template = catalogs[activeLocale]?.[key] ?? catalogs[DEFAULT_LOCALE]?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{${name}}`
  );
}

export function applyDocumentLocale(locale: string = activeLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
}
