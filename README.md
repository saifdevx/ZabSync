# XVIA — Node Compass Task

## Checkpoint 2 of 5 · Complete cumulative application

An independent class-management application for SZABIST Islamabad: university-email accounts, class spaces, subject resources, clear announcements, personal profiles, and a central Master Admin dashboard. This package contains Checkpoint 1 plus the Checkpoint 2 implementation. It does not require the earlier ZIP.

**Start with [docs/START_HERE.md](docs/START_HERE.md). Keeping your old data? Read [docs/UPGRADE_FROM_CHECKPOINT_1.md](docs/UPGRADE_FROM_CHECKPOINT_1.md) first.**

### Try it locally

Install Node.js **24**, extract the ZIP, and open a terminal in the folder containing `package.json`:

```sh
npm ci
npm run setup:demo
npm run dev
```

Open **http://127.0.0.1:5173** on the same computer. Keep the terminal open. Stop with **Ctrl+C**.

The demo requires no Firebase, Turso, Cloudflare, or Play Store account. Its four fictional personas let you try Student, CR, GR, and Master Admin views. The database and uploaded files persist under `data/`. The first dependency installation needs internet. Demo identities are explicitly local-only; demo mode refuses production, remote origins/peers, remote databases, or R2 storage.

To try the compiled application, stop the development server and run:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Service-worker installation is enabled for the compiled build in a secure browser context. Localhost is suitable for testing on that computer; use a deployed HTTPS address and real authentication for phones.

## What is implemented

| Area             | Working behavior                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | Firebase registration, email verification, sign-in/reset/sign-out; exact verified `szabist-isb.pk` app access; explicit owner bootstrap                                                  |
| Classes          | Configurable name/program/semester/section, Master approval, stable Class IDs, rotating expiring invites, membership approval, scoped CR/GR management                                   |
| Subjects         | Names, codes, instructors, descriptions, five color accents; editing, search, trash and restoration                                                                                      |
| Lecture files    | Private PDF/PPT/PPTX upload and download; title/description editing; 25 MiB/file, 100 MiB/class including trash; restoration and explicit permanent removal                              |
| Announcements    | Subject, whole-class, and Master-only global audiences; title/details/priority/pinning; up to five same-audience resource attachments; editing, trash and restoration                    |
| Discovery        | Visible updates on Home, scoped search across accessible content, private bookmarks, paginated lists                                                                                     |
| Notifications    | In-app announcement inbox, unread count, mark-one/read-all; edits make a notice unread again                                                                                             |
| Profiles         | Display name, optional unique `@username`, optional JPEG/PNG/WebP photo, replacement/removal; verified email and internal ID remain stable                                               |
| Tutor            | Master edits a private draft, previews, publishes/unpublishes, adds subjects and HTTPS contact/booking links; students see published information                                         |
| Master dashboard | Class approvals and representatives, member suspension/reactivation, global notices, recycle bin, audit history, implemented-feature switches, read-only maintenance                     |
| Install          | Supplied university favicon/home-screen icon, manifest, supported-browser install prompt, iPhone instructions, link sharing, public offline reconnect page, explicit update confirmation |
| Delivery         | Complete source, compiled client/server, exact lockfile, tests, GitHub CI workflow, configuration and upgrade guides                                                                     |

All subjects in a class share its approved membership. CP2 does not create a second membership system per subject. CR/GR publish the academic content; general student chat is not enabled.

### Important distinctions

- **Bookmark:** remembers a file or announcement in your account while you have access. It does not download the content.
- **Download:** saves an authorized file through the browser. Previously downloaded copies remain on a student's device after account removal.
- **Home-screen installation:** opens the web application with an app-like presentation. CP2 still needs internet for accounts and academic data.
- **Offline timetable and saved in-app academic content:** mandatory Checkpoint 3 work. The current service worker caches only a public reconnect page and its logo, never account/API/file responses.
- **Feature controls:** enable/disable implemented functionality and manage content. New functionality is developed in code, checked, and deployed through GitHub; the dashboard does not generate arbitrary new code.

