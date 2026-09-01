// Rendered browser scenario matrix.
//
// Every entry is executed by tests/browser/harness.mjs inside a real Electron renderer at an
// exact content size. Scenarios are data so the same list drives both the assertions in
// tests/rendered-ui.test.mjs and the captured visual evidence.

export const IPHONE_SAFE_AREA = { top: 47, right: 0, bottom: 34, left: 0 };
export const IPHONE_LANDSCAPE_SAFE_AREA = { top: 0, right: 50, bottom: 21, left: 50 };

const SEEDED = {
  favorites: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c'],
  recent: ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000010']
};

const SAVE_NAVIGATION_MARKER = 'earth-radio.test.locale-save-navigation';
const SAVE_NAVIGATION_VALUE = 'arabic-preview-committed';

const ARABIC_PREVIEW_OBSERVED = `document.documentElement.lang === 'ar'
  && document.documentElement.dir === 'rtl'
  && document.documentElement.dataset.fontProfile === 'ar'
  && document.querySelector('#setting-locale')?.value === 'ar'`;

const ENGLISH_DISMISSAL_OBSERVED = `document.querySelector('#settings-modal')?.hidden === true
  && document.documentElement.lang === 'en'
  && document.documentElement.dir === 'ltr'
  && document.documentElement.dataset.fontProfile === 'en'
  && document.querySelector('#setting-locale')?.value === 'en'
  && JSON.parse(localStorage.getItem('earthRadio.ui.v1') || 'null')?.locale === 'en'`;

const ARABIC_RELOAD_OBSERVED = `document.documentElement.dataset.erUiReady === 'true'
  && document.querySelector('#settings-modal')?.hidden === true
  && document.documentElement.lang === 'ar'
  && document.documentElement.dir === 'rtl'
  && document.documentElement.dataset.fontProfile === 'ar'
  && document.querySelector('#setting-locale')?.value === 'ar'
  && JSON.parse(localStorage.getItem('earthRadio.ui.v1') || 'null')?.locale === 'ar'
  && JSON.parse(localStorage.getItem('earthRadio.preferences.v1') || 'null')?.locale === 'ar'
  && sessionStorage.getItem('${SAVE_NAVIGATION_MARKER}') === '${SAVE_NAVIGATION_VALUE}'`;

const ARABIC_REOPEN_OBSERVED = `document.querySelector('#settings-modal')?.hidden === false
  && document.documentElement.lang === 'ar'
  && document.documentElement.dir === 'rtl'
  && document.documentElement.dataset.fontProfile === 'ar'
  && document.querySelector('#setting-locale')?.value === 'ar'`;

function arabicPreviewActions() {
  return [
    { type: 'click', selector: '#settings-toggle' },
    {
      type: 'script',
      code: `(() => {
        const select = document.querySelector('#setting-locale');
        select.value = 'ar';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.documentElement.lang = 'en';
        document.documentElement.dir = 'ltr';
        document.documentElement.dataset.fontProfile = 'en';
        return true;
      })()`
    },
    { type: 'waitFor', expression: ARABIC_PREVIEW_OBSERVED }
  ];
}

