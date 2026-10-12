# ZabSync Checkpoint 3 v0.3.1 verification suite

From the extracted project root:

```sh
npm ci
npm run build
npm test
```

The suite uses Node's built-in runner through the pinned `tsx` loader. You can also invoke it directly:

```sh
node --import tsx --test tests/*.test.ts tests/*.test.tsx
```

Build first so static delivery tests inspect the current compiled client and stamped service worker. Missing build validation is not a successful release gate. See `docs/VERIFICATION.md` for the final run and remaining device/provider checks.

Fixtures use isolated temporary SQLite databases and private file directories under `tests/`, or an isolated in-memory database. They never use the development database, contact university mailboxes, or send requests to live Firebase, Turso, R2, or OpenAI services. Multipart temporary files are removed by the actual upload lifecycle. Injected cloud failures exercise failure handling without claiming a live-provider test.

## Backend permissions, identity, and operations

| File                        | Coverage                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity-policy.test.ts`   | Exact verified-domain policy, malformed/lookalike addresses, staff mailboxes, immutable UID, explicit owner setup, fail-closed configuration, production demo/verifier restrictions, and derived numeric roll-number display.                       |
| `firebase-boundary.test.ts` | Real HTTP verification boundary through the explicit test seam, rejected claims excluded from account creation, no first-user owner inference, owner bootstrap/enrollment/appointment, and staff addresses requiring approved membership.           |
| `access-control.test.ts`    | Missing/invented sessions, spoofed identity headers, cross-class reads/edits, owner-only endpoints, and minimal student rosters without peer emails or pending request/invite data.                                                                 |
| `class-workflow.test.ts`    | Direct creation by current class admins/owner, student denial, retired approval endpoints, pending join privacy, approval audience matching, and retained membership outcomes.                                                                      |
| `representatives.test.ts`   | The historical filename now tests the single admin role: owner-only appointments, multiple admins, same-token demotion, recovery without an admin, member removal, explicit re-enrollment, suspended/unknown targets, and archived-class authority. |
| `owner-hierarchy.test.ts`   | Owner-only semester/section/roster traversal, pagination, accurate active-enrollment totals, complete suspended-member management views, stable user IDs, current names/handles, and numeric roll numbers without disclosure to ordinary peers.     |
| `invites.test.ts`           | Rotation and expiry, using fresh sessions after advancing time so an expired login cannot masquerade as invite enforcement.                                                                                                                         |
| `demo-boundaries.test.ts`   | Loopback peer/Host/origin/listener restrictions; forwarded headers cannot make a remote client local; only Student, Class Admin, and Master Admin are selectable.                                                                                   |
| `concurrent-writes.test.ts` | Concurrent duplicate direct class submissions produce one class and one conflict, without duplicate rows or a database error.                                                                                                                       |
| `operations.test.ts`        | Unique handles without identity changes; private Developer drafts, publication, links/app validation and stale conflicts; feature controls; maintenance/recovery; suspension; decoded private photos; cleanup retries and partial writes.           |
| `rate-limits.test.ts`       | Independent users on one IP, token/header changes that do not reset a user quota, failed identities counted by peer, static assets avoiding identity work, and storage validation before database creation.                                         |

Global account roles remain `student` and `master`; `admin` is class-scoped. The suite checks actual authorization behavior as well as the absence of controls in the client.

The correction adds these regressions:

| File                                  | Coverage                                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner-account.test.ts`               | Exact verified external owner email plus pinned UID, private configuration, denial of silent ownership replacement, read-only transfer preview, transactional rollback and history preservation, enrolled-only lists, and rejection of new owner memberships. |
| `student-content-permissions.test.ts` | Thirty-two valid direct shared-content mutations are denied for students, including real multipart lecture uploads. Database content, versions, audit history and file storage remain unchanged; personal deadline completion stays available and isolated.   |
| `frontend-permissions.test.ts`        | Missing, unknown, suspended and wrong-class roles never grant editing controls; owner powers require the owner workspace context.                                                                                                                             |

