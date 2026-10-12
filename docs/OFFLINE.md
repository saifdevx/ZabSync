# ZabSync offline access — Checkpoint 3

Students and Class Admins can reopen prepared class information without a connection. The Master Admin console stays online-only. Students explicitly prepare their own device while signed in and online. The saved view is read-only, lasts up to seven days after a complete refresh, and includes only the account's authorized academic content.

## Start with a local production build

Finish the beginner setup in [START_HERE](START_HERE.md), then stop the development server and run these commands from the project folder:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001** on the same computer. The development address on port 5173 deliberately does not register a service worker. A production build is needed to save every compiled application file for reopening.

For a phone, use the deployed **HTTPS website address** with real university authentication configured. A computer's `127.0.0.1` address cannot be used to reach that computer from another device. The fictional demo is restricted to loopback development and must not be exposed as a public university login. Service workers require a secure context; browsers make an exception for local development on loopback addresses. See [MDN's service worker guide](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) and [GITHUB_AND_DEPLOYMENT](GITHUB_AND_DEPLOYMENT.md).

## Prepare and use your device

1. Sign in online with a verified, active account and join the classes you need.
2. Open **Offline access** and select **Prepare offline access**. Wait for the complete sync to finish.
3. Check both indicators: **Last complete sync** must show a time, and **Reopen the app offline** must say the app is ready in that browser. If the second indicator is unavailable, open the secure site online and refresh the page once.
4. Open class resources and select **Save offline** for each lecture file you want. The file appears in the offline library only after its authenticated download and storage transaction succeed.
5. Disconnect and reopen the same website or installed home-screen app in the same browser profile. Prepared class pages, announcements, timetable and deadlines use the saved information. The app clearly shows that it is offline.
6. When connected again, select **Reconnect**. ZabSync checks your current identity and permissions. A previously prepared account with a valid online session then receives a fresh complete snapshot. You can also select **Refresh offline information** before leaving campus.

The application files and the account snapshot are separate. A successful class snapshot alone cannot guarantee that a closed browser will reopen the app: its public application files also need to be ready. Preparation does not turn on a background downloader for every lecture.

## What works offline

| Area                            | Saved behavior                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Classes and subjects            | Read prepared class details and subject lists. Membership rosters, pending approvals and invitation secrets are omitted.                                           |
| Announcements                   | Browse the authorized subject, whole-class and university-wide notices captured during preparation. Saved/bookmarked states are included as read-only metadata.    |
| Timetable                       | Read the recurring weekly routine, extra sessions, cancellations and rescheduled sessions. Select another week using the complete saved routine and dated changes. |
| Quizzes, assignments and events | Read saved deadlines and the personal completion state recorded at synchronization. Changing completion requires a connection.                                     |
| Files                           | Open or download an offline copy only when its bytes were explicitly saved on that device. File titles alone do not mean a file was downloaded.                    |
| Notifications                   | Read the saved announcement inbox. New notifications and marking items read require a connection.                                                                  |
| Account                         | Recognize the previously verified saved identity. Editing a profile or photo and creating a new login require a connection.                                        |

Creating or joining a class, editing academic information, uploading files, changing bookmarks, managing users and owner controls require internet. There is no offline write queue. A button or a direct API call cannot silently defer an edit for later transmission.

The timetable uses the same pure date resolver as the server, in `server/schedule.ts`. Dates and times use **Asia/Karachi**. Preparation reads every dated-exception page with `all=true` and every deadline page without a date filter; future weeks are not limited to the currently open screen. It cannot know about a change that was published after the last sync.

## Bookmark, Save offline and Download

These actions serve different purposes:

| Action                         | Result                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bookmark / Saved for later** | Saves an account reference. It does not download the resource's file bytes.                                                                |
| **Save offline**               | Downloads the authorized resource into the current account's private device library. The library tracks its version, size and permissions. |
| **Download / Download copy**   | Hands a separate file to the browser or device. The student manages that copy in their downloads or files app.                             |

Use **Remove … from this device** to remove one in-app copy. **Clear this device** removes the account snapshot and all in-app offline files. It preserves the online account and university class content. Signing out or changing accounts also clears the former account's saved data. These actions cannot remove a separate file already exported to a downloads folder.

## Storage limits and freshness

| Limit in this checkpoint                       | Behavior                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One saved account per browser origin           | Signing in as another account replaces the former account's device scope. Browser profiles and website addresses have separate storage.                |
| Seven days after a complete sync               | Saved access expires. Permission checks and file downloads do not extend this time; a successful complete preparation does.                            |
| 150 MiB of explicitly saved file bytes         | The app checks the complete total in an IndexedDB transaction. Replacing an existing copy does not count it twice.                                     |
| 20 MiB for the academic snapshot               | Oversized information is rejected before replacing the last saved snapshot.                                                                            |
| Up to 20 accessible classes per preparation    | A larger student/Class Admin account receives a clear limit error. The owner uses the online console instead of this device store.                     |
| Up to 10,000 records in a paginated collection | Preparation follows pages of 100, checks totals and identities, and rejects inconsistent or incomplete results. Backend per-class limits may be lower. |

