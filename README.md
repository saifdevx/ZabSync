# ZabSync — Checkpoint 3, corrected version 0.3.1

**Built for Students. Designed for Success**

A mobile-friendly university web application for SZABIST Islamabad. This is the complete, cumulative third checkpoint of five: the previous academic-content, account, profile and installation work is included alongside the new admin model, daily dashboard, timetable, deadlines and offline storage.

## Corrections in 0.3.1

Students receive join/read controls and their own profile, bookmarks and checklist actions. Shared editing requires a confirmed class-admin membership. The Master Admin now has a separate online console: semester → section → class tools. Owner-created sections do not enroll the owner. A private exact-email/UID exception supports a separate verified Gmail owner while ordinary registration remains university-only.

The timetable shows the complete week, and **Meet the Developer** is a visible sidebar destination with a dedicated owner editor. Existing SQL data, timetable routines and publication state are preserved. See [the CP3 upgrade guide](docs/UPGRADE_FROM_CHECKPOINT_3.md) and [owner account setup](docs/OWNER_ACCOUNT.md).

## Start here

Install Node.js **24**, extract the project and run these commands from the folder containing `package.json`:

```sh
npm ci
npm run setup:demo
npm run dev
```

Open **http://127.0.0.1:5173**. Use the three fictional demo personas: **Student**, **Class Admin**, and **Master Admin**. For complete Windows/macOS instructions, see [START_HERE](docs/START_HERE.md).

For offline reopening, stop the development server, then run:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**, sign in, visit **Offline access**, and choose **Prepare offline access**. Wait for the app-shell readiness status. The development server does not install a service worker. [Offline guide](docs/OFFLINE.md).

**Upgrading an existing installation?** For 0.3.0 use [UPGRADE_FROM_CHECKPOINT_3](docs/UPGRADE_FROM_CHECKPOINT_3.md); for Checkpoint 1 or 2 read [UPGRADE_FROM_CHECKPOINT_2](docs/UPGRADE_FROM_CHECKPOINT_2.md). Keep your private configuration, database and file store; do not overwrite the new source with the old project.

## What is implemented

| Area            | Working behavior                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | Exact university email-domain and verification checks; Firebase real-account mode; isolated loopback-only demo                                                                  |
| Roles           | Student, membership-scoped Class Admin, and global Master Admin; prior representative roles migrate to Class Admin                                                              |
| Classes         | Class Admin or Master creates directly; ordinary students join through an invitation and membership approval; no student class-creation request                                 |
| Owner directory | Semester → sections → enrolled people; member counts, names, roll numbers where available, stable account IDs; enroll an existing account and grant/revoke Class Admin          |
| Academic spaces | Customizable subjects, PDF/PPT/PPTX uploads, authenticated downloads, search, bookmarks, trash/restore and permanent file removal                                               |
| Announcements   | Subject, whole-class and owner-only university-wide notices, attachments, priorities and pinning; in-app notification inbox                                                     |
| Timetable       | Weekly routine; teacher, room, weekday and time; separate dated extra/cancelled/rescheduled sessions; overlap indicators                                                        |
| Deadlines       | Quiz, assignment and event dates; personal done/open state; an edited deadline requires acknowledgment of its new version                                                       |
| Offline         | Explicit device preparation; complete read-only class snapshot for seven days; chosen file blobs; last-sync/expiry/storage indicators; logout/account-change cleanup            |
| Profiles        | Display name, optional unique username, optional private profile photo with replacement/removal; email and stable ID remain unchanged                                           |
| Owner controls  | Membership roles, account suspension/restoration, global notices, feature switches, read-only maintenance, audit trail and recycle bin                                          |
| Developer       | Owner-managed private draft, preview and publication; intro, portfolio, updates and other app links; dedicated Meet the Developer page, linked from the sidebar and Get the App |
| Installation    | Supplied favicon/home-screen image, manifest, conditional browser install prompt, iPhone instructions, website link sharing and explicit software-update confirmation           |
| Delivery        | Full source, compiled build, dependency lockfile, automated tests, GitHub CI and beginner configuration/upgrade guides                                                          |

Students see the same everyday dashboard; their Class Admin controls appear only where they have permission. A Class Admin cannot assign more admins or gain Master Admin authority. The owner can appoint multiple Class Admins in one class.

The original separate Tutor destination has been replaced. Historical Tutor database content is preserved privately during upgrade; it is not automatically published as developer information. A legacy `/tutor` link redirects to the separate Meet the Developer page.

## Offline behavior

Preparing a device saves academic information for the currently authorized account. The client refuses an incomplete snapshot. A student can browse prepared classes, subject details, notices, weekly/dated timetables and deadlines without a connection. The weekly resolver can show another week from the saved routine and saved dated changes.

