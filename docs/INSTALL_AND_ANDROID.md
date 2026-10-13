# ZabSync on the web and your home screen

**ZabSync** is the app name, with the tagline **Built for Students. Designed for Success**. The project runs as a website and includes home-screen installation support. Students can use the website without installing it.

## Included through Checkpoint 4

| Capability                                                        | Status                                            |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| Responsive website, standalone manifest, supplied university icon | Included                                          |
| Conditional browser installation prompt                           | Included when the browser offers its native event |
| iPhone/iPad home-screen instructions                              | Included in Get the App                           |
| Copy/share website link                                           | Included for a deployed non-local address         |
| Public app-shell reopening after production installation          | Included                                          |
| Prepared timetable, academic snapshot and chosen files offline    | Included; seven-day read-only access              |
| Explicit update confirmation                                      | Included; no forced reload while editing          |
| Android wrapper project, signed APK and Play preparation          | Checkpoint 5                                      |

## Local and phone testing use different addresses

The demo binds to `127.0.0.1` and is intentionally limited to the computer running it. A phone's localhost is the phone itself. The demo persona selector must not be exposed to the internet.

For a local production-build check:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001** on that computer. The service worker is not installed by the Vite development server on port 5173. A fresh compiled app visit while online allows the public shell to prepare; use Available offline to prepare a Student or Class Admin account's academic snapshot separately. The owner console is online-only and does not offer this preparation control.

For real phone use, configure Firebase, persistent SQL and private file storage, then serve the combined Node application at your HTTPS origin. Add that hostname to Firebase's authorized domains. See [GITHUB_AND_DEPLOYMENT](GITHUB_AND_DEPLOYMENT.md). A frontend-only static deployment leaves the API missing.

Browsers apply their own installation rules. HTTPS is required for ordinary hosted use; localhost/loopback are accepted development exceptions. The native installation prompt and iOS menu behavior differ. See [MDN: making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## iPhone and iPad

1. Open the deployed ZabSync website in Safari.
2. Open the Share menu, using the page menu first if required by that Safari layout.
3. Choose **Add to Home Screen**.
4. If **Open as Web App** appears, enable it.
5. Keep the name ZabSync and tap **Add**.

Launch from the icon and sign in if requested. This route does not require an App Store listing. If the action is not immediately visible, look in Edit Actions. Menu layout varies with OS versions and device policies. See [Apple's home-screen website guide](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios).

Prepare offline access from the installed/home-screen context itself. Do not assume every browser, private window and installed app shares the same device storage.

## Android and desktop browsers

When a browser emits `beforeinstallprompt`, Get the App can offer **Install ZabSync**. If the event is unavailable, use the browser's Install app/Add to Home screen menu if present, or keep using the website. The UI does not pretend the event is universally supported.

Accepting a prompt is not proof of installation. The app checks the browser's installation event and standalone display mode before claiming an installed state. Reference: [MDN: beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event).

## Icon and product identity

The active favicon and Apple touch icon are `client/public/icons/zabsync-icon.png`, a byte-for-byte copy of the supplied 447 × 447 image. `zabsync-icon.svg` is a code-created SVG container embedding that unchanged raster. It provides scalable layout while retaining the original image detail; it is not a newly vectorized university logo.

The manifest declares `sizes: any` for the SVG and the true raster dimensions for the PNG fallback. The PNG is not falsely labelled 192 or 512 pixels. Old `xvia-icon` files remain compatibility aliases for existing installations. The manifest identity remains `/` so the rename does not intentionally introduce a separate application identity at the same origin.

Actual browser icon selection and home-screen cropping remain device acceptance checks. The icons are `purpose: any`, not a verified maskable asset. If a target browser needs dedicated 192/512 raster assets, export those from the approved logo and repeat installation on that browser. References: [web.dev manifest guidance](https://web.dev/articles/add-manifest) and [MDN manifest icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons).

## What offline use actually saves

The production worker's build-stamped allowlist includes the public HTML, generated JS/CSS chunks, manifest and approved branding/icon assets. It includes lazy chunks so reopening does not silently depend on a later code download. It excludes API requests, bearer-token requests, private photos and lecture-download responses.

Student and Class Admin account snapshots and explicitly chosen file bytes use separate IndexedDB storage. Master Admin snapshots are not supported; use the university account for offline class participation. Prepare a device online, wait for the complete-sync time and shell-readiness message, then select lecture files individually with Save offline. The app shows a saved read-only view after a real connection failure. HTTP 401/403 denials do not authorize cached fallback.

Only the active prepared account can use that device store. Sign-out/account switching clears it. Offline access expires after seven days; reconnecting revalidates current access and removes invalid stored content. A disconnected browser cannot instantly receive a new account suspension. External browser downloads are independent files and cannot be revoked by the app. Full behavior and limits: [OFFLINE](OFFLINE.md).

Browser storage is not permanent and can be evicted or cleared. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Software updates

A new worker waits when an earlier version controls open tabs. The app shows an update banner. Finish editing, choose Update, then confirm **Update and reload**. Only the consenting tab reloads automatically. The new worker also understands the prior version's explicit update message.

Online navigation requests use the network; if navigation fails, the cached public shell starts the offline access flow. Existing hashed assets remain associated with their build. An uncached old lazy chunk in another open tab may require a refresh after an update; no tab is promised indefinite compatibility across deployed API changes. Save work and refresh when prompted. Reference: [MDN: skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting).

Dashboard feature switches change database settings. New code still requires a reviewed source build and deployment through GitHub.

## Android APK and Play Store

Checkpoint 5 will add the Capacitor Android project, actual-device testing and signing instructions. A hosted backend remains necessary for online accounts and shared content. We must test Firebase sign-in, API origins, private downloads, offline storage, native file handling and notifications inside the wrapper. Reference: [Capacitor Android](https://capacitorjs.com/docs/android).

For a direct download link, build and sign a release APK, preserve the signing key privately, and host the verified file over HTTPS with its version and checksum. Android may ask the user to authorize installation from that source. Updates need compatible signing. Reference: [Android app signing](https://developer.android.com/studio/publish/app-signing).

Play distribution will require the current account/testing/privacy requirements and an appropriate release bundle; verify those at release time. This checkpoint contains no APK/AAB, signing key or Play listing.

## Remaining real-device acceptance

Test the configured HTTPS build on an actual iPhone and Android: install/launch, sign-in and sign-out, portal links, the Meet the Developer page and its links, downloads, large text, keyboard/focus access, reduced motion, narrow screens and a slow connection. Prepare offline data/files, close/reopen offline, then reconnect after a membership revocation. Test an explicit update in two open tabs.

These device checks are supplied for the release process. Automated API, DOM, IndexedDB and worker harnesses ran in development; physical phones and live university-provider accounts were not available for verification in this delivery.
