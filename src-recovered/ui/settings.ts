// In-app Settings: theme, language, and (desktop) network proxy. Proxy is applied via the
// Electron preload bridge so it routes both playback and metadata; language/proxy changes
// reload to re-render cleanly. See SPEC-UI-001 / SPEC-PRIVACY-001.
import { getPreferences, setPreference } from '../core/storage';
import { applyTheme, type ThemePreference } from '../core/theme';
import { showToast } from '../core/toast';
import { t } from '../core/i18n';
import { setMapTheme } from './map';
import { byId } from './dom';

let modal: HTMLElement | null = null;
let themeSelect: HTMLSelectElement | null = null;
let localeSelect: HTMLSelectElement | null = null;
let proxyRow: HTMLElement | null = null;
let proxyInput: HTMLInputElement | null = null;

export function initSettings(): void {
  modal = byId('settings-modal');
  themeSelect = byId<HTMLSelectElement>('setting-theme');
  localeSelect = byId<HTMLSelectElement>('setting-locale');
  proxyRow = byId('setting-proxy-row');
  proxyInput = byId<HTMLInputElement>('setting-proxy');
  if (!modal) return;

  byId('settings-toggle')?.addEventListener('click', openSettings);
  modal.querySelectorAll('[data-close-settings]').forEach(el => el.addEventListener('click', closeSettings));
  byId('settings-save')?.addEventListener('click', () => void saveSettings());
}

export function openSettings(): void {
  if (!modal) return;
  const prefs = getPreferences();
  if (themeSelect) themeSelect.value = String(prefs.theme || 'system');
  if (localeSelect) localeSelect.value = String(prefs.locale || 'en');

  const desktop = Boolean(window.earthRadio?.isDesktop);
  if (proxyRow) proxyRow.hidden = !desktop;
  if (desktop && proxyInput) {
    window.earthRadio!.getProxy().then(url => {
      if (proxyInput) proxyInput.value = url || '';
    }).catch(() => undefined);
  }

  modal.hidden = false;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}

export function closeSettings(): void {
  if (!modal) return;
  modal.hidden = true;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}

async function saveSettings(): Promise<void> {
  const prefs = getPreferences();
  let needsReload = false;

  const theme = (themeSelect?.value || 'system') as ThemePreference;
  setPreference('theme', theme);
  const resolved = applyTheme(theme);
  setMapTheme(resolved);

  const locale = localeSelect?.value || 'en';
  if (locale !== (prefs.locale || 'en')) {
    setPreference('locale', locale);
    needsReload = true;
  }

  if (window.earthRadio?.isDesktop && proxyInput) {
    try {
      await window.earthRadio.setProxy(proxyInput.value.trim());
      needsReload = true;
    } catch {
      // proxy apply failed; keep going
    }
  }

  closeSettings();
  if (needsReload) {
    showToast(t('settings.applying'));
    setTimeout(() => location.reload(), 250);
  } else {
    showToast(t('settings.saved'));
  }
}
