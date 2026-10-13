# Checkpoint 4 verification record

**ZabSync 0.4.0 — verified locally on 12 October 2026.** This record supersedes the Checkpoint 3 report. It distinguishes automated local checks from the live-account, rendered-browser, physical-device and capacity checks still required before a student release.

## Final results

| Check                                  | Result                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client and server TypeScript           | Passed through `npm run build`                                                                                                                        |
| Production client and server build     | Passed; web build `6f1bc5362741da58`; 14 approved public offline assets                                                                               |
| Cumulative isolated automated coverage | **42/42 current test files completed; 161 tests passed, 0 failed, 0 skipped, 0 cancelled, 0 todo**; 1467.84 seconds summed across their TAP durations |
| Dependency audit                       | `npm audit --json`: **0 known reported vulnerabilities**, including development dependencies, at the time of the check                                |
| Compiled HTTP smoke                    | **6 passed** against an actual loopback listener: home, public configuration, front-page route, CGPA route, Word template and service worker          |
| Database upgrade and recovery          | Migrations 1–12, earlier-checkpoint preservation, conflicts and SQL export/restore rehearsal covered by the suite                                     |
| Word output                            | Template package fidelity and field validation tests passed; normal and long-input documents rendered to one page and visually inspected              |
| Package portability                    | All 519 resolved dependency URLs use the public npm registry; no private mirror, credential-bearing or workspace package URLs                         |

**Cumulative coverage was validated in isolated per-file runs.** Each current test file has its own complete TAP plan and summary, a successful process exit, no timeout, and zero failures, cancellations, skips or todo tests. Each file and log is credited once. The groups used separate runners; the summed durations are not one end-to-end wall-clock duration or a production performance/capacity benchmark.

**The combined suite attempt was inconclusive.** It exited with status 1 and its recorded TAP output ended before a final summary. That attempt is not counted as a passing run. This record does not claim that one invocation of `npm test` completed successfully; its automated results come from the complete isolated records listed below.

The isolated runs exposed an outdated static-app expectation for the previous checkpoint's cache version. That test now checks the intended version 4 cache name while retaining the build-stamp and asset/API checks. The weekly timetable journey also received the same 180-second overall allowance used by the other long UI journeys; its 15-second individual condition waits and all assertions remain unchanged. Its final isolated run completed the test body in 34.79 seconds, with no transport errors and no network calls during offline week navigation. Both earlier unsuccessful records were preserved separately and are not counted as passes.

The HTTP check validates status codes, content types, nonempty responses, the template's SHA-256 and the current service-worker build stamp. It uses a temporary in-memory database, opens and closes its own local server, and does not contact the owner's cloud accounts.

## Complete automated test file inventory

The report is generated only after all 42 current `tests/*.test.ts` and `tests/*.test.tsx` files are accounted for. Counts and durations below are parsed from the individual TAP logs and checked against their runner records. All rows have exit status 0 and zero failed, cancelled, skipped or todo tests.