## Security and providers

The server enforces permissions on every protected endpoint, rechecks writes in SQL transactions, and never trusts frontend role claims. Firebase proves mailbox control; because staff use the same domain, class membership approval remains a separate check. Users create an app-specific password, not their university mailbox password.

The application uses SQL through `@libsql/client`, with local SQLite for demonstration and an optional compatible Turso/libSQL database. Firebase Auth is the identity provider; Firestore is not the application database. File bytes use private local storage or a private Cloudflare R2 bucket. There is no Supabase dependency.

See [configuration](docs/CONFIGURATION_CHECKLIST.md), [academic API/storage](docs/ACADEMIC_API.md), [operations](docs/OPERATIONS_API.md), and [security/offline design](docs/SECURITY_AND_OFFLINE_PLAN.md). No real credentials or database are included in this ZIP.

## Project map

| Path                                                      | Purpose                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `client/src/App.tsx`                                      | Navigation, application shell, access state and central routes      |
| `client/src/AcademicPages.tsx`                            | Subjects, resources, announcements, search, bookmarks and inbox     |
| `client/src/OperationsPages.tsx`                          | Profiles, Tutor, settings and member status controls                |
| `client/src/InstallPage.tsx`                              | Installation instructions, native prompt and explicit updates       |
| `client/src/styles.css`, `academic.css`, `operations.css` | Responsive base and feature styles                                  |
| `client/public/icons/`                                    | Original supplied logo and SVG container for scalable manifest use  |
| `server/academic.ts`, `operations.ts`                     | Academic and owner/profile APIs                                     |
| `server/storage.ts`                                       | Bounded private uploads, file validation, local/R2 adapters         |
| `server/auth.ts`, `routes.ts`, `site-settings.ts`         | Provider identity, class permissions, maintenance and feature gates |
| `server/db.ts`, `*-migration.ts`                          | Additive schema migrations 1–4                                      |
| `tests/`                                                  | Security, upgrade, storage, workflow and simulated-DOM tests        |
| `.github/`                                                | CI checks and dependency-update configuration                       |
| `docs/`                                                   | Beginner, upgrade, provider, install and development guides         |

## Build and verification

```sh
npm run build
npm test
npm audit
```

Each build stamps a deterministic public-asset version into the service worker and generates browser dependency license notices. The web app and API are built together; serve the project as a **Node web service**, not only as a static site.

The checked-in CI uses read-only repository permissions and runs installation, build, tests and a high-severity production-dependency audit. See [docs/GITHUB_AND_DEPLOYMENT.md](docs/GITHUB_AND_DEPLOYMENT.md). No GitHub repository has been created or pushed, and no hosting deployment has occurred as part of this checkpoint.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for completed checks and limits. Simulated DOM testing is not a substitute for a real mobile browser. Live Firebase/Turso/R2 credentials, phone installation, load testing, Android builds and Play submission require later configured validation.

## The five checkpoints

1. **Foundation — delivered:** accounts, roles, class creation/approval, invitations, membership and basic administration.
2. **Academic content and customization — delivered:** subjects/files/notices/bookmarks/inbox, XVIA branding, profiles/Tutor, central controls, and home-screen installation foundation.
3. **Offline campus day:** weekly timetable, dated exceptions/extra classes, quiz/assignment deadlines, offline reopening with saved academic data/files, account-scoped storage and last-sync indicators.
4. **Assistance and operations:** push/scheduled reminders, front-page PDF generator, bounded university/app chatbot, configurable budgets/quotas, backup/recovery and remaining operational controls.
5. **Release:** final end-to-end/security/load/real-device/offline checks, deployment handoff, Capacitor Android packaging, signing, APK distribution and Play Store preparation.

Tutor content starts as an unpublished blank draft so the owner can supply accurate information. The front-page sample and chatbot knowledge will be needed in Checkpoint 4. A signed APK and Play listing are not included yet.
