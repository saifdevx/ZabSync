# ZabSync project context and handoff

**Current checkpoint:** 4 of 5 · **source version:** 0.4.0 · **schema:** 1–12 · **updated:** 12 October 2026.

Give this file and the complete `zabsync-checkpoint-4.zip` to a new chat/developer. Ask them to inspect the code and this context before editing. A context file is not a substitute for the source, database or private configuration. Do not start the project again from an unrelated template.

## 1. Project and working agreement

ZabSync is a mobile-friendly university web app for SZABIST Islamabad. Tagline: **Built for Students. Designed for Success**. It replaces cluttered WhatsApp lecture/announcement sharing with a structured student application. It must run locally, later on a Node host such as Render, install as a PWA on iPhone/Android, and later be packaged for Android APK/AAB distribution. The owner is a beginner and expects cumulative source ZIPs, clear commands, a maintained context file and exactly five development checkpoints.

Brand colors include navy `#192E59`, blue `#0B4CA1`, white and green `#3EC44F`. Use the existing responsive ZabSync design and supplied favicon/university artwork. Prefer restrained motion and accessible layouts; do not copy NayaPay branding. Earlier names Node Compass Task/XVIA are obsolete. The Tutor concept was replaced by **Meet the Developer** with owner-managed portfolio, introduction, other apps and updates.

The university site supplied by the user is `https://szabist-isb.edu.pk/`. The current app also includes the official ZABDESK redirect. University email eligibility is exactly **`szabist-isb.pk`**; roll-number examples are `2412339@szabist-isb.pk`. Staff share this domain, so a verified mailbox is not proof of enrollment. The academic timezone is **Asia/Karachi**.

## 2. Authoritative account and permission model

These requirements supersede earlier conversation/docs about multiple classes, GR/CR labels or student class creation.

- Real users see sign-in/registration, never Student/Admin/Master role selection. Fictional role buttons exist only in a loopback-only demo that refuses production operation.
- Firebase verifies the signed-in identity. The API rechecks the verified email and allowed domain. Firebase Google sign-in is optional; email/password remains available because a university mailbox may not be a Google account. App passwords are separate from university-mail passwords.
- Global roles are Student and Master Admin; **Class Admin is section membership permission**, not a user-selectable global role. There are no GR/CR UI roles.
- The Master Admin may use a separate verified Gmail account. It requires the exact private configured email **and Firebase UID**. Other external accounts are denied. Use a separate university account for the owner's daily student/Class Admin activity. Ownership bootstrap/transfer is explicit and audited; changing environment values does not replace an existing owner.
- The owner has a separate console: semesters → sections → people/content. The owner does not get student Home/My Class/My Subjects/timetable navigation and is not automatically enrolled in created sections.
- Only the owner creates sections, resolves old enrollment conflicts, transfers students and appoints/removes Class Admins. Several admins can manage one section.
- A Class Admin manages subjects, subject invitations, admissions, shared resources, announcements, deadlines, chat settings/moderation and weekly/dated timetable changes within their assigned section. They cannot assign other admins or grant global powers.
- An ordinary student has one pinned active section and multiple enrolled subjects inside it. They cannot create sections/subjects, upload shared course resources, publish announcements/deadlines or edit a timetable. Their own profile, bookmarks, reminder preferences, completion checklist, local tools and permitted chat are personal actions.

## 3. My Class and My Subjects

**My Class** shows the student's section and whole-section information. **My Subjects** shows enrolled subjects inside it. A subject opens Resources, Announcements, Deadlines and Chat. API authorization protects each subject as well as its parent section; hiding controls is not the security boundary.

Subject join codes are secret, revocable/expiring invitations. A student without a section submits a first subject-code request for approval. Approval establishes the section and subject. After that, further codes must target subjects in the same section. A 5D student cannot use a 2D code to join it. Moving sections requires the owner's explicit transfer workflow. Legacy class-code joining returns a retired-endpoint response.

Migration preserves previous memberships and academic history. A sole unambiguous prior membership can initialize the section/subject records. Multiple previous memberships are marked for owner resolution; the migration does not guess the correct section or erase old records. Section transfers update current access and require explicit enrollment in destination subjects. Old offline snapshots are invalidated and must be prepared again.

Whole-section announcements reach that section without opening a subject. Only Master Admin can publish application-wide notices. A student's section weekly timetable includes the complete routine, including a subject they have not separately enrolled in, without granting access to that subject's files/chat. The timetable repeats Monday–Sunday and supports dated extras, cancellations and reschedules. Students read it; admins edit it.