## Academic content and planning

| File                       | Coverage                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `academic.test.ts`         | Subject CRUD/trash/restore, three announcement scopes, private resources and attachments, bookmarks/search/read state, parent/member visibility, feature switches, quota failures, and roles changing during upload.                                                                                                         |
| `academic-storage.test.ts` | Valid PPTX metadata; malformed/macro/executable/traversal/unsafe-XML rejection; opaque private keys; header sanitization; R2 configuration; actual multipart rejection at 25 MiB + 1 byte.                                                                                                                                   |
| `timetable.test.ts`        | Karachi calendar/time conversion, scoped/versioned weekly CRUD, impossible times/dates, parent/subject validation, one-time cancellation/extra/reschedule, cross-week changes, overlap detection, versioned personal deadline completion, complete pagination, maintenance/flags/revocations, and concurrent edit conflicts. |

The cases exercise consequences a student would notice: another class's notices stay hidden; removed members cannot fetch private bytes; bookmarks never create independent access; deleted parents hide child content; file trash still counts toward quota; a one-time schedule change preserves the recurring template; a changed deadline invalidates an older personal completion.

Document-format acceptance is not antivirus verification. These tests do not establish that every accepted PDF, PPT, or PPTX is harmless.

## Rendered React journeys

Six UI journey files render the production React app, router, authentication provider, site settings, and forms in jsdom. `ui-harness.ts` sends every API request to the actual Fastify application and SQL database. It records request payloads and responses and asserts that successful journeys contain **no unexpected HTTP errors**. External requests are rejected by the transport.