Use **Save offline** on a resource to keep its bytes in the in-app device library. **Bookmark** only saves a reference in your account. **Download** creates a separate file managed by the browser/device. Signing out clears the in-app offline library; it cannot recall a separately downloaded file.

Offline use is read-only. New sign-in, class joining, admin controls, profile edits, uploads, bookmark changes and marking deadlines complete require a connection. Prepared access expires after seven days and must be refreshed. Device storage may be evicted by the browser; this is a convenience copy rather than a permanent backup.

A fresh online identity/access check revalidates saved data. Deleted content, lost membership and disabled features are removed from saved access. An HTTP authentication or authorization denial never grants offline fallback. An already disconnected device cannot learn about a new suspension until it reconnects or the saved-access period expires.

The worker caches only public application files; private academic data and explicitly selected file bytes use a separate account-scoped IndexedDB store. Tokens, admin rosters and private profile photos are not placed in that offline store. See [OFFLINE](docs/OFFLINE.md) and [SECURITY_AND_OFFLINE_PLAN](docs/SECURITY_AND_OFFLINE_PLAN.md).

## Structure and providers

React and TypeScript power the interface; Fastify provides the API. SQL uses `@libsql/client`: local SQLite for development, or a compatible remote libSQL/Turso database. Firebase verifies identities. File bytes use a private local directory or private Cloudflare R2. There is no Supabase dependency.

The backend enforces permissions; hiding a button is not its authorization mechanism. Because staff share `szabist-isb.pk`, a verified university address alone does not prove student status. Actual class membership is checked separately. Use an app-specific password, never a university mailbox password.

| Source                                                       | Purpose                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `client/src/App.tsx`, `pages.tsx`, `zabsync.css`             | Application shell, daily dashboard, classes, responsive design       |
| `client/src/AdminDirectory.tsx`                              | Owner semester/section directory and enrollment                      |
| `client/src/PlanningPages.tsx`                               | Weekly timetable, one-time changes and deadlines                     |
| `client/src/AcademicPages.tsx`                               | Subjects, files, notices, saved items and notification inbox         |
| `client/src/OperationsPages.tsx`                             | Profiles, Developer editor and owner settings                        |
| `client/src/offline-store.ts`, `offline-data.ts`, `auth.tsx` | Account-scoped persistence, read-only requests and identity boundary |
| `client/src/OfflinePage.tsx`, `client/public/sw.js`          | Device controls and public shell reopening                           |
| `server/routes.ts`, `auth.ts`, `operations.ts`               | Identity, classes, directory, admin roles and profile/owner APIs     |
| `server/timetable.ts`, `schedule.ts`                         | Versioned planning API and shared online/offline date resolver       |
| `server/offline-access.ts`                                   | Authoritative current-access manifest for offline validation         |
| `server/storage.ts`, `academic.ts`                           | Private files and academic content APIs                              |
| `server/db.ts`, migration modules                            | Schema versions 1–6, including upgrade preservation                  |
| `tests/`, `docs/`, `.github/`                                | Regression checks, beginner guides and CI                            |

## Verify and update

```sh
npm run build
npm test
npm audit
```

Build before running the suite so its compiled-asset check actually executes. Each build includes all generated public chunks in the worker's deterministic asset list, including the lazily loaded Firebase code, and writes dependency-license notices.

Serve this as a **Node web service**, with the client and API on the same origin. A static-only deployment does not supply the backend. GitHub stores source; the SQL database and uploaded files remain in their persistent stores. See [GITHUB_AND_DEPLOYMENT](docs/GITHUB_AND_DEPLOYMENT.md) and [CONFIGURATION_CHECKLIST](docs/CONFIGURATION_CHECKLIST.md).

No cloud accounts, credentials, repository or deployment have been created for you. See [VERIFICATION](docs/VERIFICATION.md) for the exact checks completed and remaining provider/device checks. Automated API, IndexedDB and simulated-DOM checks do not establish physical iPhone/Android behavior or high-concurrency capacity.

## Exactly five checkpoints

1. **Foundation — delivered:** identity, membership, invitations, class structure and basic administration.
2. **Academic content and customization — delivered:** subjects, files, notices, profiles, owner controls and installation foundation.
3. **ZabSync and the offline campus day — this delivery:** revised roles, semester directory, Developer placement, redesigned layout, timetable, dated changes, deadlines and explicit offline use.
4. **Assistance and operations:** scheduled/push reminders, your front-page PDF template, a bounded university/app chatbot, cost/usage controls and backup/recovery work.
5. **Release:** integrated security/load/device checks, configured deployment, Capacitor Android packaging, signing, APK-link distribution and Play Store preparation.

For Checkpoint 4, supply the front-page example and required fields, approved chatbot knowledge and developer details when you are ready. Enter developer content directly in Master Admin whenever convenient. This ZIP does not contain an Android APK or a promise that all later release checks are already complete.
