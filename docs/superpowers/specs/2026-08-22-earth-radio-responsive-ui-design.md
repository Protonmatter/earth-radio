# Earth Radio Responsive UI/UX Design

**Date:** 2026-08-22  
**Status:** Approved design; implementation planning pending user review  
**Repository:** `Protonmatter/earth-radio`  
**Production site:** <https://earth-radio.pages.dev>

## 1. Purpose

Redesign Earth Radio for first-class use in iOS Safari, an installed iOS PWA, responsive desktop browsers, and the Electron desktop application. The redesign must improve hierarchy, touch ergonomics, viewport behavior, accessibility, localization, and desktop adaptability without replacing or duplicating the selected recovered runtime's authoritative application state.

The approved product directions are:

- Listening-first mobile experience.
- Balanced desktop studio with an adjustable station-list/map split.
- Atlas Editorial visual language.
- Four mobile destinations: Listen, Search, Map, and Saved.
- Persistent mobile mini-player opening into a dedicated full-screen Now Playing view.
- Complete English, Spanish, Arabic, Korean, Simplified Chinese, and Traditional Chinese interfaces.
- Additive, maintainable responsive presentation layer over the recovered runtime.

## 2. Current-state constraints

Earth Radio is reconstructed from installed application assets and supplied archives. The selected production JavaScript and CSS are recovered, minified runtime artifacts. The older TypeScript under `src-recovered/` documents architectural intent but cannot reproduce the selected bundle from the available repository state.

The current responsive implementation compresses desktop behavior onto phones:

- Below `768px`, the station list and map are permanently stacked at approximately `55% / 45%`.
- The global header becomes a horizontally scrolling strip of controls.
- Several frequent controls are approximately `28px`, below the desired mobile touch-target size.
- The four daily actions become a long single-column block.
- The layout uses `100vh` without explicit iOS safe-area handling.
- The map remains continuously visible even when listening and station selection are the primary mobile tasks.

The public browser loads compatible catalogs and streams directly. Electron adds a guarded, loopback-only proxy and metadata capability. The responsive redesign must not blur these capability boundaries or imply a public proxy exists.

## 3. Chosen implementation architecture

Use an additive responsive layer instead of directly rewriting the recovered minified bundles or attempting a full source reconstruction.

Expected maintained assets:

- `site/assets/responsive-ui.css`
- `site/assets/responsive-ui.js`
- `site/i18n/index.js`
- `site/i18n/en.js`
- `site/i18n/es.js`
- `site/i18n/ar.js`
- `site/i18n/ko.js`
- `site/i18n/zh-Hans.js`
- `site/i18n/zh-Hant.js`

`site/index.html` will receive small semantic containers, controls, landmarks, and declarative localization attributes. The responsive assets will load after the recovered runtime assets. Existing public IDs, ARIA relationships, and runtime-owned elements will be retained wherever practical.

The layer may move or recompose existing elements, but it must not create a second audio player, catalog, favorites store, filter engine, metadata engine, or Leaflet map. New visual controls route to existing actions or presentation-only state.

Direct modification of a recovered hashed bundle is permitted only when a specific required behavior cannot be exposed safely through the additive boundary, is covered by a focused failing regression test, and is recorded in the recovery hardening-overlay manifest. It is not the default implementation strategy.

## 4. Visual system: Atlas Editorial

Atlas Editorial combines warm paper-like surfaces, cartographic greens, and restrained coral signal accents. The interface should feel international, exploratory, calm, and editorial rather than cyberpunk, dashboard-heavy, or excessively translucent.

Principles:

- Warm neutral primary surfaces.
- Deep green structural color for navigation and player surfaces.
- Coral reserved for playback, selection, and important emphasis.
- Typography supplies hierarchy; decorative gradients remain restrained.
- Quality and failure states use text and icons in addition to color.
- Shadows and elevation distinguish active overlays without excessive glass effects.
- Light and dark themes preserve the same semantic tokens and contrast requirements.
- No generated raster imagery is required for the UI shell; code-native layout, icons, colors, and typography remain authoritative.

