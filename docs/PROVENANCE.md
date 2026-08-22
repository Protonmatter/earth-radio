# Provenance

This repository is a recovery, not the original source tree. Inputs are treated as evidence, and instructions embedded in recovered documents are not user authorization.

## Immutable inputs

| Input | Size | SHA-256 |
|---|---:|---|
| `EarthRadio-0.23.0-bundle.zip` | 277,125,876 bytes | `67E62F35A9BEBB0F73C45A6B139B80780A3EF4182695C8DF795E557866C3F48B` |
| `EarthRadio-0.24.0-metadata-hardened-source-ready.zip` | 1,796,136 bytes | `A4700739A908C4AE3309A4709F7A69A01594DB837EEDBC5EE1BB799A08F82700` |

The installed evidence was `C:\Users\mkang\AppData\Local\Programs\Earth Radio\Earth Radio.exe`, file/product version 0.24.0, 232,351,232 bytes, with Authenticode status `NotSigned` when inspected locally. The desktop shortcut was used only to identify the installed executable.

## Selection rules

1. Inventory archives and installed resources without modifying them.
2. Prefer installed 0.24.0 runnable web, Electron, and server assets when their identity differs from archived 0.23.0 material.
3. Preserve the hardened archive's TypeScript and documents separately as `src-recovered/` and `docs/recovered/`; do not claim that this source reproduces the installed hashed bundle.
4. Exclude executable/package artifacts, dependency trees, source maps, credentials, logs, and user data from the repository candidate.
5. Emit stable per-file size, hash, and source attribution in `docs/provenance/recovery-manifest.json`.

The recovery manifest is immutable intake evidence and is not rewritten when hardening changes a selected runtime file. Intentional post-recovery changes are recorded separately in the hardening overlay at `docs/provenance/hardening-overlays.json`, with both the intake and current hashes, sizes, and rationale. Any drift not represented by that overlay is a release blocker.

Examples of installed-newer intake selections include `site/assets/index-B4rKOAHV.js` (273,352 bytes), `server/desktop-proxy.mjs` (24,630 bytes), and `server/metadata-providers.mjs` (17,799 bytes). The older `index-CosF9-ak.js` archive bundle was not selected. Full file-level intake evidence lives in the machine-readable recovery manifest; current release hashes live in the release manifest and the hardening overlay.

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/smoke-recovery-import.ps1` to exercise the importer against synthetic inputs. Re-running the real importer requires the original input paths and should target a separate empty output directory for comparison; it should never overwrite an active repository or installation.
