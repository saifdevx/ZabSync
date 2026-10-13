# ZabSync — Checkpoint 4 · version 0.4.0

**Built for Students. Designed for Success**

The complete cumulative source and compiled build for the fourth of five checkpoints. ZabSync is a mobile-friendly university app: each student belongs to **one section**, joins **subjects inside that section**, and reads its resources, announcements, deadlines, timetable and subject chat. Class Admins manage their assigned section's teaching content; the Master Admin manages the application through a separate owner console.

**Start with [the Checkpoint 4 guide](docs/CHECKPOINT_4_GUIDE.md).** Keep [ZabSync_Project_Context.md](ZabSync_Project_Context.md) for a new chat or developer. It records the current requirements, implementation and remaining release work. This checkpoint supersedes older instructions about students joining multiple classes or Class Admins creating sections.

## Run locally

Install Node.js **24**, extract this ZIP, open the folder containing `package.json`, then run:

```sh
npm ci
npm run setup:demo
npm run dev
```

Open **http://127.0.0.1:5173**. The clearly labelled demo offers fictional Student, Class Admin and Master Admin personas so you can test permissions without provider accounts. Demo mode is restricted to loopback development and refuses public/production operation.

**Real students see sign-in/registration, with no role selector.** The server verifies their university identity. Only the owner appoints Class Admins. Google sign-in is optional and must be enabled in Firebase; verified email/password remains available when a university address is not a Google account. A separately pinned owner email and Firebase UID can use the owner sign-in route.

For the compiled app and offline preparation:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**, sign in online, open **Offline access**, and choose **Prepare offline access**. Wait for both the snapshot and public app shell to be ready. Development mode on port 5173 deliberately does not install the service worker.

More beginner help: [START_HERE](docs/START_HERE.md). Existing installations: [upgrade from Checkpoint 3](docs/UPGRADE_FROM_CHECKPOINT_3.md). Never replace a real database with the demonstration database.

## What changed in Checkpoint 4

| Area                     | Implemented behavior                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One class, many subjects | My Class and My Subjects replace multiple-class navigation. First subject-code admission requires approval and establishes the student's section. Subsequent subjects must belong to that section. Transfers require the owner.                            |
| Permissions              | Only the owner creates sections and appoints Class Admins. Class Admins create subjects and manage content in their assigned section. Ordinary students cannot publish shared academic content or edit the timetable.                                      |
| Subject space            | Separate Resources, Announcements, Deadlines and Chat tabs, all scoped to the opened subject and checked by the API. Whole-section and owner-only global notices remain available.                                                                         |
| Hybrid storage           | New shared files use the uploader's connected Drive when configured. Private R2/local storage handles avatars, small objects and explicit resource fallback. Chat text and structured records use SQL.                                                     |
| Drive connection         | Separate one-time consent in My profile; encrypted refresh tokens; private app-created files; reconnect/disconnect; original uploader and revision tracking. Readers do not need to connect Drive.                                                         |
| Uploads                  | PDF, PPT/PPTX, DOC/DOCX, MP4 and WebM; configurable document, video and section limits; authenticated streamed downloads, bookmarks and chosen offline copies.                                                                                             |
| Chat                     | Class Admin chooses member posting or admin-only posting. Members can refer to a subject resource, edit/delete their own messages and report messages. Admins can remove messages and temporarily mute students. Both modes remain private to the subject. |
| Front page               | New ZabSync form generates a Word `.docx` locally using the supplied template. Student/teacher/subject/roll number/date/semester/section fields are filled without sending them to the server.                                                             |
| GPA/CGPA                 | Local credit-weighted calculator using the supplied grade bands, with previous-credit/CGPA inputs. Blank/invalid marks are rejected and decimal band gaps are corrected.                                                                                   |
| Reminders                | Per-deadline opt-in, durable jobs and an in-app reminder inbox. Optional Firebase device push, disabled until configured. Delivery rechecks access, consent, deadline version and completion.                                                              |
| Help                     | Owner-published app/university/developer articles and free local search. Optional bounded OpenAI integration selects approved source articles; it does not expose an unrestricted chatbot.                                                                 |
| Operations               | Owner usage/health view, failed-reminder retry, storage allowances, controlled orphan cleanup, feature switches, maintenance and audit records. SQL export, inspect, restore and rehearsal commands.                                                       |

The preceding checkpoints' full-week timetable, dated class changes, personal deadline completion, profile customization, Meet the Developer publishing, notifications, trash/restore, account suspension and PWA installation foundation are retained.

## Important storage distinction

Google sign-in authenticates an account; Drive access needs a separate OAuth consent. A university application account may connect a personal Gmail Drive without changing its verified ZabSync identity. Files count against the **uploader's** Google account, not every reader's account. Existing students reading/downloading notes need no Drive permission.

ZabSync creates files without public sharing and serves authorized downloads through its API. The Google account owner can later share files outside the app, which ZabSync cannot prevent or revoke. Do not share them publicly to bypass permissions. The API host still handles upload/download traffic and temporary files; Drive reduces your stored file bytes, not every hosting cost. There is no silent fallback when Drive fails.

