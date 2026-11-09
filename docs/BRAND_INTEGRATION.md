# Earth Radio precision identity integration

This change integrates the approved five-wave globe and outlined Instrument Serif wordmark into the active `site/` runtime. It was prepared against main commit `7531aa2ebb510060c18362c3af65c4bb614cbd54`, version 0.32.0. It does not require rebuilding the recovered application bundle.

## Browser and installed-app icons

`site/index.html` declares pine 16 px and 32 px PNG fallbacks followed by a scalable SVG favicon. Every favicon link has explicit `data-light` and `data-dark` URLs. The external `brand-identity.js` module selects the static pine or obsidian assets using the OS `prefers-color-scheme` preference, both at startup and when that preference changes. With JavaScript disabled or the media-query API unavailable, pine remains the default.

This avoids depending exclusively on `media` on `rel="icon"`, or on media queries inside an SVG favicon. Both have browser-specific limitations. The browser still controls when its tab, bookmark, or installed-app icon cache refreshes; this implementation does not promise immediate repaint on every platform.

| Surface | File in `site/branding/` | Treatment |
| --- | --- | --- |
| Browser favicon | `earth-radio-favicon-{pine,obsidian}.svg` | Static SVG for each OS palette |
| Browser PNG fallback | `earth-radio-favicon-{pine,obsidian}-{16,32}.png` | Approved small-size exports |
| Apple Home Screen | `earth-radio-apple-touch-icon-180.png` | Opaque 180 × 180 square; platform supplies its mask |
| Generic installed app | `earth-radio-app-icon-{192,512}.png` | Approved rounded tile; manifest purpose `any` |
| Masked installed app / Dock | `earth-radio-maskable-icon-{512,1024}.png` | Opaque square with safe padding; manifest purpose `maskable` |

The manifest retains the existing name, short name, start URL, display mode, and launch background. Its theme color is approved pine, `#1E3A2F`. The existing app theme controller remains responsible for the single HTML `theme-color` meta element, so the Paper/Night setting is respected. Favicon palette follows the OS independently. Installed-app icons use a fixed pine asset; they do not automatically follow the favicon's dark-mode selection.

The root `site/favicon.svg` also uses the approved pine mark for consumers of that legacy URL. Existing v2 assets remain available for older clients; the new head and manifest reference new filenames.

## Header and playback

The header embeds the approved vector lockup with its wordmark converted to paths. It does not request a web font. Its home link retains the accessible name “Earth Radio home”; the SVG itself is decorative.

The paths preserve the approved +12-degree SVG rotation, rounded caps, and coordinates. Each of the five wave paths is wrapped in a separate group inside the existing rotation. The scoped stylesheet uses a restrained 0.94–1 vertical scale over 1.8 seconds, with staggered phases. The animation is decorative activity feedback, not a measurement of the stream's amplitude.

Motion begins on the native audio element's `playing` event. It stops on `pause`, `waiting`, `ended`, `emptied`, `error`, `loadstart`, or `seeking`. A `stalled` event alone does not stop it, because buffered audio may still be playing. It does not start merely because `play()` was requested. Late initialization checks the element's current readiness and playback state.

Motion is enabled only when `prefers-reduced-motion: no-preference` matches. Removing the playing state restores the static approved geometry. The controller never calls `play()`, changes a stream source, or alters volume.

The horizontal lockup is 160 CSS pixels wide on smaller screens and 164 in the desktop rail. Desktop uses Warm Alabaster (`#F6F4F0`) against the existing pine rail. Smaller screens use pine/ink in Paper and alabaster in Night. The signal square remains `#C85A32`.

## Cache and CSP integration

The new script and stylesheet are same-origin external resources, compatible with the existing `script-src 'self'` policy. Their release URLs use `?v=0.32.0`, following the repository's existing module-version convention.

Service-worker cache generation `earth-radio-shell-v68-precision-identity` (v67 was taken by the stream-disclosure release on main) precaches both favicon palettes, the platform icons, and the brand script and stylesheet. Branding and maintained modules retain the existing network-first behavior with offline fallback. `_headers` gives the new mutable files the existing five-minute revalidation policy.

The provenance record updates only the current hashes and reasons for changed recovered files. Original intake hashes remain unchanged. `RELEASE_MANIFEST.json` and `sha256sums.txt` are regenerated with the repository's own release-manifest script.

## Validation and limits

The initial focused baseline passed 50 tests. After integration, the Node test suite passed 565 tests, including six new controller tests and additional offline-resource cases. Lint, syntax/repository checks, module URL validation, static-site staging, and validation of the source and staged site passed. The icon checks confirmed:

- Apple and maskable PNG alpha is 255 across every pixel.
- Declared PNG dimensions match the actual files.
- At 1024 px, the visible glyph reaches approximately 336.3 px from the center, inside the 409.6 px maskable safe radius.
- At 512 px, the visible glyph reaches approximately 168.3 px, inside the 204.8 px safe radius.
- Inline header wave path data and transforms match the approved vector master.

Local validation used Node 24.22.1; the repository pins 24.18.0 for CI. Dependencies were installed with lifecycle scripts disabled. These checks do not substitute for rendered Chromium/WebKit tests, audible streaming tests, or installation on physical Apple/Android devices. The local Chromium download returned an unavailable HTML page instead of a browser archive, so those rendered/platform checks were not completed in this environment.

Before production rollout, exercise the existing browser CI and check the header at mobile and desktop widths, OS theme changes with a tab open, Paper/Night app changes, play/pause/buffering, reduced motion, and an offline reload. A new installation should show the pine platform icon. Existing OS icon caches may need a platform-specific refresh or reinstallation to display a changed icon.

## Reproducing platform exports

The approved full-bleed and rounded SVG masters are included in `site/branding/`. For example, with Inkscape installed:

```sh
inkscape site/branding/earth-radio-icon-pine-fullbleed.svg --export-type=png --export-width=180 --export-height=180 --export-filename=site/branding/earth-radio-apple-touch-icon-180.png
inkscape site/branding/earth-radio-icon-pine-fullbleed.svg --export-type=png --export-width=512 --export-height=512 --export-filename=site/branding/earth-radio-maskable-icon-512.png
inkscape site/branding/earth-radio-icon-pine-fullbleed.svg --export-type=png --export-width=1024 --export-height=1024 --export-filename=site/branding/earth-radio-maskable-icon-1024.png
inkscape site/branding/earth-radio-icon-pine.svg --export-type=png --export-width=192 --export-height=192 --export-filename=site/branding/earth-radio-app-icon-192.png
inkscape site/branding/earth-radio-icon-pine.svg --export-type=png --export-width=512 --export-height=512 --export-filename=site/branding/earth-radio-app-icon-512.png
```

The Instrument Serif license notice is included as `site/branding/OFL-InstrumentSerif.txt`. The runtime contains outlined logo artwork, not an additional font file.

## References

- [WHATWG: link type icon](https://html.spec.whatwg.org/multipage/links.html#rel-icon)
- [Mozilla issue 1603885: favicon link media support](https://bugzilla.mozilla.org/show_bug.cgi?id=1603885)
- [WebKit issue 309949: color scheme inside SVG favicons](https://bugs.webkit.org/show_bug.cgi?id=309949)
- [Apple: Configuring Web Applications, Home Screen icon selection](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- [web.dev: maskable icons and their circular safe zone](https://web.dev/articles/maskable-icon)
- [web.dev: web app manifest icons](https://web.dev/articles/add-manifest)
- [WebKit: Safari 17.2 web app icon guidance](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)
- [MDN: playing event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playing_event)
- [MDN: waiting event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/waiting_event)
- [MDN: reduced-motion preference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

## Public website (earthradio.stream)

The static website in `website/` carries the same identity. `scripts/stage-website.mjs` copies the approved masters from `site/branding/` at build time (`BRAND_ASSETS`), so the website never holds a second copy that can drift:

| Website artifact | Source master |
| --- | --- |
| `images/earth-radio-favicon-16.png`, `-32.png` | `earth-radio-favicon-pine-16.png`, `-32.png` |
| `images/earth-radio-favicon.svg` | `earth-radio-favicon-pine.svg` |
| `images/earth-radio-apple-touch-icon-180.png` | `earth-radio-apple-touch-icon-180.png` |
| `images/earth-radio-logo.svg` | `earth-radio-logo.svg` |

The website uses the pine palette only. It has no audio and no favicon script, which keeps it fully static under its existing `script-src 'self'` policy. The header and footer use the lockup as an image (184 CSS px in the desktop header, 140 on small screens, 124 in the footer) with the alternative text "Earth Radio".

`website/images/earth-radio-og.png` is a 1200 x 630 social card (lockup and the "The world is on air." line on pine). It replaces the old square 512 px app icon as `og:image`, with explicit dimensions, alternative text and `twitter:card` set to `summary_large_image`. The tagline was rendered with Instrument Serif (SIL OFL 1.1, see `site/branding/OFL-InstrumentSerif.txt`); the font file itself is not shipped.

The old `images/earth-radio-32.png` and `images/earth-radio-512.png` artifacts are no longer published. `tests/website.test.mjs` checks that every staged brand file is byte-identical to its master and that the card is 1200 x 630.