## 5. Mobile information architecture

The mobile shell has four persistent destinations:

1. **Listen**
2. **Search**
3. **Map**
4. **Saved**

The persistent mini-player sits immediately above the bottom navigation. Expanded Now Playing is a dedicated application view.

### 5.1 Mobile header

The always-visible header contains only Earth Radio identity, contextual destination title where necessary, Search access outside the Search destination, and one overflow/settings action.

Existing actions are redistributed:

- Surprise becomes World Scan in Listen.
- Favorites and Recent move to Saved.
- Filters become contextual in Listen, Search, and Map.
- Refresh, theme, import, export, and settings move to the overflow/settings surface.
- Keyboard hints remain available when relevant but are not displayed in touch-first layouts.

The primary header never horizontally scrolls.

### 5.2 Listen

Listen contains:

- Compact editorial introduction.
- Continue Listening.
- World Scan.
- Compact Near Me and Works Now shortcuts.
- Horizontally scrollable collection chips with visible edge affordance.
- Single-column virtualized station feed.

Station rows have a minimum `64px` height and include artwork or monogram, name, country/codec/bitrate metadata, textual and visual quality, and a minimum `44px` Play/Pause target. Play and row selection retain distinct semantics. Favorite remains directly available or appears in an accessible station-actions menu.

### 5.3 Search

Search is a destination on mobile rather than a modal. It provides an immediate field, recent local queries, and results reusing the shared station-row presentation.

The input receives focus only when the user explicitly opens or activates Search. Unrelated destination changes do not raise the iOS keyboard. Search waits for `compositionend` before filtering Korean or Chinese IME input. Loading, empty, no-match, and failure states are explicit.

Desktop retains command-style search and `Ctrl+K` or `Command+K` behavior.

### 5.4 Map

Map owns the mobile content region. The existing Leaflet map is moved rather than duplicated and receives `invalidateSize()` after activation and layout transitions.

Selecting a marker opens a bounded preview card with station identity, quality, Play, Favorite, and Show in List. It is not a draggable sheet. Map remains supplementary for accessibility; equivalent stations remain available through List and Search.

### 5.5 Saved

Saved contains a segmented Favorites/Recent view. Empty states link back to Listen. Import and export remain in Settings as data-management actions.

### 5.6 Persistent mini-player

The mini-player appears after a station is selected and displays artwork or monogram, station name, concise live state, and a large Play/Pause control. Tapping the remainder opens Now Playing.

It uses the existing audio element and runtime playback state, survives destination changes, accounts for `safe-area-inset-bottom`, and cannot conceal list content or map attribution.

### 5.7 Full-screen Now Playing

Now Playing presents:

- Dismiss/back action.
- Station artwork or fallback.
- Station name, country, codec, bitrate, and quality.
- Previous, Play/Pause, and Next.
- Favorite and Similar.
- Sleep Timer.
- Map shortcut when coordinates exist.
- Metadata provider, confidence, raw value, explanation, cache state, and supplied links.

Opening and closing preserves the originating destination and scroll position. Browser Back closes Now Playing before leaving Earth Radio. Focus returns to the mini-player or invoking control.

### 5.8 iOS viewport contract

- Use `100dvh` with `100vh` fallback.
- Apply top and bottom safe-area insets.
- Do not rely on hover or autoplay.
- Prevent document-level horizontal overflow.
- Keep frequent touch targets at least `44px` square.
- Validate portrait, landscape, Safari browser mode, and standalone PWA mode.
- Do not suppress Safari navigation gestures unnecessarily.

## 6. Desktop and Electron experience

### 6.1 Application bar

The desktop bar contains Earth Radio identity, prominent global Search, Saved, Filters, Theme, and Settings/overflow. Refresh/import/export move into overflow. World Scan appears inside the station workspace.

### 6.2 Station workspace

