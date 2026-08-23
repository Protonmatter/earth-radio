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
      { type: 'click', selector: '[data-er-dest="search"]' },
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
      { type: 'click', selector: '[data-er-dest="search"]' },
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
    id: 'mobile-search-select-390x844',
    title: 'iPhone 14 portrait — select a station from Search',
    width: 390,
    height: 844,
    destination: 'listen',
    safeArea: IPHONE_SAFE_AREA,
    seed: SEEDED,
    actions: [
      { type: 'click', selector: '[data-er-dest="search"]' },
      {
        type: 'script',
        code: `(() => {
          const input = document.querySelector('#er-station-query');
          input.value = 'Atlas';
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
          return window.__erSettledSearchNames.length;
        })()`
      },
      { type: 'click', selector: '#search-results .search-result-item:not([hidden])' },
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
      { type: 'click', selector: '[data-er-dest="search"]' },
      {
        type: 'script',
        code: `(() => {
          const input = document.querySelector('#er-station-query');
          input.value = 'Atlas';
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

export const REQUIRED_EVIDENCE_VIEWPORTS = Object.freeze([
  '390x844',
  '430x932',
  '844x390',
  '1024x768',
  '1440x900',
  '1920x1080'
]);
