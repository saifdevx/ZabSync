# ZabSync Checkpoint 4 test inventory

Use Node 24 and the locked project dependencies:

```sh
npm ci
npm run build
npm test
```

The suite runs the actual Fastify API, SQL migrations and React components with isolated fixtures. Tests never load the developer's live database or contact real Firebase, Google Drive, R2, Turso, FCM or OpenAI accounts. External-provider cases use deliberately injected test-only transports. Production rejects those seams. See [VERIFICATION](../docs/VERIFICATION.md) for the final observed results and remaining real-provider/device checks.

## Main coverage

| Area                    | Tests and evidence                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and roles      | Exact verified university domain, separately pinned owner email/UID, malformed/spoofed identities, suspension, owner transfer and loopback-only demo                                                |
| Sections and subjects   | One-section assignment, concurrent first admissions, subject-code expiry/rotation/revocation, owner transfers, legacy-conflict resolution and scoped content visibility                             |
| Student restrictions    | Valid forged shared-content requests, direct URLs and UI controls cannot create sections/subjects or publish/edit academic data                                                                     |
| Academic features       | Subject/resource/notice CRUD, authenticated multipart file downloads, bookmarks, trash/restore, permissions changing during upload and orphan compensation                                          |
| Timetable and deadlines | Full weekly routine, dated extras/cancellations/reschedules, stale-version conflicts, overlap/date handling and personal completion                                                                 |
| Storage                 | PDF/PPT/PPTX/DOC/DOCX/MP4/WebM validation, configured resource limits, base quota reservations, avatar re-encoding and failed finalization cleanup                                                  |
| Drive                   | OAuth state/PKCE/browser binding/expiry, callback limiter, encrypted connection state, scoped upload/download, pinned revisions and old-401/new-connection race                                     |
| Chat                    | Subject audience and admin-selected posting, contextual resource references, pagination/edit/delete/report/mute, retained-row capacities and shared write budgets                                   |
| Reminders               | Opt-in, durable scheduling/inbox/push outbox, restart/leases/retries, changed-deadline/completion/membership cancellation, generic device payload and consent removal                               |
| Help/AI                 | Draft/public source separation, article search, question bounds, meaningless/unmatched no-call behavior, restricted response IDs and atomic global/user budgets                                     |
| Student tools           | Exact source template preservation outside edited members, escaped substitutions, dates/filenames, valid grade boundaries/decimal marks and weighted GPA/CGPA                                       |
| Operations/recovery     | Owner-only usage/health, bounded retry, maintenance/feature flags, private SQL export/inspect/restore/rehearse, empty-target protection and full-schema fidelity                                    |
| Offline/PWA             | Complete authorized snapshots, current subject scope, independent full-section timetable, account cleanup, expiry, no fallback on auth denial, private-cache exclusion and public template precache |
| Upgrades                | Frozen CP1/CP2 schemas, additive migrations 1–12, preserved accounts/records/object references/roles/settings/history, multiple-section conflict handling and repeat migration                      |

## Rendered app journeys

The UI harness uses the real router/auth/forms with real Fastify/SQLite responses through an in-process transport. It rejects unintended external requests and records unexpected HTTP errors. jsdom supplies DOM interaction; native multipart bytes and image validation remain real.

The journeys cover owner section creation, admin subject creation/code copying, student subject admission; subject notices/resources/bookmarks; Developer draft/publication; profile photo replacement; owner transfers and promotions/demotions; weekly editing and student read-only schedules; disabled-feature requests and preserved filters; subject chat, personal reminder opt-in and published Help.

These checks are not physical-device or CSS screenshot evidence. Native browser install prompts, touch/animation behavior, actual Google consent/push, downloaded files in mobile office apps and OS storage eviction still require release acceptance. Word sample layout was separately inspected with the available document renderer; see [STUDENT_TOOLS](../docs/STUDENT_TOOLS.md).

## Focused debugging

Run only the relevant test file while diagnosing a failure. Long real-app UI journeys can contend for CPU/filesystem resources when several agents or test processes run at once. A serial diagnostic command is:

```sh
node --import tsx --test --test-concurrency=1 tests/ui.test.tsx tests/role-boundaries-ui.test.tsx
```

For an individual journey, setting `ZABSYNC_UI_TRACE=1` additionally reports initialization, request timings and periodic route/pending-request diagnostics. It does not print request bodies or authentication headers. Trace output is off by default.

Compare an element's absence as a boolean, for example `assert.ok(screen.queryByRole('dialog') === null, 'The dialog closes.')`. Passing a live React DOM element directly to a strict equality assertion can make failure formatting traverse its attached React references and block the test while it should be retrying.

Do not weaken authorization assertions to make a fixture pass. New subjects require actual subject enrollment; a prior section membership does not grant every future subject. Preserve this distinction when adding fixtures.

Build before a final full run so static-app checks validate the delivered assets. An npm audit reports known dependency advisories at that moment; it does not prove application security or configured-provider safety.
