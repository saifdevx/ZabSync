# ZabSync Checkpoint 4 — beginner setup and operating guide

**Version 0.4.0.** ZabSync is a web application and installable PWA: **Built for Students. Designed for Success.** This guide supersedes older examples that permitted several sections per student. The project implements the features locally; your Firebase, Google, Turso, R2 and hosting accounts still need configuration. Nothing has been published or connected to your private accounts automatically.

## 1. Accounts and classrooms

Real users see sign-in/registration, never a role picker. Firebase verifies identity; the server decides permissions from SQL. University addresses must end in exactly `@szabist-isb.pk` and be verified. The shared staff/student domain cannot prove student enrollment, so section admission is reviewed. Email/password works without assuming the university uses Google Workspace. Optional Firebase Google sign-in requires its provider configuration.

Use **two accounts**: your university account for student/Class Admin participation, and a separate verified Gmail account for **Master Admin**. The external owner exception requires its exact email and pinned Firebase UID. Other Gmail identities remain ineligible. See [Owner account](OWNER_ACCOUNT.md); changing configuration alone does not transfer existing ownership.

| Role         | Allowed actions                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student      | Read their section/enrolled subjects, download resources, use personal tools and permitted chat; customize their own profile.                             |
| Class Admin  | Also manage subjects, academic resources, notices, deadlines, admission requests and timetable inside their assigned section.                             |
| Master Admin | Create sections; browse semesters → sections → students; appoint admins, transfer students, manage all content, global notices, controls and maintenance. |

One student belongs to **one section**, such as 5D. **My Subjects** opens each subject's Resources, Announcements, Deadlines and Chat. The first subject code creates a pending admission request; approval assigns the section. Later subject codes work immediately inside that section. A 5D student cannot join 2D using its code. Only the owner creates sections and transfers students between them; Class Admins create subjects. See [Sections and subjects](SECTIONS_AND_SUBJECTS.md).

## 2. Run locally

Install Node.js **24**, extract the entire ZIP, and open a terminal in the folder containing `package.json`:

```sh
npm ci
npm run setup:demo
npm run dev
```

Open **http://127.0.0.1:5173** and keep the terminal running. Sample accounts, timetable and notices demonstrate behavior. Demo setup will not overwrite existing configuration. Demo authentication is restricted to a local computer and refused in production.

For the compiled app and offline/PWA testing, stop development with Ctrl+C, then run:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Run `npm test` for automated checks. On Windows, `npm.cmd` can replace `npm` if PowerShell blocks its launcher. Existing installations must first follow [Upgrade from Checkpoint 3](UPGRADE_FROM_CHECKPOINT_3.md).

## 3. Where information lives

| Information                                                                              | Local practice             | Configured hosted application  |
| ---------------------------------------------------------------------------------------- | -------------------------- | ------------------------------ |
| Verified identity                                                                        | Fictional local identities | Firebase Authentication        |
| Profiles, memberships, timetable, notices, chat, reminders, file references and controls | SQLite                     | Turso/libSQL                   |
| Profile-image bytes                                                                      | Private local directory    | Private Cloudflare R2          |
| Documents and videos                                                                     | Private local directory    | Uploading admin's Google Drive |
| Prepared offline information/files                                                       | Browser's device storage   | Browser's device storage       |

Chat text belongs in SQL for consistent permissions/moderation; R2 stores binary objects. Students can discuss resources when the admin selects **All subject members**. **Class admins only** permits reading but restricts posting. Neither setting makes a subject internet-public. Chat includes resource references, editing, reporting and moderation, without a separate attachment-upload path.

### Google Drive consent and ownership

Firebase login does **not** authorize Drive. After verified app login, a publishing admin opens **My profile → Google Drive**, chooses their storage account and accepts Google's consent. ZabSync reuses the encrypted refresh grant until it expires or is revoked. Readers need no Drive connection. Storage consent never changes eligibility or publishing permissions. The requested scope is narrow [`drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), alongside identity/email.

The uploader owns the originals and consumes their own Drive storage. Downloads pass through the authenticated server; Render bandwidth still applies. Revoking consent, deleting originals or losing that Google account interrupts file access. Replacing an admin does not transfer Google ownership. Arrange retention and re-upload/transfer before handover. Disconnect removes the app's grant while retaining files. See [Google Drive storage](GOOGLE_DRIVE_STORAGE.md).

R2 remains an explicit alternative through `RESOURCE_STORAGE=base`. A Drive failure never silently consumes R2. Changing destinations does not move old files. Defaults: 25 MiB per document, 100 MiB per MP4/WebM video, 500 MiB resources per section, 8 GiB aggregate base-store budget. PDF, PPT/PPTX and DOC/DOCX are supported. Provider quotas and temporary upload disk also apply.

## 4. Connect real services privately