| File                      | Journey                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui.test.tsx`             | An ordinary student sees no class creation or owner controls. A class admin creates a class directly, opens it, submits a valid details edit, generates an actual expiring invitation, and copies the returned code. No retired class-approval request is sent.                                                                                                                                                                                                                                                                                                                    |
| `checkpoint2-ui.test.tsx` | A class admin creates a subject and a class-wide notice. A student sees it without edit controls and saves it, then opens a read-only subject. The owner saves a private Developer draft and publishes it; students follow the Get the App link to the separate Meet the Developer page and see the published introduction, portfolio and app links. The student updates a profile, uploads a real image through native multipart decoding/sharp/private storage, and removes it without changing authenticated identity.                                                          |
| `checkpoint3-ui.test.tsx` | The owner bootstraps a class from the dashboard, follows semester → section → People, enrolls a registered numeric-email fixture, and sees its roll number and full immutable ID. Owner role controls promote and demote the account. A class admin creates/edits a weekly session with teacher/day/time, reschedules one occurrence while explicitly clearing its teacher/room, and adds a quiz deadline. The ordinary student follows the original session’s destination-date link, sees the moved timetable without edit controls, and completes only their own checklist item. |

`feature-controls-ui.test.tsx` adds a focused settings regression: with subjects, resources, timetable, and profile photos disabled before login, the app waits for confirmed settings and never requests those APIs. It delays real `/site` responses through Fastify without replacing their payloads, bookmarks an allowed announcement, and verifies that page filters survive the refresh. A retained photo version exercises header, People, and profile photo controls without permitting an avatar request. Disabled class tabs stay hidden.

`role-boundaries-ui.test.tsx` checks the student-only interface, a Class Admin who is read-only in a second enrolled section, the separate owner navigation and redirects, scoped owner announcement creation, and Developer page/editor states. `weekly-timetable-ui.test.tsx` checks all seven day panels together, per-day creation, versioned editing, teacher/room display, a cross-week move and restoration, owner section planning, student read-only controls, and saved-week navigation with network requests blocked.

The DOM harness supplies the browser capabilities jsdom lacks: dialog open/close state, clipboard behavior, and a test IndexedDB factory. Request, Response, File, Blob, and FormData remain native, so photo uploads use real multipart serialization rather than a replacement API result. The transport drains in-flight requests before closing the document.

This is interaction and integration testing, not CSS screenshot review or a phone benchmark. jsdom does not validate top-layer focus, native installation prompts, downloads on a real phone, touch targets, animations, or OS storage eviction.

## Offline data and service-worker boundaries

`offline-manifest.test.ts` exercises the server's authorized offline manifest with a real read transaction, active class/parent/resource visibility, absent private storage keys, and archived/revoked/suspended account behavior.

`offline-data.test.ts` builds complete account-scoped snapshots from real authorized API responses, follows pagination, and uses the shared weekly resolver. It also rejects owner snapshots before academic requests, restricts student/Class Admin snapshots to enrolled classes, prunes saved data/files after access or feature revocation, and refuses to publish a partial snapshot after interruption.

`offline-store.test.ts` and `offline-auth.test.tsx` cover transactional account-scoped storage, file caps/expiry, race-safe clearing and account switches, online denial versus transport failure, and actual AuthProvider reopening. Legacy owner snapshots and their in-app file copies cannot reopen; promoting an identity to Master clears its saved snapshot. The owner console requires a connection.

`pwa.test.ts` runs the actual worker source in a VM harness with controlled network and cache APIs. It checks:

- API, private, authenticated, external-origin, and mutation requests bypass public caching.
- The complete public build, including lazy authentication chunks, is required for offline readiness.
- Offline deep links reopen the public application shell; private academic data comes from the separate account store.
- Navigation responses are not cached as private rendered pages.
- Updates wait for an explicit activation message and only retire this app's old public caches.
- Build stamping identifies actual public chunks and changes the worker version when code changes.
- Manifest icon dimensions match the supplied bytes.

The VM is not a browser's real service-worker lifecycle. Final acceptance must still test HTTPS installation, cold offline reopening, account switches, saved files, storage denial/eviction, and reconnect behavior on actual iPhone/Android browsers.

`static-app.test.ts` serves the actual compiled frontend through Fastify injection without a listening network port. It checks SPA deep links, JavaScript/CSS, branding, web manifest, icon dimensions, public fallback, stamped service worker, and JSON 404 responses for unknown APIs.

## Migration fixtures and data preservation

`fixtures/checkpoint1-schema.sql` and `fixtures/checkpoint2-schema.sql` freeze previously delivered schemas. Tests do not rebuild the historical fixture from today's migration code or import a sibling checkpoint at runtime.

`checkpoint-upgrade.test.ts` and `checkpoint2-upgrade.test.ts` check upgrades through migrations 5/6. Existing accounts, custom profile fields, private object keys, classes, invitations, notices/resources/bookmarks/read state, review actors, timestamps, request history, and audit records survive. CR and GR membership roles map to admin without changing membership IDs. The old uniqueness restrictions disappear, Tutor rows remain legacy-only, and Developer begins blank/unpublished. Prior feature choices persist, and repeating migration preserves later edits/demotions. Foreign-key checks remain clean.

This validates the tested SQL path, including older fixtures. It does not replace backing up an actual database and private storage or validating restoration against a remote Turso/R2 account. Follow the upgrade documentation before reusing a database.

## Live-provider and release boundary

Firebase tests begin with claims returned by the explicitly test-only verifier seam, then exercise real email policy, users, roles, and class access. Production refuses that injected seam. These tests do not validate real Admin credentials, Google signature verification, email delivery/recovery, or a genuinely revoked provider token.

Remote Turso/R2, hosting proxies, slow mobile networks, concurrent-user load, multi-instance quota coordination, browser storage behavior, native Capacitor packaging, Android signing, and store publication need separately configured environments. A passing local suite does not imply a deployed service or a signed APK. See `docs/INSTALL_AND_ANDROID.md`, `docs/GITHUB_AND_DEPLOYMENT.md`, and the five-checkpoint roadmap.