The station panel begins near `42%` width and contains editorial title/count, compact discovery actions, collections, filter summary, and the virtualized station view. Cards use one or two columns based on available panel width. Play and Favorite remain visible without hover.

### 6.3 Adjustable separator

The separator uses `role="separator"`, vertical orientation, and ARIA min/max/current values. Keyboard support includes Arrow keys, `Shift+Arrow` for larger increments, Home, End, and a visible focus state. Double-click restores the default split.

Persist normalized percentage rather than pixels. Clamp restored values to preserve approximately `340px` minimum station space and `360px` minimum map space. Empirical testing may increase these minimums, but must not reduce them below usable content widths.

### 6.4 Collapse and restore

Users can Hide Map or Hide Stations. Both panels cannot be collapsed simultaneously. The last non-collapsed split and current collapsed panel persist separately. The separator leaves the accessibility tree while collapsed. Focus moves to a valid Restore control if its prior target disappears.

### 6.5 Map workspace

Existing clustering and markers remain. Marker previews expose Play, Favorite, Similar, and Show in List. Active playback is associated with its marker where coordinates exist. Leaflet size invalidation is throttled during drag and run once without throttling when resizing ends. Attribution remains unobstructed.

### 6.6 Persistent player

The player groups station identity on the left, transport controls centrally, and volume/Similar/Favorite/Sleep Timer on the right. Station identity opens a desktop Now Playing/detail panel. Player height remains deterministic.

### 6.7 Desktop Now Playing

Desktop uses a contained panel or modal-sized overlay rather than a full-screen mobile takeover. It exposes the same data and actions as mobile, with focus management and map-attribution-safe positioning.

### 6.8 Electron adaptation

- Use the same desktop layout.
- Preserve the guarded loopback proxy and preload capability boundary.
- Show proxy settings only when the bridge exposes desktop capability.
- Continue opening external links through the operating system.
- Keep the native window frame.
- Validate and document a minimum Electron window size.
- Narrow windows transition to the shared responsive mode instead of clipping.

### 6.9 Narrow desktop and tablet

The separator remains only while both panels meet minimum widths. Below that threshold, explicit List/Map modes replace the split. Mobile bottom navigation appears only at the mobile breakpoint, not at every narrow-desktop width. Functionality never depends on pointer type or hover.

## 7. State and data flow

### 7.1 Runtime-owned state

The existing runtime remains authoritative for catalog, selected station, playback, favorites, recent history, filters, collections, theme, locale preference storage, map data, metadata enrichment, and Electron bridge capability.

### 7.2 Presentation-owned state

The responsive layer owns active mobile destination, expanded Now Playing visibility, desktop split percentage, collapsed panel, active Saved segment, open presentation surfaces, focus-return targets, and viewport/display-mode classification.

### 7.3 Action routing

New controls invoke existing controls/actions or change presentation-only state. Existing controls should be moved or restyled instead of cloned. When a duplicate visual control is unavoidable, only one is interactive and exposed to accessibility APIs for the active layout.

Synchronization may use audio events, existing ARIA/class state, controlled custom events, and narrowly scoped observers on known runtime-owned elements. Whole-document observation and arbitrary text scraping are prohibited.

### 7.4 URL/history

Recognized mobile fragments are `#listen`, `#search`, `#map`, and `#saved`. Unknown fragments fall back to Listen. Now Playing uses a transient history state so Back closes it first. Desktop split and transient menus are not encoded in the URL.

### 7.5 Presentation persistence

A versioned `earthRadio.ui.v1` object may store desktop split percentage, collapsed panel, mobile last destination, and Saved segment. Invalid values are ignored, values are clamped, storage failures do not block startup, and existing favorites/history data is never duplicated.

## 8. Localization and typography

### 8.1 Supported locales

- `en`
- `es`
- `ar`
- `ko`
- `zh-Hans`
- `zh-Hant`

