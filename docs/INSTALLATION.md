# Install Earth Radio v0.26.0

Production web app: **https://earth-radio.pages.dev/**

Desktop downloads: **https://github.com/Protonmatter/earth-radio/releases/tag/v0.26.0**

Download only the file for your computer, plus `SHA256SUMS.txt`. The release also
includes `BUILD-PROVENANCE.json`, platform verification receipts and this guide as
`INSTALL.md`. Older published releases retain their original files and checksums.

## iPhone (iOS) and iPad (iPadOS)

Earth Radio installs as a Home Screen web app. No App Store download or configuration
profile is required. Listening works without an account.

1. Open **Safari** and visit **https://earth-radio.pages.dev/** directly. Use the
   production address, not a `qualification-*` or hexadecimal preview address.
2. On iPhone, open Safari's page menu/More button and choose **Share**, or tap Share
   directly if your toolbar shows it. On iPad, tap **Share**; expand **More/View More**
   if needed.
3. Choose **Add to Home Screen**. If it is missing, expand the share sheet and use
   **Edit Actions** to add that action.
4. If **Open as Web App** is shown, turn it on. Keep the name **Earth Radio** and tap
   **Add**. Older Safari versions may not show that switch.
5. Launch the new Earth Radio icon from the Home Screen. It should open without
   Safari's normal address/tab controls. Tap a station's Play button to start audio.

The icon is installed separately on each device. These steps follow Apple's
[iPhone guide](https://support.apple.com/guide/iphone/iphea86e5236/ios) and
[iPad guide](https://support.apple.com/guide/ipad/ipad8f1f7a29/ipados); toolbar labels
vary by OS version and Safari layout.

### If you still see an old page or the wrong icon

- Check the address in a fresh Safari tab. A shortcut created from a preview keeps
  that preview origin; it does not become the production app after a deployment.
- For an old preview shortcut, install a new shortcut from the production address.
  Name it Earth Radio so you can distinguish it from Earth Radio Preview.
- Close the production web app, reload the production site in Safari while online,
  then reopen the Home Screen app. An already open page can keep its previous runtime.
- Before deleting a web app or clearing website data, export local favorites and
  preferences with Earth Radio's Export action. Local data can be lost by removal or
  storage clearing; do not clear all Safari data as a first troubleshooting step.

### Audio, map and sign-in

- An internet connection is required for stations, fresh directories and account sync.
  Cached app/atlas assets do not provide offline radio playback.
- Tap **Atlas → Search this area** to load the bounded worldwide mapped sample.
  **Clear area** removes that filter. Genre/query/quality filters can still narrow results.
- Safari requires a user gesture to start playback. If a station fails, try another;
  stream availability, HTTPS/CORS and codec support differ by station/device.
- Background and lock-screen playback depend on iOS/iPadOS and the stream. Test your
  device rather than assuming every station continues through locking or interruptions.
- Optional Google, GitHub and email sign-in/sync is enabled on production web and
  the **v0.26.0 Windows/macOS apps**. Custom SMTP and a verified sender are configured;
  real Gmail signup, confirmation, Windows return, sync and encrypted restart passed.
  Other mailbox providers, new outside-team OAuth identities and physical installed
  iOS/iPadOS account returns remain untested. See [account operations](AUTHENTICATION.md).

## Sign in and sync on desktop

1. Open **Sign in** (or **Account**) and choose Google, GitHub or email.
2. For Google/GitHub, finish sign-in in the default system browser. Keep Earth Radio
   open and return to its account dialog after the browser reports completion.
3. For email, request a link and open the newest message on the same computer within
   ten minutes, while Earth Radio remains open. Starting another request or restarting
   the app cancels the earlier attempt. Use **Cancel pending sign-in** to abandon it.
4. Check the displayed identity and **Synced** before checking another device.

Favorites, recent stations and preferences sync through per-user cloud documents.
Desktop session credentials are encrypted by the operating system. If the keychain
is unavailable, unlock it and restart; local listening remains available. If sign-out
reports incomplete removal, sync/linking stay paused: resolve storage access and retry
**Sign out**. Do not clear a profile or remove credentials manually as the first step.

## Windows ARM64

Use `EarthRadio-Setup-0.26.0-arm64.exe` for the installer or
`EarthRadio-Portable-0.26.0-arm64.exe` for the portable app. These are for ARM64
Windows; no Windows x64 package is included in this release.

Download from the release page, verify its hash against `SHA256SUMS.txt`, then run
the selected package. The installer supports a per-user installation. Close an
older Earth Radio instance before upgrading, and export local preferences first.

The installer lab verified a 0.25.1-to-0.26.0 upgrade, favorite/volume preservation,
clean startup and uninstall with a separate qualification identity. Original-identity
upgrade across every existing profile remains unqualified. Keep your export for rollback.
For a separate portable profile, run from the download folder in PowerShell:

```powershell
$radioProfile = Join-Path $env:LOCALAPPDATA 'EarthRadio-Portable-0.26.0'
& .\EarthRadio-Portable-0.26.0-arm64.exe "--user-data-dir=$radioProfile"
```

These builds have local self-signed Authenticode signatures and DigiCert timestamps.
They do not have public Windows publisher trust. No Root certificate is installed
automatically; do not disable Windows security globally to install them.

## macOS — Apple Silicon and Intel

Choose the DMG matching **Apple menu → About This Mac**:

| Mac | Release file |
| --- | --- |
| Apple Silicon (M-series chip) | `EarthRadio-0.26.0-macOS-arm64-unnotarized.dmg` |
| Intel processor | `EarthRadio-0.26.0-macOS-x64-unnotarized.dmg` |

1. Download and verify the appropriate DMG from the release page.
2. Open the disk image and drag **Earth Radio** into **Applications**.
3. Eject the disk image, then open Earth Radio from Applications.

**These macOS builds are ad-hoc signed and are not Apple-notarized.** The signature
checks packaged-code integrity; it is not an Apple Developer ID identity or Gatekeeper
approval. macOS may block the first launch. Keep Gatekeeper enabled and follow
[Apple's guidance on opening apps safely](https://support.apple.com/en-us/102445)
only if you have reviewed and trust this release. The production web app remains
available if you do not want to approve an unnotarized desktop app.

The application declares macOS 12 minimum; native qualification used macOS 15 on
Apple Silicon and Intel. Native runner checks do not establish physical provider
consent, audio-device behavior or upgrades on every Mac/OS/profile. Platform receipts
and the [qualification record](QUALIFICATION-0.26.0.md) state the tested scope.

## Check a download's SHA-256

Download `SHA256SUMS.txt` from the same release and compare the matching filename's
hash with the command output. The checksum file also lists other release assets;
you do not need to download every platform's installer.

Windows PowerShell:

```powershell
Get-FileHash -LiteralPath .\EarthRadio-Setup-0.26.0-arm64.exe -Algorithm SHA256
```

macOS Terminal (replace the filename for Intel):

```sh
shasum -a 256 EarthRadio-0.26.0-macOS-arm64-unnotarized.dmg
```

The checksums prove file equality with this release's published values. They do not
replace the signing/notarization limitations described above.