export const SCENARIOS = [
  {
    id: 'mobile-listen-390x844',
    title: 'iPhone 14 portrait — Listen',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-search-390x844',
    title: 'iPhone 14 portrait — Search destination',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-open-search]' },
      { type: 'wait', ms: 150 },
      { type: 'ime', selector: '#er-station-query', text: '서울' },
      { type: 'wait', ms: 150 }
    ]
  },
  {
    id: 'mobile-country-search-390x844',
    title: 'iPhone 14 portrait — country-scoped search',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-open-search]' },
      { type: 'focus', selector: '#er-country-query' },
      {
        type: 'script',
        code: `(() => {
          const option = [...document.querySelectorAll('#er-country-options [role="option"]')]
            .find(node => node.dataset.country === 'South Korea');
          option?.click();
          return Boolean(option);
        })()`
      },
      { type: 'wait', ms: 200 }
    ]
  },
  {
    id: 'mobile-country-search-keyboard-390x844',
    title: 'iPhone 14 portrait — keyboard country selection',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-open-search]' },
      {
        type: 'script',
        code: `(() => {
          window.__erCountrySelections = [];
          document.addEventListener('earthradio:country-selected', event => {
            window.__erCountrySelections.push({ country: event.detail?.country || '' });
          });
          const input = document.querySelector('#er-country-query');
          input.focus();
          input.value = 'Jap';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`
      },
      { type: 'key', key: 'ArrowDown' },
      { type: 'key', key: 'Enter' },
      { type: 'wait', ms: 200 }
    ]
  },
  {
    id: 'mobile-search-select-390x844',
    title: 'iPhone 14 portrait — select a station from Search',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-open-search]' },
      { type: 'focus', selector: '#er-country-query' },
      {
        type: 'script',
        code: `(() => {
          const option = [...document.querySelectorAll('#er-country-options [role="option"]')]
            .find(node => node.dataset.country === 'Canada');
          option?.click();
          return Boolean(option);
        })()`
      },
      {
        type: 'script',
        code: `(() => {
          const input = document.querySelector('#er-station-query');
          input.value = 'duplicate';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`
      },
      { type: 'wait', ms: 200 },
      {
        type: 'script',
        code: `(() => {
          window.__erSettledSearchNames = [...document.querySelectorAll('#search-results .search-result-item:not([hidden]) .search-result-item__name')]
            .map(node => (node.textContent || '').trim());
          const target = [...document.querySelectorAll('#search-results .search-result-item:not([hidden])')]
            .find(node => /Canada/.test(node.querySelector('.search-result-item__meta')?.textContent || ''));
          target?.setAttribute('data-er-pointer-target', 'true');
          return window.__erSettledSearchNames.length;
        })()`
      },
      { type: 'pointer', selector: '#search-results [data-er-pointer-target]' },
      { type: 'wait', ms: 250 }
    ]
  },
  {
    id: 'mobile-search-keyboard-select-390x844',
    title: 'iPhone 14 portrait — keyboard station selection from Search',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-open-search]' },
      {
        type: 'script',
        code: `(() => {
          const input = document.querySelector('#er-station-query');
          input.value = '1970';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`
      },
      { type: 'wait', ms: 200 },
      { type: 'key', key: 'ArrowDown' },
      { type: 'key', key: 'Enter' },
      { type: 'wait', ms: 250 }
    ]
  },
  {
    id: 'mobile-map-390x844',
    title: 'iPhone 14 portrait — Map destination',
    width: 390,
    height: 844,
    destination: 'map',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-saved-390x844',
    title: 'iPhone 14 portrait — Saved destination',
    width: 390,
    height: 844,
    destination: 'saved',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-nowplaying-390x844',
    title: 'iPhone 14 portrait — full-screen Now Playing',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '#station-grid .station-card__play' },
      { type: 'wait', ms: 200 },
      { type: 'click', selector: '#er-open-nowplaying' },
      { type: 'wait', ms: 200 }
    ]
  },
  {
    id: 'mobile-nowplaying-map-390x844',
    title: 'iPhone 14 portrait — Now Playing map shortcut',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '#station-grid .station-card__play' },
      { type: 'click', selector: '#er-open-nowplaying' },
      { type: 'click', selector: '#er-nowplaying [data-er-dest="map"]' },
      { type: 'wait', ms: 300 }
    ]
  },
  {
    id: 'mobile-overflow-390x844',
    title: 'iPhone 14 portrait — overflow surface',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-overflow]' },
      { type: 'wait', ms: 150 }
    ]
  },
  {
    id: 'mobile-overflow-settings-390x844',
    title: 'iPhone 14 portrait — overflow opens Settings with focus',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-overflow]' },
      { type: 'click', selector: '#er-overflow [data-click-id="settings-toggle"]' },
      { type: 'wait', ms: 200 }
    ]
  },
  {
    id: 'settings-locale-preview-ar-390x844',
    title: 'Settings — Arabic preview survives the locale observer',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: arabicPreviewActions()
  },
  {
    id: 'settings-locale-preview-cancel-390x844',
    title: 'Settings — cancelling an Arabic preview restores the saved locale',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [...arabicPreviewActions(), { type: 'click', selector: '#settings-modal .btn-clear' }, { type: 'waitFor', expression: ENGLISH_DISMISSAL_OBSERVED }]
  },
  {
    id: 'settings-locale-preview-save-390x844',
    title: 'Settings — saving an Arabic preview commits the locale',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      ...arabicPreviewActions(),
      { type: 'markNavigation', key: SAVE_NAVIGATION_MARKER, value: SAVE_NAVIGATION_VALUE },
      { type: 'click', selector: '#settings-save' },
      { type: 'waitForNavigation', key: SAVE_NAVIGATION_MARKER, value: SAVE_NAVIGATION_VALUE, expression: ARABIC_RELOAD_OBSERVED },
      { type: 'click', selector: '#settings-toggle' },
      { type: 'waitFor', expression: ARABIC_REOPEN_OBSERVED }
    ]
  },
  {
    id: 'settings-locale-preview-close-390x844',
    title: 'Settings — explicit close restores the saved locale',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [...arabicPreviewActions(), { type: 'click', selector: '#settings-modal .close-btn' }, { type: 'waitFor', expression: ENGLISH_DISMISSAL_OBSERVED }]
  },
  {
    id: 'settings-locale-preview-backdrop-390x844',
    title: 'Settings — backdrop dismissal restores the saved locale',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [...arabicPreviewActions(), { type: 'click', selector: '#settings-modal .settings-backdrop' }, { type: 'waitFor', expression: ENGLISH_DISMISSAL_OBSERVED }]
  },
  {
    id: 'settings-locale-preview-escape-390x844',
    title: 'Settings — Escape restores the saved locale',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [...arabicPreviewActions(), { type: 'key', key: 'Escape' }, { type: 'waitFor', expression: ENGLISH_DISMISSAL_OBSERVED }]
  },
  {
    id: 'settings-locale-preview-reopen-390x844',
    title: 'Settings — reopening has no stale locale preview',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      ...arabicPreviewActions(),
      { type: 'click', selector: '#settings-modal .btn-clear' },
      { type: 'waitFor', expression: ENGLISH_DISMISSAL_OBSERVED },
      { type: 'click', selector: '#settings-toggle' },
      { type: 'waitFor', expression: `document.querySelector('#settings-modal')?.hidden === false
        && document.documentElement.lang === 'en'
        && document.documentElement.dir === 'ltr'
        && document.documentElement.dataset.fontProfile === 'en'
        && document.querySelector('#setting-locale')?.value === 'en'` }
    ]
  },
  {
    id: 'mobile-listen-430x932',
    title: 'iPhone 15 Pro Max portrait — Listen',
    width: 430,
    height: 932,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-landscape-844x390',
    title: 'iPhone landscape — Listen',
    width: 844,
    height: 390,
    destination: 'listen',
    safeArea: IPHONE_LANDSCAPE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-landscape-overflow-844x390',
    title: 'iPhone landscape — overflow inside lateral safe areas',
    width: 844,
    height: 390,
    destination: 'listen',
    safeArea: IPHONE_LANDSCAPE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-overflow]' },
      { type: 'wait', ms: 150 }
    ]
  },
  {
    id: 'mobile-landscape-nowplaying-844x390',
    title: 'iPhone landscape — Now Playing inside lateral safe areas',
    width: 844,
    height: 390,
    destination: 'listen',
    safeArea: IPHONE_LANDSCAPE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '#station-grid .station-card__play' },
      { type: 'click', selector: '#er-open-nowplaying' },
      { type: 'wait', ms: 200 }
    ]
  },
  {
    id: 'mobile-standalone-390x844',
    title: 'iOS standalone PWA display mode — Listen',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    standalone: true,
    seed: SEEDED
  },
  {
    id: 'mobile-ar-390x844',
    title: 'iPhone portrait — Arabic RTL',
    width: 390,
    height: 844,
    destination: 'listen',
    locale: 'ar',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-ko-390x844',
    title: 'iPhone portrait — Korean',
    width: 390,
    height: 844,
    destination: 'listen',
    locale: 'ko',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-zh-hans-390x844',
    title: 'iPhone portrait — Simplified Chinese',
    width: 390,
    height: 844,
    destination: 'listen',
    locale: 'zh-Hans',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-zh-hant-390x844',
    title: 'iPhone portrait — Traditional Chinese',
    width: 390,
    height: 844,
    destination: 'listen',
    locale: 'zh-Hant',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'mobile-dark-390x844',
    title: 'iPhone portrait — dark theme',
    width: 390,
    height: 844,
    destination: 'listen',
    theme: 'dark',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED
  },
  {
    id: 'tablet-768x1024',
    title: 'Tablet portrait — explicit list mode',
    width: 768,
    height: 1024,
    destination: 'listen',
    seed: SEEDED
  },
  {
    id: 'desktop-1024x768',
    title: 'Small desktop — list and map split',
    width: 1024,
    height: 768,
    seed: SEEDED
  },
  {
    id: 'desktop-1080x720',
    title: 'Documented Electron minimum window',
    width: 1080,
    height: 720,
    seed: SEEDED
  },
  {
    id: 'desktop-1440x900',
    title: 'Desktop studio — default split',
    width: 1440,
    height: 900,
    seed: SEEDED
  },
  {
    id: 'desktop-1440x900-keyboard',
    title: 'Desktop studio — keyboard separator resize',
    width: 1440,
    height: 900,
    seed: SEEDED,
    actions: [
      { type: 'focus', selector: '#er-separator' },
      { type: 'key', key: 'ArrowRight' },
      { type: 'key', key: 'ArrowRight' },
      { type: 'key', key: 'ArrowRight', shift: true },
      { type: 'wait', ms: 200 }
    ]
  },
  {
    id: 'desktop-1440x900-collapse',
    title: 'Desktop studio — map collapsed',
    width: 1440,
    height: 900,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '#map-panel [data-er-collapse="map"]' },
      { type: 'wait', ms: 250 }
    ]
  },
  {
    id: 'desktop-1440x900-nowplaying',
    title: 'Desktop studio — contained Now Playing',
    width: 1440,
    height: 900,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '#er-open-nowplaying' },
      { type: 'wait', ms: 250 }
    ]
  },
  {
    id: 'desktop-1440x900-ar',
    title: 'Desktop studio — Arabic RTL',
    width: 1440,
    height: 900,
    locale: 'ar',
    seed: SEEDED
  },
  {
    id: 'desktop-1440x900-zh-hant',
    title: 'Desktop studio — Traditional Chinese',
    width: 1440,
    height: 900,
    locale: 'zh-Hant',
    seed: SEEDED
  },
  {
    id: 'desktop-1920x1080',
    title: 'Large desktop — two-column station cards',
    width: 1920,
    height: 1080,
    seed: SEEDED
  },
  {
    id: 'desktop-1920x1080-dark',
    title: 'Large desktop — dark theme',
    width: 1920,
    height: 1080,
    theme: 'dark',
    seed: SEEDED
  },
  {
    id: 'desktop-1440x900-zoom200',
    title: 'Desktop studio — 200% zoom',
    width: 1440,
    height: 900,
    zoom: 2,
    seed: SEEDED
  }
];
