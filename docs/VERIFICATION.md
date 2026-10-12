# Checkpoint 3 verification record

Date: **11 October 2026**. Application: **ZabSync, version 0.3.1**. Tagline: **Built for Students. Designed for Success**.

This record covers the corrected, cumulative Checkpoint 3 v0.3.1 source delivery; it does not advance the project to Checkpoint 4. It distinguishes automated local verification from live-provider, rendered-browser and physical-device checks still required before a student pilot.

## Final results

| Check                              | Observed result                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                            | Node.js **24.19.0**; project supports Node 24                                                                                                     |
| Client and server TypeScript       | Passed through `npm run build`                                                                                                                    |
| Production client and compiled API | Passed; compiled files included in the ZIP                                                                                                        |
| Public offline build               | Build **`373c50fe3e422cd4`**; 12 public assets, including every emitted JavaScript/CSS chunk; no unresolved worker markers                        |
| Full cumulative suite              | **104 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo**; 24.39 seconds in this environment                                                       |
| Rendered React regressions         | Six actual app/API journeys passed; strict transport checks reported no unexpected HTTP errors                                                    |
| Offline checks                     | Account-scoped store/snapshot/AuthProvider/worker checks and authorized server manifests are included in the 104 total                            |
| Fresh beginner demo setup          | `npm run setup:demo` succeeded with a new local configuration                                                                                     |
| Migration command                  | `npm run db:migrate` succeeded; six schema versions recorded and zero user accounts created by migration                                          |
| Previous-version preservation      | Frozen CP1 and CP2 databases upgraded successfully; repeat migration and foreign-key checks passed                                                |
| Dependency audit                   | `npm audit --json` reported **0 known vulnerabilities**, including development dependencies                                                       |
| Supplied favicon                   | Original 447 × 447 PNG preserved byte-for-byte; wrapper and manifest dimensions checked                                                           |
| Delivery archive                   | Integrity, required source/build/test/documentation entries, icon bytes, and exclusion of configuration/data/dependencies checked before delivery |

The npm audit describes known package advisories at validation time. It does not establish that application logic, providers, deployment configuration or future dependency updates are defect-free. The only npm warning in the final test log concerns the execution environment's `http-proxy` option; there are no React `act` warnings or failed test cases.

## Identity, roles and the owner directory

The suite uses the actual Fastify routes and SQL authorization. It checks verified exact-domain email eligibility, lookalike rejection, immutable account identity, explicit owner bootstrap and denial of forged identity headers. Since university staff share the email domain, an eligible verified mailbox is not treated as proof of approved class membership.

The revised model is covered end to end:

- Ordinary students cannot create classes or call the retired creation-approval endpoints.
- A current Class Admin or Master Admin creates a class directly. An archived membership cannot authorize creation.
- Class Admin permissions remain scoped to their class. A class membership does not confer global ownership.
- Only the owner appoints or demotes admins. Multiple admins are allowed; changes affect an existing session immediately.
- The owner browses semester counts, sections and complete paginated rosters, then enrolls an existing active account and changes its class role.
- Owner/admin records expose authorized roll numbers, names and full stable IDs. Ordinary students receive a minimal roster without peer email addresses, invitations or pending-request data.
- Invitations, joining approval, suspension, archived classes and cross-class reads retain their authorization boundaries.

For the dedicated owner account, the tests require the exact verified external email and pinned Firebase UID; public configuration discloses neither value. Ordinary external identities remain rejected. Updating private owner settings does not silently replace an existing owner. The explicit transfer preview makes no data changes, and apply rechecks the current owner within one audited transaction. Tests preserve existing memberships/history and verify rollback if the audit write fails. No real Firebase account or ownership transfer was performed.

New owner-created classes have zero members and no owner enrollment. Owner self-joining, direct enrollment, class-role appointment and approval of an old pending join request are rejected. Historical memberships are preserved. Normal class-list endpoints stay enrolled-only; global inventory remains in the owner directory.

A direct-request regression attempts **32 valid student mutations** across classes, invitations, subjects, actual multipart lecture uploads, class/subject/global announcements, timetable routines, dated changes and shared deadlines. All are denied, without changes to content, versions, audit entries or file storage. Personal deadline completion remains permitted and isolated.

