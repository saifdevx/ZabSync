# Upgrade Checkpoint 3 to Checkpoint 4 (0.4.0)

This is **Checkpoint 4 of five**, supplied as a complete project. It replaces 0.3.0/0.3.1 source while preserving real accounts and academic records through migrations. The authoritative beginner instructions are [Checkpoint 4 guide](CHECKPOINT_4_GUIDE.md). Older examples that permit one person to create/join several sections no longer apply.

## 1. Preserve the working installation

1. Record the running version, Firebase project, database URL, storage location/bucket and deployment settings privately. Keep the old project/release available.
2. Put the old app into maintenance, stop its server and other writers, and take a consistent database backup plus matching private object files. For local SQLite, stop every process using the database before copying its `data/` directory and any database sidecars. Do not copy a live SQLite main file alone while WAL writes continue.
3. Extract Checkpoint 4 into a **new folder**. Copy your private `.env` and preserved local `data/` where applicable; deliberately retain remote database/R2 settings. Check absolute paths before running anything.
4. Do not overwrite new source, package lockfile or build with old files. Install dependencies afresh. Keep one application instance during this upgrade.

Do not run demo setup against real Firebase/database configuration. A freshly extracted folder is the appropriate place to try fictional users. Changing identity mode is not a data migration.

## 2. Install, snapshot, migrate and build

Use Node.js 24 and a terminal in the new project folder:

```sh
npm pkg get version
npm ci
```

The version must be **`0.4.0`**. With copied settings pointing to the existing database, the new backup command can snapshot that older schema **before migration**; it does not seed users or run migrations:

```sh
npm run backup -- export --output data/backups/before-cp4.ndjson
npm run backup -- inspect --input data/backups/before-cp4.ndjson
npm run backup -- rehearse --input data/backups/before-cp4.ndjson --target file:./data/before-cp4-rehearsal.db
```

Use unused output/target names. The private export contains SQL records and any encrypted connection credentials, not resource bytes. Preserve configuration keys separately. See [Backup and restore](BACKUP_AND_RESTORE.md).

Then run:

```sh
npm run db:migrate
npm run build
npm test
npm start
```

Open **http://127.0.0.1:3001** for the compiled app. For editing source, use `npm run dev` and port 5173; that development server does not provide the complete offline build.

## 3. What migrations preserve and change

Existing schema versions 1–6 remain. Checkpoint 4 adds:

| Version | Purpose                                                                               |
| ------- | ------------------------------------------------------------------------------------- |
| 7       | One section assignment, subject enrollment and hashed subject invitations.            |
| 8       | Encrypted Drive connections, resource mappings and tracked base-storage reservations. |
| 9       | Subject chat, posting controls and moderation.                                        |
| 10      | Personal reminder preferences, jobs, inbox and optional device-delivery state.        |
| 11      | Owner-curated help articles.                                                          |
| 12      | Optional assistant usage accounting.                                                  |

Migrations are repeatable and transactional. The migration command does not add fictional identities to real databases. Existing notices, subjects, resources, timetable, accounts and role history are preserved.

An account with exactly one existing active section is assigned to it, and its existing subject access is populated. An older account with **multiple active sections** is marked for owner resolution instead of choosing silently. It cannot open conflicting academic content until resolved. Some conflicting pending requests also require resolution.

Open **Owner dashboard → semester → destination section → People → Enroll or transfer a student**. Review preserved membership history, use **Transfer / resolve**, select the intended section/subjects and provide a reason. Previous section memberships become removed/rejected; they are not erased. The transferred person becomes a Student; appoint a Class Admin in the destination if appropriate. See [Sections and subjects](SECTIONS_AND_SUBJECTS.md).

Old class invitations remain historical records but cannot join a section. Generate new **subject codes**. Initial admission requires approval; later codes must match the student's assigned section. Class Admins create subjects inside their section; only the owner creates sections.

## 4. Storage migration is explicit

Keep `STORAGE_DRIVER` and the existing private directory/bucket for old files. Without Drive credentials, new resources continue using that base store. Once all Drive settings are configured, new resources default to connected uploader-owned Drive. Set `RESOURCE_STORAGE=base` deliberately if you need the existing destination. No error silently changes destinations.

Historical resource keys remain mapped to their original storage. Enabling Drive does **not** copy existing R2 files to Google. Changing a bucket/local directory does not migrate object bytes. Plan any copy separately and preserve originals until every referenced file can be read.

Migration 8 counts legacy resources by recorded size and conservatively reserves 2 MiB for each old profile image, whose previous schema did not record byte size. New images use actual stored bytes. If preserved objects already exceed the default 8 GiB base budget, reads remain possible but new base uploads require cleanup or an explicitly increased budget. Owner cleanup targets only tracked, unreferenced generated objects older than one hour; it never scans arbitrary personal Drive files.

## 5. Refresh installed/offline copies and verify

Deploy the compiled update at the same HTTPS origin, finish unsaved forms and accept the update prompt. Checkpoint 3 offline snapshots are intentionally incompatible with the new one-section format. University users must reconnect and prepare **Available offline** again. Independently exported downloads stay on their devices. The owner console remains online-only.

Before reopening to students, verify:

- Student login has no role selector or shared create/edit controls; one approved section and only enrolled subjects appear.
- New subject admission requires approval; another section's code fails. Owner transfer removes previous access and does not carry admin rights.
- A Class Admin manages their section's subjects, timetable, notices and deadlines, plus each subject's chat mode.
- Existing resources and images still download. Test new PDF/DOCX and a small MP4, then Drive consent/upload/download/revocation with a non-sensitive test account when configured.
- Global notices, Meet the Developer, reminders, Front page and CGPA controls have their intended visibility.
- A freshly prepared student timetable reopens offline; chat and administration require connectivity.
- A private backup and restore rehearsal succeed. Confirm matching object bytes and the encryption key remain recoverable.

No live provider connection, physical-device result or thousand-user capacity is implied by local tests. Follow the acceptance list in [Checkpoint 4 guide](CHECKPOINT_4_GUIDE.md) before release. For rollback, restore the **matching old source, configuration, database and private-file snapshot**; do not point Checkpoint 3 code at an upgraded database or discard current files automatically.
