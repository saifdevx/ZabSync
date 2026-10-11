# Checkpoint 2 verification record

Date: **10 October 2026**. This record covers the cumulative **XVIA — Node Compass Task, version 0.2.0** delivery, including the previous checkpoint. It reports observed local checks and clearly identifies the remaining provider/device work.

## Results

| Check                                                    | Observed result                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client and server TypeScript                             | Passed as part of `npm run build`                                                                                                                           |
| Production frontend and compiled Node server             | Passed; actual compiled files included in the ZIP                                                                                                           |
| Service-worker deployment marker                         | Build stamped `72df133b74465e28`; no unresolved source marker in the served worker                                                                          |
| Combined automated suite                                 | **60 passed, 0 failed, 0 skipped, 0 cancelled**                                                                                                             |
| Actual compiled HTTP delivery                            | SPA deep links, JavaScript/CSS, supplied logos, favicon, manifest/icons, public fallback and stamped worker passed through Fastify request injection        |
| Local demo setup                                         | `npm run setup:demo` created a fresh private local configuration without cloud accounts                                                                     |
| Migration command                                        | `npm run db:migrate` succeeded without creating fictional identities                                                                                        |
| Previous-checkpoint upgrade                              | Frozen Checkpoint 1 schema upgraded with accounts/classes/permissions/invites/history preserved; repeat migration and new settings passed                   |
| npm dependency audit, including development dependencies | **0 known vulnerabilities** reported at the time of validation                                                                                              |
| Responsive/accessibility source review                   | Mobile navigation, layout breakpoints, overflow controls, form labels, dialog scrolling, keyboard-focus styles and reduced-motion rules reviewed            |
| ZIP delivery validation                                  | Archive integrity, required source/build/test/docs entries, original icon bytes and exclusion of credentials/databases/dependencies checked before delivery |

The npm audit reflects known advisories at validation time. It is not a guarantee that the source, deployment, providers or future package updates have no defects. Recheck before a hosted release.

## What the tests actually exercise

### Accounts, classes and authorization

The suite verifies exact verified-email eligibility, domain-lookalike rejection, immutable account identity, explicit owner bootstrap, and separate class approval/membership checks. Because staff share the university domain, mailbox eligibility is deliberately not treated as proof of student membership.

Student, CR/GR and owner boundaries are enforced through actual APIs and SQL. Cases cover another class's content, minimal student rosters, member removal, immediate representative handover, last-CR protection, invitation rotation/expiry, duplicate concurrent requests and suspended accounts. The demo rejects remote peers, hostile host/origin headers and production configuration; it cannot become a public authentication fallback.

### Academic content and private files

Cases cover subject creation/edit/trash/restore; subject, whole-class and owner-only global notices; attachments; search; saved items; and account-specific notification read state. Deleted parents and removed memberships consistently remove visibility from feeds, bookmarks, notifications and downloads. Notice edits make the updated notice unread again.

Storage tests exercise private local bytes and actual multipart requests, the 25 MiB file limit, malformed document rejection, class quotas including trash, role changes during upload, upload compensation, and retryable permanent deletion. PPTX metadata checks reject dangerous archive structures. These checks are format validation, not antivirus certification. The R2 adapter/configuration and injected failure behavior are covered without claiming live R2 connectivity.

### Profiles, Tutor and owner controls

Profile tests verify unique normalized usernames while the account ID, email and permissions stay stable. Photos go through the actual image decoder, size/pixel limits, metadata-stripping re-encoding, private access, replacement/removal and cleanup retries. A partially written failed photo upload does not replace the existing profile.

Tutor drafts remain owner-only until published; link validation, stale-save conflicts and feature switches are checked. Read-only maintenance pauses non-owner writes while preserving reads and owner recovery. Disabling a feature affects its APIs as well as its visible interface.

Rate-limit tests verify that classmates sharing an IP have independent authenticated quotas, rotating tokens does not reset a user's quota, and forged identity/forwarding headers do not bypass limits. Verification is shared only within the current request. These tests are not a sustained load test or validation of a particular host's proxy configuration.

### Rendered interface integration

Two workflows render the actual React application and use the actual Fastify API, database and private storage. The only network substitution is an in-process transport; API/auth responses are not static mocks. Native Request serialization carries real JSON and multipart data into the API.

The original workflow creates and approves a class, promotes the requester, edits class details and copies the issued invitation. The new workflow creates a subject and class notice, confirms a student's read-only view, saves the notice, publishes a Tutor draft, and changes a student's name/username/photo. Repeated Master-to-Student switches produce no unauthorized/stale-admin API calls after the identity-state fix.

These are **jsdom** tests. Small platform adapters support dialogs, clipboard and object URLs. They do not measure CSS layout, native focus, touch behavior, animation performance or a physical browser's download handling.

### Web installation and privacy

The worker harness executes the actual source with controlled cache/network APIs. It verifies that only the public reconnect page and logo are cached; account APIs, lecture downloads, photos, authentication and external requests are bypassed; online navigation is not cached; and a worker update waits for an explicit confirmation. Cleanup is restricted to this app's old public caches.

The compiled HTTP test checks the real manifest, truthful icon dimensions, favicon/Apple references, public fallback, stamped worker and current route shapes. The original supplied 447 × 447 PNG is preserved byte-for-byte; the SVG container embeds it unchanged. These checks do not establish that a particular device will accept or render an install icon correctly.

## Not verified or not included yet

- **Live Firebase:** real university inbox registration/verification/reset delivery, actual provider credentials, signed-token verification/revocation and account recovery.
- **Live remote SQL/R2:** the owner's compatible libSQL/Turso endpoint, bucket credentials, network behavior, durable hosted storage, real-provider failures and coordinated restore.
- **Browser/phone experience:** rendered desktop/mobile review, Safari/Chrome home-screen installation, actual icon selection, native file downloads, screen-reader interaction and real update lifecycle. No browser screenshots or installed-device result is claimed.
- **Network listener/hosted pilot:** no preview/public server was opened here. Compilation and HTTP injection passed; the owner still needs to run the supplied commands locally and complete hosted checks before inviting students.
- **Private offline academic content:** timetable, deadlines, account-scoped cached notices and saved in-app files are required Checkpoint 3 work. CP2 includes a public reconnect page and ordinary browser file downloads, not the private offline app.
- **Load/recovery/native release:** sustained concurrency, shared counters for multiple servers, host proxy tuning, crash-orphan reconciliation, backup restoration, Android project/signing, APK/AAB and Play submission are later configured release work.

No real credentials, live database, uploaded user files or node_modules are included. Complete the configuration guide and a small real-device pilot before university use.

## Repeat the supported checks

From the extracted project folder, after installing Node 24:

```sh
npm ci
npm run setup:demo
npm run build
npm test
npm audit
```

For an existing configuration, keep it and follow the upgrade guide instead of switching authentication modes. The included built assets let the static-delivery test run immediately; building first ensures it checks your latest source. See [the test inventory](../tests/README.md), [beginner guide](START_HERE.md), [upgrade guide](UPGRADE_FROM_CHECKPOINT_1.md), and [configuration checklist](CONFIGURATION_CHECKLIST.md).