The local demo rejects public listeners, remote peers, hostile Host/origin headers and production configuration. Firebase-boundary tests use an explicit test-only verifier seam and then run the real account and membership logic. Production refuses that seam. This is not live Firebase signature, mail-delivery or token-revocation verification.

## Academic content, planning and operations

Existing academic checks cover subjects, private document bytes, actual multipart uploads, three announcement audiences, attachments, bookmarks, search, personal read state, trash/restore and retryable permanent deletion. Lost membership or deleted parents remove content from feeds and downloads. File quotas include trashed objects. Upload tests cover format rejection, the 25 MiB boundary, permission changes during upload and cleanup after failed storage writes. Format checking is not antivirus certification.

Timetable tests exercise weekly CRUD, teacher/day/time fields, class/subject scope, impossible dates and times, separate extra/cancelled/rescheduled sessions, cross-week changes and overlap indicators. The shared resolver uses Asia/Karachi and produces equivalent online/offline weeks. Version checks prevent stale edits from silently overwriting newer changes. Deadlines have versioned personal completion: one student's checklist does not change another student's state, and a changed deadline requires acknowledgment of its new version.

Operations checks cover display names and unique handles without changing account identity; decoded, re-encoded private photos and cleanup; suspension/restoration; read-only maintenance with owner recovery; feature flags; and audit records. Developer content starts private, rejects unsafe links and stale saves, and becomes student-visible only after publication. Students open the separate Meet the Developer page from the sidebar or Get the App; its unpublished/disabled states do not expose private drafts. The owner uses the dedicated Developer tab.

Authenticated rate-limit checks distinguish classmates behind a shared IP, retain a user's quota across token rotation and reject forged forwarding/identity headers. This is not a sustained concurrency benchmark or validation of a particular hosting proxy.

## Actual React/API interaction tests

The six UI journey files render the real React application, router, authentication provider and forms in jsdom. Requests use the actual Fastify application, SQLite database, native multipart serialization and private file storage. API responses are not replaced with fixed mock data. The transport rejects external calls and records unexpected HTTP errors.

The journeys cover direct admin class creation and invitation copying; subjects/notices and student read-only views; bookmarks; Developer draft/preview/publication; real profile photo upload/removal; the owner's semester-to-roster workflow; enrollment and promotion/demotion; weekly editing; a moved occurrence's destination link; explicit clearing of rescheduled teacher/room fields; and personal deadline completion.

The feature-controls regression verifies feature controls during both initial loading and a deliberately delayed real settings response. Disabled subject, resource, timetable and photo APIs are never requested. Existing noticeboard input nodes, search text and audience selection survive a settings refresh. Header and roster avatars respect a disabled photo feature even when a stored avatar version exists.

The correction adds the sibling-class permission and owner-navigation journey: a Class Admin remains read-only in another enrolled section, the owner has no student/Offline navigation, legacy student destinations redirect to the console, and section tools publish into the selected class. Missing and unknown frontend roles fail closed. The new weekly journey renders all seven day regions, including empty days, exercises per-day creation and a cross-week move/removal, verifies owner section planning without personal checklist controls, and navigates a saved week with network transport blocked and no API calls.

These checks establish interactions and integration. jsdom does not render CSS like a phone, measure animation performance, perform native focus/touch behavior or prove that a device accepts a home-screen icon. No rendered-browser screenshot or physical-phone acceptance result is claimed.

## Offline storage and reopening

The offline suite includes actual API snapshot preparation, a transactional IndexedDB implementation under `fake-indexeddb`, the real AuthProvider, mounted data hooks and a worker VM harness. Quota denial is deliberately injected because the IndexedDB test implementation does not impose a physical disk quota.

Covered behavior includes:

