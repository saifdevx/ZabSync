# XVIA on the web and your home screen

XVIA is the short app name. **Node Compass Task** is the full product name used alongside it. This checkpoint includes a web manifest, the university icon you supplied, installation help, a browser installation button when supported, and a public reconnect page.

You can use the web app without installing it. Installation adds convenient access from a home screen or apps list; it does not create a separate university account.

## What is available in Checkpoint 2

| Feature                                                         | Status                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| Responsive website                                              | Included                                                   |
| Manifest with app name, icon, launch URL, and standalone mode   | Included                                                   |
| iPhone and iPad installation instructions                       | Included on **Get the app**                                |
| Native browser install button                                   | Appears only after the browser emits `beforeinstallprompt` |
| Website copy/share link                                         | Included for a deployed, non-local website                 |
| Public reconnect page after the production worker is installed  | Included                                                   |
| A prompt before applying a service-worker update                | Included; no automatic page reload while someone edits     |
| Offline timetable and saved class data                          | Checkpoint 3                                               |
| Android project, signed APK, and Play Store release preparation | Checkpoint 5                                               |

No APK, App Store listing, public deployment, or live installation test is claimed in this ZIP.

## First, use a deployed HTTPS website for phone testing

The local demo binds to `127.0.0.1` and deliberately refuses access from other computers. The address on your computer is not a website students can open on their phones. Do not expose the demo account selector publicly.

To test the phone experience, configure the real Firebase authentication path, configure persistent SQL and file storage, and deploy the production build to a public HTTPS address. See [GitHub and deployment](GITHUB_AND_DEPLOYMENT.md) for the Render production configuration. The owner chooses and controls that domain and hosting account.

Add the deployed domain to Firebase's authorized domains and use the same origin for the frontend and API. Check the environment configuration guide before deploying. The production app requires its server and database; uploading the frontend alone to static hosting is insufficient.

The service worker is registered only in a production client build on a secure context. It is not registered by `npm run dev`. Browsers generally allow localhost as a secure development context, but that exception is only for the computer opening the local address. For students using their own devices, use HTTPS. See [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

For a compiled local check, run `npm run build` followed by `npm start`, then open `http://127.0.0.1:3001` on that computer. This can check the production files locally; it does not make the demo available on a phone.

## iPhone and iPad

1. Open your deployed XVIA website in **Safari**.
2. Open **Share**. On some Safari layouts, open the page menu first.
3. Choose **Add to Home Screen**.
4. If your version displays **Open as Web App**, turn it on.
5. Keep the name **XVIA**, or choose your own local label, and tap **Add**.

Open the new home-screen icon and sign in if requested. These steps use the website and do not require an App Store release. Browser/OS versions can differ in their menu layout. Apple's guide explains the current options: [Add a website icon to your Home Screen](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios).

If you cannot see **Add to Home Screen**, check **Edit Actions** in Safari's share sheet. If a school or device-management policy removes installation, students can still open XVIA in the browser. No workflow bypasses their device's restrictions.

## Android and desktop browsers

Open the deployed website in a browser with web-app installation support. When the browser offers installation, XVIA's **Install XVIA** button opens that native prompt. Otherwise look for **Install app** or **Add to Home screen** in the browser menu. The wording and availability depend on the browser and device.

The install button is intentionally conditional. `beforeinstallprompt` is not supported in every browser and has no guaranteed firing time. The app keeps the event when it arrives and shows the button only then; it does not display a nonworking native-install button. See [MDN: beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event).

Choosing an install prompt is not treated as proof of installation. XVIA uses the browser's `appinstalled` event or standalone-display detection to show the installed state.

## The supplied icon

- `client/public/icons/xvia-icon.png` is a byte-for-byte copy of the 447 × 447 PNG supplied in this conversation.
- The PNG is the favicon and Apple touch icon.
- `client/public/icons/xvia-icon.svg` is a code-created SVG container that embeds the unchanged PNG at a scalable layout size. It does not redraw or vectorize the university logo, and the underlying image still contains its original 447-pixel detail.
- The manifest declares `sizes: "any"` for the SVG and the true `447x447` size for the PNG fallback. It does not label the PNG as a size it does not have.
- The icon uses `purpose: "any"`; it is not claimed to be a tested maskable Android icon.

Google's [web app manifest guide](https://web.dev/articles/add-manifest) documents SVG support in Chromium and recommends a raster fallback. [MDN's icons reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons) describes `any` for scalable SVG icons. Actual icon selection and home-screen appearance still need to be checked on the target devices before release. If a target browser does not install from these assets, add verified 192 × 192 and 512 × 512 raster exports from the approved logo and repeat that device's install test.