## 4. Storage and Google identity

The agreed storage architecture is hybrid:

| Data                                                                                                             | Provider                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Identity                                                                                                         | Firebase Authentication                                              |
| Profiles, membership, timetable, notices, chat text, reminders, settings, file metadata, usage and audit records | Local SQLite for practice; compatible Turso/libSQL for hosting       |
| Profile-image bytes, small binary objects, explicitly selected resource fallback                                 | Private local directory in demo; Cloudflare R2 in hosting            |
| Shared notes/PDF/PPT/PPTX/DOC/DOCX/MP4/WebM resources                                                            | Uploading Class Admin's connected Google Drive when configured       |
| Selected offline copies and academic snapshot                                                                    | Account-scoped browser IndexedDB, separate from the public app shell |

**Google application sign-in does not automatically grant Drive access.** The user wanted automatic connection; explain that the required separate one-time Google consent cannot be bypassed. My profile includes Connect Drive; the consent may use a personal Gmail account while the application identity remains the verified university account. Readers do not need Drive permission. Connecting Drive never adds publishing or admin privileges.

The Drive OAuth scope is `drive.file` plus identity/email, with PKCE, one-use SQL state, browser-binding cookie, fixed Google endpoints and encrypted refresh tokens. ZabSync creates files without public sharing and serves authorized downloads through its API with original uploader/revision tracking. The Google account owner can later share files outside the app, which ZabSync cannot prevent or revoke. Do not change to public links to avoid backend permissions. A delayed failure from an old token cannot invalidate a newer reconnection.

Files consume the original uploader's Drive allowance, not each student's allowance. Revoked consent, deleted originals, an unavailable Google account or exhausted storage can break access. Replacing the class admin does not transfer Drive ownership. Plan retention and re-upload/handover before someone leaves. External OAuth Testing mode may expire refresh grants after seven days; real launch needs the appropriate consent-screen publication/configuration.

`RESOURCE_STORAGE=drive` uses Drive for new resources; `base` deliberately uses the configured local/R2 store. Empty selects Drive when fully configured, otherwise base. A failed Drive upload never silently falls back. Existing storage keys retain their destination. Merely changing providers does not migrate old bytes. Downloads still traverse the Node host, so server bandwidth/temporary-disk usage remains.

Default application ceilings: documents 25 MiB, videos 100 MiB, resources 500 MiB per section (including trash), base-store 8 GiB. Base quota uses durable reservations and tracked private objects. Profile images are size/dimension-limited and re-encoded. Signature/container checks are not antivirus scanning. Additional formats require deliberate validation, not trusting file extensions.

## 5. Subject chat and reminders

Chat's **All subject members** option lets approved members post; **Class admins only** allows students to read. Both audiences remain private to the subject. A message may reference a resource in that same subject. Students can edit/delete their own messages and report messages. Admins remove messages and can temporarily mute students; peers cannot mute admins. There is no separate chat attachment path in CP4.

Limits include 2,000 characters/message, 40 messages/page, 12 mutations/minute and 500/day per user, 10,000 rows/subject and 100,000 total. Deleted text is removed but retained rows still count. Chat polls every 30 seconds only while visible and online. It is not cached for offline reading and is not a WebSocket/direct-message/video-chat system. Review retention and workload limits before a large rollout.

Reminder preferences are personal and opt-in per deadline: at due time or 15/60/1,440 minutes before. Durable SQL jobs and a private inbox survive app restarts. Processing revalidates consent, membership, current deadline version and personal completion. Jobs use leases, bounded retries and stale-deadline cancellation. Optional Firebase device push sends generic notifications, requires device permission/configuration, and is disabled by default. In-app delivery does not require push. Accurate timing requires a running worker/service; a sleeping host is insufficient. Runners are included for hosted scheduling, with ownership of delivery controlled through SQL.

## 6. Front-page Word generator and GPA/CGPA

The user supplied `szabist-student-tools.zip`. Only its template, replacement behavior and grade scale were reused; do not copy the compiled frontend, historical backend configuration or analytics.

