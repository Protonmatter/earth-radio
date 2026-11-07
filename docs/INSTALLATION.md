# Install Earth Radio v0.25.1

Production web app: **https://earth-radio.pages.dev/**

Desktop downloads: **https://github.com/Protonmatter/earth-radio/releases/tag/v0.25.1**

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
- Optional account sign-in/sync is enabled on the production web origin. Google is
  External/In production, GitHub is enabled, and new signups are allowed. Public email
  delivery is awaiting a verified sender domain and custom SMTP. The published
  **v0.25.1 desktop builds** keep local preferences and do not enable hosted sign-in.
  The **0.26.0 desktop candidate** adds Google/GitHub and email-link sign-in through the
  default browser, encrypted session recovery and account sync. Keep Earth Radio open
  while signing in; return to its account dialog and check **Synced**. Email becomes
  generally available after the sender setup is qualified. See the
  [account guide](AUTHENTICATION.md) for candidate status and troubleshooting.

## Windows ARM64

Use `EarthRadio-Setup-0.25.1-arm64.exe` for the installer or
`EarthRadio-Portable-0.25.1-arm64.exe` for the portable app. These are for ARM64
Windows; no Windows x64 package is included in this release.

Download from the release page, verify its hash against `SHA256SUMS.txt`, then run
the selected package. The installer supports a per-user installation. Close an
older Earth Radio instance before upgrading, and export local preferences first.

These builds have local self-signed Authenticode signatures and DigiCert timestamps.
They do not have public Windows publisher trust. No Root certificate is installed
automatically; do not disable Windows security globally to install them.

## macOS — Apple Silicon and Intel

Choose the DMG matching **Apple menu → About This Mac**:

| Mac | Release file |
| --- | --- |
| Apple Silicon (M-series chip) | `EarthRadio-0.25.1-macOS-arm64-unnotarized.dmg` |
| Intel processor | `EarthRadio-0.25.1-macOS-x64-unnotarized.dmg` |

1. Download and verify the appropriate DMG from the release page.
2. Open the disk image and drag **Earth Radio** into **Applications**.
3. Eject the disk image, then open Earth Radio from Applications.

**These macOS builds are ad-hoc signed and are not Apple-notarized.** The signature
checks packaged-code integrity; it is not an Apple Developer ID identity or Gatekeeper
approval. macOS may block the first launch. Keep Gatekeeper enabled and follow
[Apple's guidance on opening apps safely](https://support.apple.com/en-us/102445)
only if you have reviewed and trust this release. The production web app remains
available if you do not want to approve an unnotarized desktop app.

Native runner checks do not establish compatibility on every physical Mac, OS version,
audio device or user profile. Release verification reports state the actual tested host.

## Check a download's SHA-256

Download `SHA256SUMS.txt` from the same release and compare the matching filename's
hash with the command output. The checksum file also lists other release assets;
you do not need to download every platform's installer.

Windows PowerShell:

```powershell
Get-FileHash -LiteralPath .\EarthRadio-Setup-0.25.1-arm64.exe -Algorithm SHA256
```

macOS Terminal (replace the filename for Intel):

```sh
shasum -a 256 EarthRadio-0.25.1-macOS-arm64-unnotarized.dmg
```

The checksums prove file equality with this release's published values. They do not
replace the signing/notarization limitations described above.