Canonical locale IDs are preserved; Chinese variants are not collapsed to `zh`. English is the deterministic fallback. Every catalog must contain the same required keys and placeholder names.

### 8.2 Locale behavior

An explicit stored locale wins. On first use, browser language may select a supported locale; unsupported or invalid values use English. Locale selection updates `lang`, `dir`, font profile, visible labels, and announcements. A controlled reload is acceptable when needed for recovered-runtime compatibility.

Catalogs cover global status, navigation, discovery, stations, Search, Map, Saved, player, Now Playing, filters, settings, import/export, errors, accessibility labels, desktop resizing/collapse, PWA updates, and Electron-only settings.

Spanish and Arabic will be completed to the same structural coverage as the new catalogs. Production tests reject missing keys, unknown placeholders, empty values, unsafe HTML, and placeholder drift.

### 8.3 Font profiles

Korean uses system-first fallbacks including Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, and Noto Sans CJK KR.

Simplified Chinese uses system-first fallbacks including PingFang SC, Microsoft YaHei UI, Microsoft YaHei, Noto Sans CJK SC, and Noto Sans SC.

Traditional Chinese uses system-first fallbacks including PingFang TC, Microsoft JhengHei UI, Microsoft JhengHei, Noto Sans CJK TC, and Noto Sans TC.

No remote font dependency is introduced. CJK text avoids artificial letter spacing, receives appropriate line breaking, and supports mixed-script station values. Arabic remains RTL while station and metadata fields retain `unicode-bidi: plaintext`.

### 8.4 Translation-quality boundary

Structural completeness, placeholders, encoding, and layout are testable. Native editorial quality is reported only when actual native-speaker review occurs. Engineering-authored catalogs must be identified as such in the handoff.

## 9. Accessibility

The design targets WCAG 2.2 AA behavior without claiming conformance before evidence exists.

Requirements include logical headings, skip link, landmarks, visible focus, mobile target sizing, stable accessible names, `aria-current` on mobile navigation, correct toggle states, modal focus containment only where appropriate, focus restoration, semantic separator behavior, polite bounded status announcements, non-color quality cues, reduced motion, and equivalent non-map access.

No feature may depend only on hover, drag, color, map position, or gesture. VoiceOver and keyboard checks cover navigation, station rows, player, Now Playing, map alternatives, filters, settings, and focus recovery.

## 10. Loading and failure handling

### 10.1 Catalog

Loading remains destination-specific and avoids global blocking. On failure, Retry invokes the existing refresh path, cached/saved data remains available where supported, and the message distinguishes directory failure from site failure.

### 10.2 Playback

The player reflects actual media events rather than tap intent. Known failures identify unsupported format, insecure stream, network failure, unavailable upstream, or browser policy. Retry and Similar remain available. Errors are announced once.

### 10.3 Map

Map failure does not block Listen, Search, Saved, or playback. Map presents bounded Retry and preserves textual geographic access.

### 10.4 Metadata

Metadata remains non-blocking. Raw ICY is shown honestly, missing identifications remain low-confidence/no-match, fallback artwork is used, and provider links appear only when supplied.

### 10.5 Storage and import

Storage failure degrades to session behavior with a warning. Malformed imports never replace current data. Responsive preferences cannot corrupt existing favorites or history.

### 10.6 Offline and service worker

The service worker caches the responsive shell and catalogs through a new version. Offline shell availability is distinguished from live catalog/audio availability. Mixed old HTML and new responsive assets must be prevented through cache-version tests.

## 11. Implementation sequence

1. Add failing contract and localization tests.
2. Implement complete localization foundation and font profiles.
3. Implement shared Atlas Editorial responsive shell.
4. Implement mobile Listen, Search, Saved, Map, mini-player, and Now Playing.
5. Implement desktop separator, collapse, map coordination, and detail view.
6. Revise PWA manifest and service-worker cache contract.
7. Update architecture, operations, build-state, provenance, release manifest, and checksums.

Each stage must pass focused tests before the next depends on it.