`client/public/templates/assignment-cover.docx` preserves the original file. The ZabSync form edits allowed Word XML fields in the browser and downloads a `.docx` locally. It fills assignment/quiz number, subject, teacher, student, roll number, date, semester and section; preserves source artwork, BSCS footer and total-marks 03. Generated author metadata is cleared. The template's existing floating header partly overlaps in LibreOffice; this was preserved for source fidelity and needs user review in Word before release. Normal/long-title samples were rendered to one page. See `docs/STUDENT_TOOLS.md` and `examples/Assignment-1-2412339.docx`.

The GPA scale from the ZIP is A+90→4.0, A85→3.75, A−80→3.5, B+75→3.25, B70→3.0, B−66→2.75, C+63→2.5, C60→2.0, C−55→1.5, F<55→0. The source's decimal gaps were corrected: each threshold continues until the next one. This is not independently verified official university policy. Confirm it with the user. GPA is credit-weighted; cumulative GPA combines previous credits×CGPA and new quality points. Blank/invalid marks are rejected. No transcript import, repeated-course policy, grade persistence or server upload is included.

Both tools can run offline once their public assets and an authorized saved session are prepared. They have separate owner feature switches.

## 7. Help, administration and recovery

The owner edits/publishes Help articles in app/university/developer categories. University articles require HTTPS sources. Only known app-operation FAQs are seeded; no university policy/developer biography is fabricated. Ordinary published search works with no model.

Optional OpenAI integration is disabled by default. It only chooses IDs of up to three approved matching articles; the server displays their reviewed wording. It does not answer unrelated general questions or ingest student files/chat. Punctuation-only, stop-word-only and unmatched questions do not use a provider call. SQL reserves per-user and global daily quotas atomically (default 5 and 100), retains failed/timeout reservations, uses bounded context/output, `store:false`, and no automatic retry. It requires an explicit supported model and private backend key. See `docs/HELP_AI.md`.

The owner's Operations page reports configured runtime, storage usage, enrollment conflicts, reports and reminder health. It supports bounded failed-reminder retry and cleanup of only tracked old unreferenced objects. App controls expose implemented feature flags and read-only maintenance. A dashboard toggle cannot create new software; future features still require code, tests, GitHub commit and deployment.

SQL backup commands export a consistent private NDJSON snapshot, inspect it, restore only into an empty database and rehearse in a new target. They preserve schema/records/types/indexes/triggers and verify checksums/integrity. They do not back up Drive/R2 bytes or the encryption key. Store matching file backups and key separately. Use maintenance for coordinated upgrades, review logs/quota/bills weekly, and rehearse restore monthly. See `docs/BACKUP_AND_RESTORE.md`.

## 8. Offline and installation boundaries

The compiled service worker caches public assets only. Private authorized snapshots and chosen resource blobs use a separate account-specific IndexedDB store. Old CP3 snapshot format is refused after this upgrade. Prepare online first; no offline first-time login. Saved access lasts up to seven days and shows its timestamp. Full timetable/dated changes and allowed subject academic information are readable. Online auth/access denials never become offline fallback. Logout/account changes clear private in-app storage.

Offline changes to shared data, chat, joins, new sign-in, profile edits and admin work are disabled. An already disconnected device cannot learn a new suspension/feature change until it reconnects or expires. Independent files already downloaded cannot be recalled. Browser storage may be evicted; it is not the primary backup.

PWA home-screen setup is included. iPhone uses Safari Share/Add to Home Screen; Android browsers may offer Install. APK/AAB packaging, signing, Play Store release and a direct signed APK link remain CP5. Do not imply a web install button has produced an Android binary.

## 9. Source structure, commands and configuration

Stack: Node 24, React 19/TypeScript/Vite, Fastify 5, `@libsql/client`, Firebase Auth/Admin, private Cloudflare R2 SDK, Google Drive REST/OAuth, JSZip for DOCX. Dependencies are pinned in package-lock. There is no Supabase dependency. Use a **libSQL-compatible** Turso URL with this client; newer `turso://` engine URLs are not supported by this build.

Key source files:

- `client/src/App.tsx`, `pages.tsx`, `AcademicPages.tsx`: navigation, class/subject screens and academic features.
- `AdminDirectory.tsx`, `PlanningPages.tsx`: owner directory and weekly/dated timetable/deadlines.
- `DriveSettings.tsx`, `ChatPanel.tsx`, `ReminderPanel.tsx`: new connected features.
- `StudentToolsPages.tsx`, `student-tools.ts`, `cover-docx.ts`: Word/GPA tools.
- `HelpPage.tsx`, `AdminHelpPanel.tsx`, `OperationsHealthPage.tsx`: assistance and operations.
- `auth.tsx`, `offline-store.ts`, `offline-data.ts`, `client/public/sw.js`: identity and offline boundary.
- `server/section-access.ts`, `section-routes.ts`, `academic.ts`, `auth.ts`: server permission model.
- `server/drive.ts`, `drive-config.ts`, `storage.ts`: providers and accounting.
- `server/chat.ts`, `reminders.ts`, `reminder-runner.ts`, `help.ts`, `help-assistant.ts`: new services.
- `server/backup*.ts`, `operations-health.ts`, `db.ts`: recovery/health/schema.
- Migrations 7–12 respectively: section/subject enrollment, Drive, chat, reminders, Help articles, AI usage.

Local commands:

```sh
npm ci
npm run setup:demo
npm run dev
```

Development browser: `http://127.0.0.1:5173`; compiled/PWA: `npm run build`, `npm start`, `http://127.0.0.1:3001`. Run `npm test` after building. `npm run db:migrate` updates schema without injecting demo users. Keep real and demo databases separate. `setup:demo` refuses to overwrite real configuration.

Configuration variables documented in `.env.example` include Firebase web/Admin settings, exact owner email/UID, optional Google sign-in, DATABASE_URL/TOKEN, R2 credentials, Drive OAuth client/secret/callback/token-encryption key/return URL, resource/base quotas, optional messaging/VAPID and optional OpenAI/budgets. Real secret values belong in a private `.env` or hosting secret settings. Public Firebase web identifiers are intentionally delivered to the browser; Admin keys, tokens and encryption secrets are not. Do not ask the user to paste private credentials into a chat or commit them.

The app is a Node Web Service with same-origin API and client, not a static-only site. Render build: `npm ci && npm run build`; start: `npm start`; production must use Firebase, HTTPS/exact origins, persistent remote SQL and private R2. Render local files are ephemeral. The ZIP excludes private configuration/data, node_modules, cloud keys and test temp files. Install dependencies after extraction.

## 10. What is verified, what is not

Read `docs/VERIFICATION.md` for the final delivered test results. Automated coverage includes cross-role/section/subject authorization, migration preservation, concurrency, file validation/quota/cleanup, Drive callback/token/download behavior with controlled transport, reminders, backup round trips, bounded AI, Word substitutions/grade math, offline/PWA and rendered user journeys.

No real user cloud credentials, Firebase email delivery, Google consent screen, personal Drive/R2/Turso account, FCM push, paid OpenAI call or public hosting has been verified against the owner's accounts. No GitHub repository was pushed. No physical iPhone/Android result, signed APK/AAB or 1,000-user benchmark is claimed. Existing test doubles and demo data are not production accounts or capacity evidence.

## 11. Budget and remaining checkpoint

The starting plan is about 50 students and a target of at least 1,000 registered users later. Chat, video downloads and simultaneous activity determine workload more than account count. Planning budgets are $0 local/light free evaluation, around $7–15/month plus usage for a small paid pilot, and around $25–70+/month plus usage toward 1,000 users after measurement. These are estimates, not capacity guarantees. Review current Render, Turso, Firebase and Cloudflare prices through the primary links in `docs/CHECKPOINT_4_COSTS_AND_SCALING.md`. R2's 10 GB free storage does not eliminate API-host download bandwidth. Keep AI off initially if budget is tight.

**Checkpoint 5: release and evidence.** Configure separate staging/production providers, verify actual university sign-in and owner setup, Drive connection/revocation/ownership handover, R2 avatars, SQL migrations/recovery, notification timing, privacy/retention and real device/PWA/offline use. Load-test representative concurrent subject/chat/download/upload activity before opening campus-wide or raising limits. Complete accessibility review, hosting/GitHub deployment, monitoring, signed Android packaging and Store/direct-download requirements. Do not automatically publish or distribute without the user's concrete release instruction.

Still needed from the user through appropriate private settings or nonsecret content: chosen owner identity, confirmation whether university accounts support Google sign-in, provider projects/hosting choices, approved university Help sources, developer introduction/portfolio/app links, final review of the supplied Word layout/grade scale, and later Android package/signing/Store details. No extra credentials are needed to run the local demo.

For the next chat: **continue this cumulative codebase; preserve the owner/section/subject permission model, review the verification file, and work toward Checkpoint 5 rather than rebuilding CP1.**