| Test file                                                                                 | Tests passed | TAP duration (seconds) |
| ----------------------------------------------------------------------------------------- | -----------: | ---------------------: |
| [tests/academic-storage.test.ts](../tests/academic-storage.test.ts)                       |            4 |                  37.67 |
| [tests/academic.test.ts](../tests/academic.test.ts)                                       |           11 |                  37.33 |
| [tests/access-control.test.ts](../tests/access-control.test.ts)                           |            4 |                  27.24 |
| [tests/backup.test.ts](../tests/backup.test.ts)                                           |            8 |                  89.54 |
| [tests/chat-help-ui.test.tsx](../tests/chat-help-ui.test.tsx)                             |            1 |                  86.17 |
| [tests/chat.test.ts](../tests/chat.test.ts)                                               |            6 |                  56.86 |
| [tests/checkpoint-upgrade.test.ts](../tests/checkpoint-upgrade.test.ts)                   |            1 |                  69.05 |
| [tests/checkpoint2-ui.test.tsx](../tests/checkpoint2-ui.test.tsx)                         |            1 |                 175.76 |
| [tests/checkpoint2-upgrade.test.ts](../tests/checkpoint2-upgrade.test.ts)                 |            1 |                  53.18 |
| [tests/checkpoint3-ui.test.tsx](../tests/checkpoint3-ui.test.tsx)                         |            1 |                 103.69 |
| [tests/class-workflow.test.ts](../tests/class-workflow.test.ts)                           |            3 |                  18.72 |
| [tests/concurrent-writes.test.ts](../tests/concurrent-writes.test.ts)                     |            1 |                  34.52 |
| [tests/demo-boundaries.test.ts](../tests/demo-boundaries.test.ts)                         |            4 |                  23.92 |
| [tests/drive.test.ts](../tests/drive.test.ts)                                             |           13 |                  13.41 |
| [tests/feature-controls-ui.test.tsx](../tests/feature-controls-ui.test.tsx)               |            1 |                  20.89 |
| [tests/firebase-boundary.test.ts](../tests/firebase-boundary.test.ts)                     |            3 |                  11.31 |
| [tests/frontend-permissions.test.ts](../tests/frontend-permissions.test.ts)               |            1 |                  17.01 |
| [tests/help-assistant.test.ts](../tests/help-assistant.test.ts)                           |            4 |                  10.35 |
| [tests/help.test.ts](../tests/help.test.ts)                                               |            5 |                  19.41 |
| [tests/identity-policy.test.ts](../tests/identity-policy.test.ts)                         |            9 |                  17.58 |
| [tests/invites.test.ts](../tests/invites.test.ts)                                         |            2 |                  15.04 |
| [tests/offline-auth.test.tsx](../tests/offline-auth.test.tsx)                             |            1 |                  13.15 |
| [tests/offline-data.test.ts](../tests/offline-data.test.ts)                               |            5 |                  37.99 |
| [tests/offline-manifest.test.ts](../tests/offline-manifest.test.ts)                       |            2 |                   7.16 |
| [tests/offline-store.test.ts](../tests/offline-store.test.ts)                             |            8 |                  34.24 |
| [tests/operations-health.test.ts](../tests/operations-health.test.ts)                     |            2 |                  25.51 |
| [tests/operations.test.ts](../tests/operations.test.ts)                                   |            8 |                  14.24 |
| [tests/owner-account.test.ts](../tests/owner-account.test.ts)                             |            3 |                  37.31 |
| [tests/owner-hierarchy.test.ts](../tests/owner-hierarchy.test.ts)                         |            1 |                   5.73 |
| [tests/pwa.test.ts](../tests/pwa.test.ts)                                                 |            7 |                   7.11 |
| [tests/rate-limits.test.ts](../tests/rate-limits.test.ts)                                 |            3 |                   3.96 |
| [tests/reminders.test.ts](../tests/reminders.test.ts)                                     |            8 |                  10.78 |
| [tests/representatives.test.ts](../tests/representatives.test.ts)                         |            4 |                  12.44 |
| [tests/resource-formats.test.ts](../tests/resource-formats.test.ts)                       |            2 |                   2.54 |
| [tests/role-boundaries-ui.test.tsx](../tests/role-boundaries-ui.test.tsx)                 |            1 |                  52.76 |
| [tests/section-upgrade.test.ts](../tests/section-upgrade.test.ts)                         |            1 |                   9.94 |
| [tests/static-app.test.ts](../tests/static-app.test.ts)                                   |            1 |                  19.86 |
| [tests/student-content-permissions.test.ts](../tests/student-content-permissions.test.ts) |            1 |                  14.97 |
| [tests/student-tools.test.ts](../tests/student-tools.test.ts)                             |            5 |                   2.33 |
| [tests/timetable.test.ts](../tests/timetable.test.ts)                                     |           12 |                  61.66 |
| [tests/ui.test.tsx](../tests/ui.test.tsx)                                                 |            1 |                  74.15 |
| [tests/weekly-timetable-ui.test.tsx](../tests/weekly-timetable-ui.test.tsx)               |            1 |                  81.36 |
| **Total: 42 unique files**                                                                |      **161** |            **1467.84** |

The completed earlier isolated run for tests/access-control.test.ts was reused and counted once. Its original TAP duration is included; copying the log is not treated as another test run.

## Identity and permission checks

The suite checks verified university-domain admission, the separately pinned owner email/UID, rejection of unauthorized or suspended accounts, production rejection of local demo authentication, and current server permissions instead of browser-selected roles. Real Firebase verification is substituted only through an explicitly injected test seam that cannot be enabled by an HTTP request or used in production.

Section tests exercise first-subject admission and approval, one current section per student, same-section subject codes, rejection of cross-section access, owner-only section creation and transfer, Class Admin subject creation, role changes and legacy membership conflicts. The old class-code path is retired. Owner-directory counts and access boundaries are tested after reducing overview data queries from fourteen to five round trips.

Academic tests cover subject resources, notices, deadlines and the full section timetable; archive/trash/restore and quotas; cross-subject references; permission changes during uploads; and feature/maintenance controls across read, write and offline surfaces. Student controls do not confer administrative permission.

## Storage and Google Drive

