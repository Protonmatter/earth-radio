// Theme resolution and application. Follows prefers-color-scheme unless a manual override
// is persisted. See SPEC-UI-001 (REQ-UI-DARKMODE).
import { getPreferences, setPreference } from './storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Pure resolver, unit-tested independently of the DOM. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return systemPrefersDark ? 'dark' : 'light';
}

function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark());
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0c0d10' : '#ffffff');
  }
  return resolved;
}

export function initTheme(): ResolvedTheme {
  const preference = (getPreferences().theme as ThemePreference) || 'system';
  const resolved = applyTheme(preference);
  try {
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((getPreferences().theme as ThemePreference) === 'system') applyTheme('system');
      });
    }
  } catch {
    // matchMedia unavailable; static theme is fine.
  }
  return resolved;
}

/** Cycle system -> light -> dark -> system, persist, and apply. Returns the new preference. */
export function cycleTheme(): ThemePreference {
  const current = (getPreferences().theme as ThemePreference) || 'system';
  const next: ThemePreference = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  setPreference('theme', next);
  applyTheme(next);
  return next;
}