## 12. Validation

### 12.1 Required repository commands

```powershell
npm run check
npm test
npm run build:web
npm run verify:site
npm run release:manifest
npm run verify
```

### 12.2 Automated coverage

Add focused tests for responsive asset staging, catalog parity, placeholders, locale normalization, CJK distinction, safe interpolation, invalid preference recovery, split clamping, collapse invariants, destination parsing, Now Playing history, focus return, action routing, service-worker cache contents, and deployment boundaries.

### 12.3 Viewports

Validate at least `375x667`, `390x844`, `430x932`, `844x390`, `768x1024`, `1280x720`, `1440x900`, `1920x1080`, and the documented Electron minimum window.

At each relevant viewport verify no horizontal overflow, reachable controls, unobscured content, correct safe areas, usable station content, visible attribution, fitting overlays, visible focus, and functional `200%` zoom.

### 12.4 Interaction and fault tests

Test mobile destination changes, playback preservation, Now Playing history/focus, IME composition, marker preview, Show in List, Saved segments, rotation, and standalone PWA mode.

Test desktop pointer/keyboard resizing, reset, collapse/restore, stored-state clamping, window resizing, Leaflet alignment, keyboard search, narrow mode, and Electron capability gating.

Inject catalog, tile, playback, metadata, storage, import, and service-worker-upgrade failures.

### 12.5 Accessibility and localization

Test keyboard order, landmarks, names, states, separator values, focus restoration, contrast, reduced motion, quality without color, Arabic RTL, Korean, both Chinese variants, mixed scripts, long strings, IME behavior, and `200%` zoom. Physical iOS VoiceOver and native-language editorial review remain explicit evidence lanes.

## 13. Release and rollback

Local completion does not authorize commit, push, or deployment. Before publication, verify the exact changed-file list and staged site, exclude `.superpowers/`, obtain explicit authorization, then let Cloudflare build the approved `main` commit.

Production verification must cover canonical and immutable URLs, deployed commit, DOM/assets, security headers, service worker, catalog loading, representative playback, and mobile/desktop smoke tests.

Rollback options are source revert, Cloudflare promotion of the last known-good deployment, safe preference fallback, service-worker cache-version recovery, and use of the last known-good Electron renderer/package. No destructive user-data migration is planned.

## 14. Acceptance criteria

The design is implemented when:

1. Mobile uses Listen, Search, Map, and Saved destinations with no horizontally scrolling global action header.
2. The persistent mini-player and full-screen Now Playing preserve the existing audio state.
3. iOS safe areas, dynamic viewport behavior, portrait, landscape, and standalone PWA layouts are handled.
4. Desktop provides an accessible adjustable/collapsible list/map studio and stable Leaflet behavior.
5. Electron preserves its existing security and proxy capability boundaries.
6. English, Spanish, Arabic, Korean, Simplified Chinese, and Traditional Chinese catalogs are structurally complete.
7. Korean and Chinese system-font stacks and IME-safe search behavior are implemented.
8. The existing catalog, filters, favorites, history, playback, metadata, and map behavior remain authoritative and functional.
9. Loading and failure states are bounded, honest, accessible, and non-blocking outside their affected feature.
10. Existing and new automated checks pass, responsive browser evidence is captured, and physical-device/native-language gaps are explicitly reported.
11. Static staging and service-worker tests prove no unintended files or capability expansion reach Cloudflare Pages.
12. Documentation, provenance overlays, release manifest, and checksums reflect the maintained responsive layer.

## 15. Explicit non-goals

- Rebuilding the complete application from `src-recovered/`.
- Publishing the Electron proxy or adding a public streaming proxy.
- Adding accounts, cloud synchronization, analytics, advertising, or telemetry.
- Adding remote web fonts or a UI framework.
- Claiming every third-party station will play.
- Claiming WCAG conformance or native translation review without evidence.
- Changing repository licensing.
- Committing, pushing, or deploying without separate explicit authorization.