Create a **fresh real-account database** instead of converting demo identities. Keep credentials in private `.env` locally and hosting secret settings later. Never commit them or paste them into Developer/help content.

1. **Firebase:** create a project/web app; enable Email/Password, verification and password protections. Add localhost and your deployed hostname as authorized domains. Set `AUTH_MODE=firebase`, the four public Firebase web values and server Admin credentials listed in `.env.example`. Configure owner email/UID. Optional Google login additionally needs the Google provider and `FIREBASE_GOOGLE_SIGN_IN_ENABLED=true`. See [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth).
2. **Turso:** create a libSQL-compatible database. Set `DATABASE_URL=libsql://...` and private `DATABASE_AUTH_TOKEN`. This build uses `@libsql/client`; newer `turso://` URLs are not interchangeable. Check the [TypeScript quickstart](https://docs.turso.tech/sdk/ts/quickstart). Run `npm run db:migrate`; this creates schema without fictional users.
3. **R2:** create a private Standard bucket with bucket-scoped credentials. Set `STORAGE_DRIVER=r2`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Leave public access disabled. See [Cloudflare SDK setup](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
4. **Drive:** enable Google Drive API, configure OAuth branding/audience and a Web application OAuth client. Follow [Drive setup](GOOGLE_DRIVE_STORAGE.md) for client ID/secret, a private 32-byte encryption key and scopes. Use exact callback `https://YOUR_HOST/oauth/google-drive/callback` and return `https://YOUR_HOST/account`, with `RESOURCE_STORAGE=drive`. External OAuth apps in Testing can issue refresh grants lasting only seven days for this scope. Complete appropriate publication requirements before relying on lasting consent. See [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
5. **Render:** connect GitHub as a Node **Web Service**. Build: `npm ci && npm run build`; start: `npm start`. Use Node 24, `NODE_ENV=production`, `HOST=0.0.0.0`, exact HTTPS `ALLOWED_ORIGINS`, the host-assigned port, and private provider settings above. Use remote SQL/R2: ordinary local files on Render are [ephemeral](https://render.com/docs/free).

The owner creates real sections and appoints representatives; admins enter genuine timetable/subjects and review students. GitHub stores source. SQL and object stores hold live records; redeploying source does not replace them with samples.

## 5. Offline, installation and student tools

In the compiled app, open **Offline access → Prepare offline access** while signed in and online. Wait for both application shell and account snapshot readiness. Students/Class Admins can then read their authorized timetable and saved academic information for seven days; selected files require **Save offline**. Chat, uploads, account creation and owner administration need connectivity. Sign-out/account changes clear in-app saved data; independent downloads remain on the device. Prepare again after this upgrade. See [Offline behavior](OFFLINE.md).

On iPhone, open the deployed HTTPS site in Safari and use **Share → Add to Home Screen**. Android users can install from a supported browser's menu. A signed APK/direct APK link and Play release remain Checkpoint 5 work; an installation button cannot generate a signed Android build.

Front page uses the supplied Word template with ZabSync's interface. CGPA uses the supplied grade scale and credit-weighted calculations, without transcript-specific repeat rules. Both calculate locally once their assets are prepared. Review the cover output and grade scale before release.

Personal deadline reminders persist in SQL. The running app processes inbox delivery; dependable timing needs an always-running service. Optional device notifications need Firebase messaging configuration and explicit device permission. A separate scheduled process can use `npm run reminders:once`; see [Chat and reminders](CHECKPOINT_4_CHAT_REMINDERS.md). Approved Help works without a paid model. Optional AI requires configured usage limits and reviewed sources.

## 6. Maintenance and Checkpoint 5

Use the owner dashboard for implemented switches, content and operational status. New functionality still needs code, review, a GitHub commit and deployment. Before updates, export and rehearse recovery:

```sh
npm run backup -- export --output data/backups/before-update.ndjson
npm run backup -- rehearse --input data/backups/before-update.ndjson --target file:./data/rehearsal-new.db
```

Choose unused filenames. These private SQL snapshots exclude resource bytes. Preserve matching R2/local objects and the encryption key separately; see [Backup and restore](BACKUP_AND_RESTORE.md). Review storage, bills, failed reminders, access changes and backup success weekly; rehearse recovery monthly. Use maintenance when coordinating schema/file changes; verify student/admin access before reopening.

Checkpoint 5 must validate real university email delivery, role boundaries, Drive consent/upload/download/revocation, R2 images, recovery, actual iPhone/Android installation and offline behavior, push, accessibility and admin handover. Load-test representative concurrent reads/uploads/chat before claiming capacity for 1,000 users. Confirm final Word output, grade scale, Developer content and Android signing/release details. See [Costs and scaling](CHECKPOINT_4_COSTS_AND_SCALING.md).