A departing admin's files still depend on that uploader's connection and Google account. The owner must plan a handover or re-upload before the account is disconnected, deleted or filled. Changing the storage setting affects new uploads; it does not migrate old files. See [Google Drive storage](docs/GOOGLE_DRIVE_STORAGE.md) and [costs and scaling](docs/CHECKPOINT_4_COSTS_AND_SCALING.md).

## Offline behavior

A prepared Student/Class Admin device can reopen the app and read its saved class information, full weekly timetable, dated changes, authorized subject notices/resources and deadlines for up to seven days. Selected resource bytes are separate from bookmarks. The public front-page template is included in the compiled shell; the front-page form and calculator run locally after that shell is cached.

Chat, new sign-in, joining subjects, admin edits, uploads, reminder scheduling/push permission and current Help search require a connection. Offline screens show the saved timestamp; they are not proof that a timetable or membership has remained unchanged. Online authorization denials never turn into offline access. Logout/account changes clear the app's private offline store, but cannot erase a separate file already downloaded to the device. See [OFFLINE](docs/OFFLINE.md).

## Project structure

| Location                                                                | Purpose                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `client/src/App.tsx`, `pages.tsx`, `AcademicPages.tsx`                  | App shell, My Class/My Subjects and subject content                    |
| `client/src/PlanningPages.tsx`, `AdminDirectory.tsx`                    | Weekly schedule, deadlines and owner semester/section/people directory |
| `client/src/ChatPanel.tsx`, `ReminderPanel.tsx`                         | Subject conversation, personal reminders and inbox                     |
| `client/src/DriveSettings.tsx`, `OperationsPages.tsx`                   | Drive consent, profile, owner controls and developer publishing        |
| `client/src/StudentToolsPages.tsx`, `student-tools.ts`, `cover-docx.ts` | Branded forms, GPA math and template-preserving Word generation        |
| `client/public/templates/assignment-cover.docx`                         | Original supplied Word template                                        |
| `client/src/HelpPage.tsx`, `AdminHelpPanel.tsx`                         | Published help and owner editor                                        |
| `client/src/offline-*`, `client/public/sw.js`                           | Account-scoped offline data and public app shell                       |
| `server/section-*.ts`, `academic.ts`, `auth.ts`                         | One-section enrollment, subject authorization and identity             |
| `server/drive*.ts`, `storage.ts`                                        | Drive OAuth, hybrid private objects, validation and quota accounting   |
| `server/chat.ts`, `reminders.ts`, `reminder-runner.ts`                  | Chat moderation, durable scheduling and optional device delivery       |
| `server/help*.ts`, `operations-health.ts`                               | Approved help, bounded AI budgets and owner health summaries           |
| `server/backup*.ts`, `db.ts`, migration modules                         | Recovery tooling and schema versions 1–12                              |
| `tests/`, `docs/`, `.github/workflows/`                                 | Regression checks, guides and GitHub CI                                |

## Providers and release status

React/TypeScript + Vite; Fastify/Node; local SQLite or compatible remote Turso/libSQL through `@libsql/client`; Firebase Auth; private R2 plus Google Drive. There is no Supabase dependency. Provider configuration names and safe defaults are in `.env.example`; secrets belong only in the backend environment.

The cloud integrations are implemented and exercised with controlled provider responses. **Your actual Firebase, Drive, R2, Turso, push and OpenAI accounts have not been connected or tested.** No repository was pushed and no site or APK was published. A thousand registered users is the scaling target, not a measured capacity claim. The final checkpoint includes staging credentials, device checks, workload tests, recovery rehearsal, deployment and Android packaging.

| Checkpoint                           | Status                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation                        | Included: identities, persistence, basic roles and academic structure                                                            |
| 2. Content and customization         | Included: files, notices, profiles, owner controls and install foundation                                                        |
| 3. Student day and offline           | Included: owner directory, timetable, deadlines, Developer page and explicit offline storage                                     |
| 4. Connected features and operations | This delivery: revised section/subject model, Drive/R2, chat, Word/CGPA, reminders, Help and recovery                            |
| 5. Release                           | Remaining: configured cloud acceptance, actual iPhone/Android and load tests, deployment, APK/AAB/signing/Play Store preparation |

## Verification and upkeep

```sh
npm run build
npm test
npm audit
```

The build type-checks both applications, stamps the public offline assets and compiles the API. Test authorization and migration behavior before upgrades, and rehearse backups separately from source updates. Exact performed checks and limitations are recorded in [VERIFICATION](docs/VERIFICATION.md).

Use [BACKUP_AND_RESTORE](docs/BACKUP_AND_RESTORE.md), [CHECKPOINT_4_GUIDE](docs/CHECKPOINT_4_GUIDE.md), [CONFIGURATION_CHECKLIST](docs/CONFIGURATION_CHECKLIST.md), [HELP_AI](docs/HELP_AI.md) and [STUDENT_TOOLS](docs/STUDENT_TOOLS.md). GitHub stores source and configuration examples; the database, private keys and stored files must stay outside the repository.