The file budget is an application cap, not reserved disk space. Browser quotas depend on the browser and device, and storage can be evicted or cleared. A private browsing session may not retain data after closing. If IndexedDB is denied or storage fills up, the app reports the problem while ordinary online use remains available. Treat the offline library as a convenience copy. See [MDN's storage quota and eviction guidance](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [IndexedDB guidance](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).

## Identity, privacy and reconnection

Only an explicit preparation made after successful online verification can create a private snapshot. Offline startup may reopen that same unexpired account. It cannot verify a new email, create a Firebase session, manufacture a demo token or grant editing privileges.

For example, a new demo tab can read the already prepared account while offline even though its session storage contains no demo token. On reconnection it must use a real demo sign-in before online access becomes editable. Firebase's own session persistence remains under the Firebase SDK; the offline subsystem does not copy its tokens into its snapshot or public cache.

The app checks current identity and `/api/offline/access` before and after a full preparation. Student and Class Admin classes must match their approved memberships. The Master Admin console is online-only; preparation rejects it before downloading academic content, and legacy owner snapshots cannot reopen. Every saved view still runs in read-only mode.

On reconnection and before online use of an offline file, the server supplies the current access manifest. ZabSync removes lost classes, hidden subjects, deleted announcements, changed or deleted resources and disabled feature content. A dated override also disappears when its weekly parent is no longer visible. Changed file versions invalidate their stored bytes; saving the current version requires another authenticated download.

An HTTP **401 or 403** is an authoritative denial and never triggers an offline fallback. The affected account's saved access is cleared. Other HTTP failures also remain API failures. Only an actual transport failure may fall back to an eligible saved view. The browser's online/offline events help the interface react, but do not prove that the university server is reachable; see [MDN's `Navigator.onLine` guidance](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine).

Account epochs and snapshot revisions protect asynchronous work. A delayed old-account request cannot erase another account's newly prepared data. A late permission check cannot overwrite a newer complete sync or restore scope removed by a newer check. Clear and logout cancel pending preparation. Expiry cleanup checks the observed revision so an old timer cannot delete a fresh snapshot. Other tabs receive storage/channel signals and refresh their mounted saved views when access changes; permission pruning preserves the true last-full-sync timestamp.

Use preparation only on a device you control. The browser's stored information is not an encrypted vault or a second device password. Someone who can open that browser profile can read its prepared content. A device that is already disconnected cannot learn about a new suspension or lost membership until it reconnects or its saved-access period expires. No application can recall an independent downloaded copy. The server continues to enforce current permissions on every online request.

## Public application cache

`client/public/sw.js` stores only a build-generated allowlist of public application files: the HTML shell, offline help page, manifest, icons, branding and compiled public assets. The build script includes every emitted JavaScript/CSS chunk, including lazy Firebase imports. The cache version depends on built content, so a new deployment receives a new version.

The worker bypasses `/api`, authenticated requests, authentication redirects, private uploads/downloads, non-GET requests and cross-origin URLs. It does not store class API responses, tokens, profile photos or lecture files. A failed page navigation can load the public application shell; the separate account-scoped IndexedDB checks then decide whether any private saved view is eligible.

Updates wait for the student's explicit update action. The worker does not automatically take over an existing tab and reload an unsaved form. The offline readiness check verifies that all approved public files are present; merely registering a worker is insufficient.

Implementation map:

| File                          | Responsibility                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `client/src/offline-store.ts` | IndexedDB transactions, account epochs, snapshot revisions, expiry, file budget and permission pruning. |
| `client/src/offline-data.ts`  | Complete authorized preparation and the strict read-only response allowlist.                            |
| `client/src/auth.tsx`         | Verified identity, opt-in, transport-only fallback, scoped revocation, logout and reconnection.         |
| `client/src/OfflinePage.tsx`  | Preparation, readiness, sync time, library, download, removal and clearing controls.                    |
| `client/public/sw.js`         | Public shell caching and deliberate worker activation.                                                  |
| `scripts/stamp-web-build.mjs` | Deterministic cache version and compiled-asset discovery.                                               |
| `server/offline-access.ts`    | Complete server-authorized visibility manifest.                                                         |

## Verification and physical-device checks

Run the focused checks with:

```sh
node --import tsx --test tests/offline-store.test.ts tests/offline-data.test.ts tests/offline-auth.test.tsx tests/pwa.test.ts
```

The focused suite exercises the store, complete API snapshots, the real AuthProvider and the public worker. See [VERIFICATION](VERIFICATION.md) for the current test totals. It uses the actual Fastify application, SQLite, real authorized API responses and real multipart/download paths. IndexedDB tests use `fake-indexeddb`; one quota test deliberately injects a quota error because that implementation does not impose real disk limits. A simulated DOM exercises the real AuthProvider and mounted data hook. A worker harness exercises public-cache behavior, and a real script process checks build stamping.

The checks cover rejection and cleanup of owner snapshots, complete pagination, future-week equivalence with the server, role scope, stored file contents and limits, account switching, read-only reopening without creating credentials, HTTP denial, cleared/suspended access, stale commits, expiry races, Clear during preparation, cross-tab notice pruning, storage denial, public-only caching and explicit updates. They are not physical iPhone/Android tests, load tests, or proof of live Firebase/Turso/R2 connectivity.

Before releasing to students, perform this device check on the configured HTTPS deployment:

1. On a real iPhone and Android phone, sign in, prepare access, confirm both readiness indicators and save a lecture.
2. Enable airplane mode, close and reopen the browser/home-screen app, then read the file, a notice, another timetable week and a deadline. Confirm the saved-view indicator and that editing is unavailable.
3. Reconnect after changing a timetable entry, deleting a resource or removing a test account's membership elsewhere. Confirm fresh permissions and content replace the old saved view.
4. Open two tabs, update access in one and confirm the other's mounted saved view refreshes. Sign out, then try reopening offline; the former account must no longer appear.
5. Test a full device-storage condition and a browser with website storage disabled; the online account should continue working and offline actions should report a useful error.
6. Deploy a small version change while a form has unsaved text. Confirm the update is offered and reload occurs only after the user chooses it.

The home-screen and Android packaging steps are documented separately in [INSTALL_AND_ANDROID](INSTALL_AND_ANDROID.md). This checkpoint supplies a working web/PWA offline implementation; it does not include a signed APK or scheduled push-reminder service.