- Explicit preparation from a verified online identity, complete pagination and refusal to publish a partial snapshot.
- Seven-day expiry, account isolation, the metadata/file caps and explicitly saved file bytes.
- Read-only reopening without manufacturing a new authentication credential.
- Student and Class Admin snapshots restricted to enrolled classes, with no offline roster, invitation, token or private profile-photo storage. Master preparation is rejected before academic fetching; legacy owner snapshots and their in-app files are cleared, and role elevation clears saved student state.
- HTTP 401/403 denial that never grants a cached fallback; only a transport failure may reopen eligible saved data.
- Removal of lost classes, disabled features, deleted subjects/notices, changed resources and exceptions whose weekly parent is no longer available.
- Snapshot revision checks, delayed expiry cleanup, cancellation while preparation is pending and a delayed old-account denial that cannot revoke a new account.
- Cross-tab changes refreshing already-mounted saved views, without falsely advancing the last-complete-sync time.
- Controlled behavior when browser storage is denied, without breaking normal online login.

The actual worker source is checked for public-only caching, complete build readiness, offline deep-link reopening and explicit update activation. API, private, authenticated, external and mutation requests bypass it. A build-script process verifies that all emitted public chunks, including lazy Firebase imports, enter the deterministic allowlist and that code changes update the cache version.

The compiled HTTP check serves the real built files through Fastify injection: deep links, JavaScript/CSS, logos, manifest, favicon, offline help and stamped worker all resolve. Unknown API routes remain JSON 404 responses. No listening preview server is needed for these checks.

Browser storage and service-worker lifecycle still require actual-device verification. A disconnected device cannot learn about a new suspension until reconnection or saved-access expiry, and a separately downloaded file cannot be recalled. See [OFFLINE](OFFLINE.md) for exact controls, limits and the device procedure.

## Upgrade preservation

The frozen schemas in `tests/fixtures/` represent the previously delivered checkpoints; the tests do not reconstruct old databases from current migrations. They verify accounts, profile fields, classes, private storage keys, content, saved/read state, invitations, actors, timestamps, request history and audit records across migrations 5 and 6.

Prior `cr` and `gr` memberships become `admin` without changing membership IDs. The old single-representative restrictions disappear. The old Tutor rows remain private legacy data while the new Developer profile starts blank and unpublished. Existing feature choices survive. A repeat migration preserves subsequent role changes and edits.

Tests do not replace a consistent backup of the actual database and its corresponding file store. For the correction use [UPGRADE_FROM_CHECKPOINT_3](UPGRADE_FROM_CHECKPOINT_3.md). [UPGRADE_FROM_CHECKPOINT_2](UPGRADE_FROM_CHECKPOINT_2.md) also covers upgrading CP1 directly to the cumulative CP3 package. Schema versions remain 1–6; the correction preserves existing CP3 memberships, Developer drafts/publication and timetable data.

## Remaining configured release checks

| Area                      | Still required                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live authentication       | Real university mailbox verification/reset, Firebase credentials and revocation, owner recovery                                                       |
| Remote persistence        | Configured Turso/libSQL and R2 connectivity, real-provider failure handling, durable hosted storage and coordinated restore                           |
| Phone/browser acceptance  | Rendered mobile review, iPhone/Android home-screen install, cold offline reopen, actual downloads, storage eviction, touch/focus and update lifecycle |
| Hosted pilot and capacity | Actual deployment, proxy/rate-limit settings, concurrent-user load, multiple-server coordination and recovery                                         |
| Later features            | Scheduled/push reminders, supplied front-page PDF, bounded university chatbot and associated usage limits                                             |
| Android release           | Native project, package identifier, signing, APK/AAB, direct distribution and Play submission                                                         |

No live credentials, database, uploaded student files or `node_modules` are delivered. No GitHub push, public deployment, signed APK or live-provider success is claimed.

## Repeat verification

For a fresh local practice installation with Node 24:

```sh
npm ci
npm run setup:demo
npm run db:migrate
npm run build
npm test
npm audit
```

Keep an existing real-account configuration and follow the upgrade guide instead of selecting demo authentication. Build before testing so compiled-asset verification checks the current source. See [test inventory](../tests/README.md), [START_HERE](START_HERE.md), [configuration checklist](CONFIGURATION_CHECKLIST.md), and [deployment guide](GITHUB_AND_DEPLOYMENT.md).
