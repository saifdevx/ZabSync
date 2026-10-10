# CampusDesk — Checkpoint 1 of 5

A working class-management foundation for **SZABIST Islamabad**, built with React, TypeScript, a Node.js API, and SQL. CampusDesk is a provisional app name; each class chooses its own name, program, semester, section, and description.

**Start with [docs/START_HERE.md](docs/START_HERE.md).** It contains beginner instructions for Windows, macOS, and Linux, plus common problems and a demo walkthrough.

## Run locally

Install **Node.js 24 LTS**, extract the ZIP, and open a terminal in this folder (the folder containing `package.json`). Run:

```sh
npm ci
npm run setup:demo
npm run dev
```

Open **http://127.0.0.1:5173**. Keep the terminal running. Press **Ctrl+C** to stop it.

The local demo offers Student, CR, GR, and Master Admin personas. Changes are saved in the local SQL database under `data/`; sample accounts are fictional. It does not send university emails or connect to a paid service. The demo is restricted to this computer. The app refuses to run demo authentication in production or against a remote database.

To run the compiled version locally, stop the development server, then use:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. A compiled build still follows your `.env` authentication configuration.

## What works in this checkpoint

| Area                   | Implemented behavior                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Account access         | Firebase email/password registration, verification, sign-in, password reset, and sign-out; configurable local demo for practice            |
| University restriction | Server-verified Firebase identity, verified mailbox, and exact `szabist-isb.pk` domain before application access                           |
| Class setup            | Request a configurable class space; Master Admin approves or declines; approval appoints the requester as CR                               |
| Joining                | Permanent Class ID, random expiring join code, code rotation, and separate membership approval                                             |
| Class management       | CR/GR edit their own class details, review join requests, and remove students; students read approved class data                           |
| Representative changes | Master Admin assigns CR/GR from active members, replaces the previous representative, and preserves a CR for every class                   |
| Profiles and people    | Edit your display name, view your classes and roles, and see a class roster; student views omit classmates’ email addresses                |
| Request outcomes       | Track class requests and actual membership requests, including approval, rejection, and ended membership                                   |
| Administration         | Class, user, request and audit listings with bounded pagination; UI filters are explicitly scoped to the displayed page                    |
| Campus links           | Separate university website and official ZABDESK shortcuts; the portal opens externally                                                    |
| Interface              | Responsive layout, mobile navigation, original supplied branding, keyboard focus, form validation, loading/error/empty states and feedback |

The email domain is shared by students and staff. Mailbox verification establishes university identity; representatives must still check membership requests. A domain cannot establish current enrollment by itself.

## What arrives in the remaining four checkpoints

This ZIP is the complete source for **Checkpoint 1**, not the final five-checkpoint application. Each later checkpoint will include the accumulated application and upgrade instructions.

| Checkpoint                        | Scope                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 — Foundation**                | Accounts, class setup, permissions, invitations, profile and administration foundation                                                                             |
| **2 — Academic content**          | Subjects, private files, class/subject/global announcements, resource search and bookmarks, editing/deletion, and in-app notifications                             |
| **3 — Offline campus day**        | Weekly timetable, dated exceptions, quiz/assignment deadlines, installable PWA, offline reopening, cached academic data and explicitly saved files                 |
| **4 — Assistance and operations** | Push and scheduled reminders, full owner controls, maintenance, quotas, backups, front-page PDF generator and constrained university/app chatbot                   |
| **5 — Release**                   | End-to-end hardening, real-device/offline checks, Render/local deployment instructions, Capacitor Android project, signing/build guidance and final cumulative ZIP |

**Offline timetable access is a required Checkpoint 3 feature.** This foundation does not yet cache class data, run a service worker, or reopen offline as an installed PWA. Its online/offline banner reports connection state. Running a local SQL database is different from an offline-capable web app.

## Connect real university accounts

Follow [docs/CONFIGURATION_CHECKLIST.md](docs/CONFIGURATION_CHECKLIST.md) to configure Firebase and optionally a compatible Turso/libSQL database. No credentials are included in this ZIP.

- Use a separate clean database for Firebase identities. A seeded demo database cannot be reused as a real-account database.
- The first owner is configured through **your own verified university email** in `MASTER_ADMIN_EMAIL`; no example address becomes owner automatically.
- Keep server credentials in `.env` or your hosting environment. Firebase's client configuration is public by design, while service-account private keys and database tokens are server secrets.
- Configure Firebase's password policy and authorized domains as described in the guide. Register an app-specific password; CampusDesk does not need the password for your university mailbox.
- The API denies ineligible accounts access to application data. Auth-provider account creation itself has a separate control boundary; the configuration guide explains Firebase blocking functions if that stricter provider-level requirement is needed.

For Render testing later, use real Firebase authentication, a persistent remote SQL database, HTTPS, and the deployed origin allowlist. A production build with local demo personas is not a public deployment configuration.

## Project layout

| Path                        | Purpose                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `client/src/`               | React pages, authentication state, reusable components and responsive CSS             |
| `client/src/tokens.css`     | Core brand colors and font choices                                                    |
| `client/public/branding/`   | The two original supplied university logos                                            |
| `client/public/favicon.svg` | Simple app icon suited to small sizes                                                 |
| `server/`                   | API, provider authentication, permissions, schema migrations and local fixtures       |
| `tests/`                    | Security/API tests and simulated-DOM interface integration tests                      |
| `scripts/`                  | Safe local-demo setup                                                                 |
| `docs/`                     | Beginner guide, configuration, scope, security/offline design and verification record |
| `.env.example`              | Configuration template with empty secrets                                             |
| `package-lock.json`         | Exact dependencies for repeatable installation                                        |

## Development commands

```sh
npm run typecheck
npm test
npm run build
npm run db:migrate
```

The migration command creates/upgrades the schema without seeding demo accounts. Normal API startup also applies schema migrations, then adds fictional fixtures only in demo mode. There is no destructive automatic database reset.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the checks performed and their limits. In particular, a passing build and automated tests do not constitute live Firebase/Turso, rendered mobile-browser, or Android verification.

## Design and supplied assets

The primary palette uses `#192E59` navy, `#0B4CA1` blue, white, and `#3EC44F` green, with pale blue backgrounds and restrained green accents. Body text uses darker slate tones. The two supplied logo images are preserved as originals and scaled in CSS; the favicon is a separate simple app mark. Higher-resolution university artwork can replace the current files later.

Each client build also generates `dist/client/THIRD_PARTY_LICENSES.md`, retaining the license notices for the browser's bundled dependencies.

This is an independent student project. The university website link is the address supplied by the project owner. The separate [ZABDESK shortcut](https://zabdesk.szabist-isb.edu.pk/) follows the link on the [university's official ZABDESK page](https://szabist-isb.edu.pk/zabdesk/).

## Keep before upgrading

Keep your previous checkpoint folder and a database backup. Later checkpoints will include exact migration steps. Keep `.env`, service-account files, Android signing keys and real data private. Do not copy old `node_modules` or generated `dist` over a newer checkpoint.

For the next checkpoint, useful inputs are your preferred app name and a few sample subject names and non-sensitive course documents. The front-page PDF template and university/creator knowledge for the chatbot are needed later.
