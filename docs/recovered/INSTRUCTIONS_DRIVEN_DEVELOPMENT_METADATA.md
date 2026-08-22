# Instructions-Driven Development — Now-Playing Metadata

## Mission

Earth Radio must distinguish station identity from track identity. Never imply that a song was identified unless the app can show the raw signal, provider match, confidence score, and reason.

## Non-negotiable requirements

1. **ICY is the live source of truth.** Catalog providers resolve metadata; they do not prove what the station is currently playing.
2. **Spotify credentials are backend-only.** No Spotify secrets, tokens, or privileged credentials in renderer code.
3. **iTunes direct lookup is allowed as a keyless fallback.** Cache aggressively and handle misses gracefully.
4. **Every displayed catalog match must carry confidence.** UI states must include `Identified`, `Likely match`, or `Raw ICY only`.
5. **Raw metadata must remain visible.** Users should be able to see what the station actually broadcast.
6. **Do not overwrite station metadata with low-confidence catalog results.** Only high-confidence matches may upgrade the visible title/artwork.
7. **Ad, station ID, weather, traffic, and promo metadata must not be treated as songs.**
8. **All provider links must open safely.** Use `target="_blank"` with `rel="noopener noreferrer"`.
9. **The app must work without Spotify.** Spotify enriches; it must not become a hard dependency.
10. **The metadata cache must expire.** Bad matches must not live forever.

## Development loop

For each metadata change:

```bash
npm run smoke:metadata
```

For a full app rebuild in the real repository:

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e
npm run build:web
npm run build:desktop
```

## Acceptance tests

A patch is not complete unless these cases pass:

| Case | Expected behavior |
|---|---|
| `Artist - Title` | Parses artist/title and attempts catalog lookup. |
| `Title by Artist` | Parses title/artist and attempts catalog lookup. |
| `Advertisement` | Rejected as non-track metadata. |
| title-only metadata | Shows lower confidence; may resolve only if catalog match is strong. |
| iTunes exact match | Displays album, genre, art, Apple link, and confidence. |
| Spotify exact match through proxy | Displays Spotify link and source chip. |
| artist mismatch | Penalizes candidate and avoids high-confidence label. |
| karaoke/tribute match | Penalizes candidate. |
| provider outage | Keeps raw ICY title visible. |
| no proxy configured | Works with direct iTunes and Spotify search fallback links. |

## Patch-review checklist

- [ ] ICY raw string visible in UI.
- [ ] Confidence score visible in UI.
- [ ] Provider chips visible in UI.
- [ ] Catalog links are safe external links.
- [ ] Cache TTLs are bounded.
- [ ] Junk metadata filter updated if needed.
- [ ] Spotify remains server-only.
- [ ] Smoke checks pass.