Local provider tests cover allowed file types and sizes, authenticated downloads, reservation/usage accounting, rejected-upload cleanup and tracked orphan cleanup. Drive tests exercise one-use OAuth state, browser binding, PKCE, encrypted refresh grants, callback validation, reconnection races, original-uploader/revision tracking, revocation and provider failures. They use controlled provider responses, not a real personal Google account.

R2 remains private binary storage and an explicitly selected resource alternative. A Drive error does not silently redirect an academic upload to R2. SQL stores chat messages and structured application records. The unit tests do not prove cloud-account configuration, external sharing behavior, provider quotas or network availability.

## Chat, reminders and Help

Chat tests check member versus admin-only posting within private subjects, same-subject resource references, edits/deletes, reports, timed mutes, page cursors, persistent write limits and stale-page attempts during maintenance.

Reminder tests check personal opt-in, durable jobs and outbox/inbox records, lease/retry behavior, deduplication, changed deadlines and permissions, completed reminders and safe push payload contracts. No live FCM notification was sent.

Help tests separate draft from published content. Optional AI tests check local source matching, meaningless/unmatched question rejection before any paid call, atomic daily reservations, bounded input/output, private request contents and rechecking that selected articles are still published. AI is disabled by default; no paid OpenAI request was made during verification.

## React interaction and offline checks

The React journeys exercise actual application components with a DOM environment and the real Fastify/SQL application through an in-process transport. They cover subject creation/joining, student and owner navigation, representative assignment and transfers, profile/avatar editing, Developer draft/publication, full-week timetable behavior, subject chat/reminders, Help and feature controls. Critical changes wait for fresh persisted API results as well as rendered content. These are interaction checks, not CSS screenshot tests.

Offline tests cover account-scoped IndexedDB, authorized manifests/snapshots, expiration and account changes, stale-schema rejection, saved files, the public-only service-worker cache, OAuth/API exclusions, update activation and push routing. The compiled worker prepares 14 public assets, including the Word template. Private academic responses and Drive/OAuth credentials are not placed in its public cache.

A temporary Chromium runtime could report its version but terminated before loading a page in this environment. Therefore **no successful rendered-browser screenshot, real iPhone/Android installation or physical-device offline result is claimed**. Those remain Checkpoint 5 acceptance checks.

## Word template and calculator

The supplied source template, application template and compiled template have identical SHA-256:

`155dd7ff3231a468c9cda5ef27292a5d2db11801fd3f2975c2ffb5d470f76ca2`

Generated documents change the intended field text/footer and clear original author metadata while retaining the remaining template parts, images and layout. The original floating header graphic can overlap the university heading in LibreOffice. Its source placement was preserved to meet the requested template fidelity; review the sample in Microsoft Word before approving the final output.

The calculator tests exercise credit weighting, previous-credit/CGPA combination, invalid/blank input, zero marks and decimal grade boundaries. Its grade bands come from the supplied project. Official university grade policy and transcript-specific repeat-course rules have not been independently certified.

## Build and release limits

The build has nonblocking warnings: the main JavaScript chunk is about 579 kB minified (167 kB gzip), and the push helper's dynamic import cannot create a separate chunk because another component imports it statically. These warnings remain visible. Measure real device startup and interaction before deciding further bundle changes.

Checkpoint 5 still needs the owner's configured Firebase, Drive OAuth consent, Turso/libSQL and R2 accounts; real upload/download/disconnect/handover exercises; restored SQL with matching resource objects; optional live push; representative concurrent workload tests; accessibility/mobile review; hosting configuration; and signed Android distribution. No GitHub push, public deployment, APK/AAB, App Store release or 1,000-user capacity result is included in this verification claim.

## Repeat verification

From the extracted project folder, with Node.js 24 installed, in a Bash-compatible terminal:

```sh
npm ci
npm run build
for test_file in tests/*.test.ts tests/*.test.tsx; do
  node --import tsx --test --test-timeout=180000 --test-reporter=tap "$test_file" || exit 1
done
npm audit
```

The loop repeats the isolated per-file approach, stops at the first unsuccessful process, and runs files serially. `npm test` remains the normal combined entry point, but a complete successful combined invocation was not established in this environment. Review each file's final TAP summary; a truncated log or a timeout is not a pass. Tests use isolated local databases and controlled providers. `npm run setup:demo` is for local exploration; never convert fictional demo identities into a real-account deployment. See [the beginner guide](CHECKPOINT_4_GUIDE.md), [upgrade instructions](UPGRADE_FROM_CHECKPOINT_3.md) and [test inventory](../tests/README.md).