## Offline behavior and privacy

Checkpoint 2's worker caches only two public files: `/offline.html` and `/icons/xvia-icon.png`. An online page navigation comes from the network. If that navigation cannot reach the network, the worker returns the public reconnect page.

It does **not** cache the authenticated app, class pages, announcements, lecture files, API responses, profile photos, Firebase responses, or any request carrying an Authorization header. API routes and upload/download paths bypass the worker. It does not queue writes or claim background sync.

You must have opened the production website successfully while online for the worker and reconnect page to be available. Browser storage can be cleared or evicted. The saved timetable, explicit file downloads, per-user offline stores, sync timestamps, and offline-reopening requirements remain part of Checkpoint 3.

## Updating safely

The worker waits when a newer version is ready. XVIA displays an update banner instead of replacing the page immediately. The student chooses **Update**, is reminded to save their edits, and then chooses **Update and reload**. Only the tab that confirms the action reloads; other tabs are not forcibly reloaded.

The implementation uses `skipWaiting()` only in response to that explicit update message. See [MDN: ServiceWorkerGlobalScope.skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting).

After a deployment, a fresh network page load also receives the current frontend, since this checkpoint does not cache the authenticated application shell. New software is delivered by a reviewed build and deployment. Dashboard controls change stored content and enable or disable implemented features; they do not install arbitrary code into a running server.

## Android APK and Play Store plan

The planned Android wrapper is Capacitor. Its Android runtime connects a web application to native Android capabilities and is managed with Android Studio: [Capacitor Android documentation](https://capacitorjs.com/docs/android).

Checkpoint 5 will add the Android project, device testing, and release instructions. We will configure the production API origin, authentication behavior, allowed origins, storage, download handling, and later notification/offline integration for the native build. Wrapping the UI does not remove the need for a hosted backend and persistent storage.

For direct distribution, the owner will build and sign an APK, keep its signing key private, and publish the verified file at a stable HTTPS download link with a version and checksum. Users may need to allow installation from that source according to Android's device rules. App updates must use a compatible signing identity. A direct-download APK is separate from the web installation described above. See [Android: Sign your app](https://developer.android.com/studio/publish/app-signing).

For the Play Store, prepare the required Android App Bundle and complete the current developer-account, testing, privacy, and store requirements at release time. Those requirements may change; we will verify them again when you are ready to publish. No signing key, developer account, or store publication is needed to try this checkpoint locally.

## Device checks to perform before release

These are remaining acceptance checks, not completed-test claims:

1. iPhone Safari: open, add to home screen, launch, sign in, sign out, follow portal/tutor links, and open/download a permitted file.
2. Android Chrome: verify the actual manifest and icons, install, launch, and check navigation and file behavior.
3. On both devices: confirm that no class data becomes visible across account switches, that the public reconnect page appears after a successful initial visit, and that unsaved edits are not lost to an automatic update.
4. Deploy another build: confirm the update prompt appears when a new worker is waiting and only the consenting tab reloads.
5. Repeat with keyboard navigation, large text, reduced motion, narrow screens, and a slow connection.

This checkpoint includes source and automated checks for the implementation. A production hosting account, university mailbox, physical phone, and actual browser installation were not available for live verification here.
