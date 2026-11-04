# Earth Radio icon v2

Created with ChatGPT's built-in `image_gen` tool on 2026-11-03. No API-key/CLI fallback was used. The chosen generated master is `earth-radio-icon-master.png`, 1254 × 1254 pixels, preserved byte-for-byte.

Master SHA-256: `5f52da24e5ada7a246f956ae05ac8c87f4571d30e1408c5ad068777375b97147`.

The artwork combines a globe and radio arcs using the application's deep teal, ivory and warm gold palette. The original generated file remains at its image-generation destination; the project holds its own master copy. Derivatives are deterministic Lanczos downscales and PNG/ICO format conversion; the artwork was not redrawn.

## Runtime assets

- `site/branding/earth-radio-32-v2.png`: browser favicon.
- `site/branding/earth-radio-180-v2.png`: Apple touch icon.
- `site/branding/earth-radio-192-v2.png`: application header and PWA icon.
- `site/branding/earth-radio-512-v2.png`: PWA any/maskable icon.
- `site/branding/earth-radio-v2.ico`: Windows application and installer icon; includes 16, 24, 32, 48, 64, 128 and 256 pixel frames.

The warm foreground's measured radius is approximately 0.3977 of the image width, inside the maskable icon's 0.4-width safe radius. This pixel measurement and desktop previews do not replace an actual iOS home-screen review. The previous assets remain in the tree; consumers now reference the versioned v2 assets. Worker generation v48 caches the four web icon sizes together.

## Exact generation prompt

```text
Use case: logo-brand
Asset type: production application icon for Earth Radio, square 1024 x 1024 master suitable for desktop taskbars, mobile home screens, PWA and favicon derivatives.
Primary request: Design a distinctive, exceptionally clean Earth Radio icon: one bold globe symbol fused with a radio broadcast signal in a single coherent emblem. A simplified spherical globe with two or three broad meridian/latitude curves, and two restrained broadcast arcs integrated into its upper-right silhouette. Readable immediately at 24 pixels. No letters or words.
Style/medium: precise vector-like graphic design, confident geometry, optically balanced, flat shapes with a very subtle polished finish, no scene or mockup.
Composition/framing: centered emblem occupying roughly 65 percent of the square; generous safe margins for circular and rounded-square operating-system masks; full-bleed square background, do not bake in external rounded corners or a device frame.
Color palette: deep ocean teal background (#102c32), warm ivory (#f3eee6) main emblem with a restrained warm copper/gold accent (#d4a574), matching Earth Radio's existing listening atlas.
Constraints: a recognizable strong silhouette; broad sturdy strokes; maximum three colors; clean edges; no tiny geographic detail, no realistic continent map, no text, no initials, no shadows outside the icon, no watermark, no surrounding layout.
```

The prompt requested 1024 × 1024; the built-in tool returned the 1254 × 1254 master recorded above. Runtime derivatives have the exact sizes declared in the PWA manifest.
