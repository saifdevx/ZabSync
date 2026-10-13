# SQL backups and restore rehearsals

ZabSync Checkpoint 4 • 12 October 2026

## What this backup includes

The backup CLI exports schema declarations and all application SQL records from **one libSQL read transaction**. It includes users, memberships, subject enrollment, timetable, notices, resources metadata, chat, settings, audit records, reminder delivery state, Google Drive mappings and encrypted connection credentials, migration history, indexes, views, triggers and AUTOINCREMENT sequence state. Binary SQL values use base64 and 64-bit integers use decimal strings so ordinary JSON number rounding cannot damage IDs or counters. Row IDs, generated-column definitions and WITHOUT ROWID tables are preserved.

It never copies a live SQLite file while a WAL journal may contain newer writes. Each table is read in pages from the same snapshot, and records are streamed to a private JSON-lines file. The output has a SHA-256 integrity footer and mode `0600` on systems supporting POSIX permissions. A failed or truncated export is not left under the requested final filename. The format limits individual records to 16 MiB; large resources belong in object storage. Virtual-table extensions and unusual non-finite SQL reals are not supported by this portable format and fail explicitly.

**This is a database backup, not a backup of resource-file bytes.** It does not contain R2/local lecture files, avatars or user-owned Google Drive originals. It also does not contain environment variables, Firebase Admin private credentials, the plaintext Drive token-encryption key or Android signing keys. Preserve those separately and securely.

Backups contain personal student data and encrypted credentials. Keep them private, outside the served website and source ZIP. Do not commit them, send them to a chatbot, or attach them to support tickets. The checksum detects accidental corruption; it is not a signature proving an unknown file is trustworthy. Restore only your own trusted backups because schema definitions include executable SQL triggers and views.

## Export from the configured application database

The command reads `DATABASE_URL` and `DATABASE_AUTH_TOKEN` from the current private environment. It does not seed demo users, migrate the source, change ownership, or switch the live application's database.

```bash
npm run backup -- export --output data/backups/zabsync-2026-10-12.ndjson
npm run backup -- inspect --input data/backups/zabsync-2026-10-12.ndjson
```

Choose a new filename each time. An existing output is refused. `inspect` validates the complete backup and reports only aggregate counts, table names and the checksum; it does not print row contents or tokens.

For a local source, the CLI refuses to silently create a missing database. The source must already exist. For remote libSQL, the read transaction is a consistent snapshot at its selected database endpoint; use the intended authoritative database, not a stale exported generation or an unsynchronized local replica. Provider transaction-duration, response and connection limits still apply. If a large remote export times out, investigate the provider limits rather than treating a partial file as a backup.

## Restore only into a new target

```bash
npm run backup -- restore --input data/backups/zabsync-2026-10-12.ndjson --target file:./data/recovery-2026-10-12.db
```

The target local file must not exist. A new protected file is created atomically; existing files and symlinks are refused. For a compatible remote libSQL database, create a new empty database first, set its token in `BACKUP_TARGET_AUTH_TOKEN`, then pass its exact `libsql://` or `https://` URL with `--target`. The command never implicitly reuses the production source token for the new target.

The restore verifies the entire backup before opening its write transaction. It then checks that the target has no user schema, creates tables, restores rows and sequences, and adds indexes/views/triggers after the data. This prevents restoring rows from firing old business triggers twice. Foreign-key and SQLite integrity checks run before commit. An invalid restore rolls back. There is no overwrite, merge, reset or `--force` mode.

An unsuccessful attempt can leave an empty newly created target file. Choose another new filename or inspect and explicitly remove that unused empty recovery file yourself. The CLI never deletes or resets an existing target on your behalf.

The backup preserves the identity mode. Do not restore a local demo's fictional users into a Firebase deployment. A restored real database still needs the same Firebase project, matching private object stores and the Drive encryption key from its recovery material. The source application continues using its existing configuration until you deliberately make a cutover after checking the recovery installation. Review role changes and suspensions made after the snapshot, and reconcile reminder jobs before enabling a restored worker; restoring an older snapshot also restores its earlier permissions and delivery state.

## Perform a restore rehearsal

```bash
npm run backup -- rehearse --input data/backups/zabsync-2026-10-12.ndjson --target file:./data/rehearsal-2026-10-12.db
```

This performs the same guarded restore into a new isolated target and checks schema/data constraints. It does not launch a second public application or send reminders. The new database remains available for your read-only inspection. Never start its reminder worker against real subscriptions during a rehearsal: the snapshot includes operational delivery state and must be isolated from production side effects.

For a complete monthly rehearsal:

1. Export a fresh backup, recording its UTC timestamp, checksum and table counts.
2. Restore it to a separate database and run the SQL integrity checks.
3. Verify a known recent announcement, class membership, timetable edit and resource metadata entry. This is a freshness check, beyond merely opening the file.
4. Verify that a representative restored resource maps to an available matching private file copy. Check a photo and an uploaded lecture, and test any approved Google account handover procedure.
5. Start an isolated staging app only with appropriate test identities and side-effect delivery disabled. Confirm the correct Firebase project/identity mappings and app version before any real recovery cutover.
6. Record the outcome and approximate recovery time. Protect or explicitly remove the rehearsal database according to your retention policy.

## File and secret recovery must accompany SQL

### R2 and local application objects

Keep matching private object copies or use an explicit retention/versioning strategy appropriate to the chosen provider. The stored object key is the link between SQL and the file. Downloading a source ZIP or saving only `campus.db` does not preserve those objects. Backups stored in your R2 account consume real storage and should be included in your budget.

For local demo resources, use a stopped application when making a filesystem-level copy of the private object directory so it corresponds to the chosen SQL snapshot. For production, coordinate a write pause or snapshot/export procedure for object retention and database references; copying independently at arbitrary times is not automatically a consistent two-store backup. Do not expose backup buckets publicly.

### Personal Google Drive

SQL records preserve the mapping, file ID, original binary revision and encrypted connection state. A personal Drive file deleted by its owner cannot be reconstructed from those records. Agree a retention and representative-handover process with the uploader. Recovery still requires that Google account, valid consent and the original encryption key, or approved replacement uploads.

### Private recovery material

Retain the Drive encryption key, Firebase project/credential recovery procedure, database/R2 access recovery, GitHub access, and eventually Android signing keys in your chosen protected password/secret manager. Store the encryption key separately from database backups. Restore tests should confirm you can recover these essentials without publishing or copying secrets into project documentation.

## Suggested initial maintenance schedule

- Daily: fresh SQL export, protected retention/copy, and backup-job failure alerting.
- Weekly: review successful backup timestamps, provider storage totals, pending storage cleanup, spending and access changes.
- Monthly: isolated restore rehearsal plus sample file/identity checks.
- Before a schema upgrade or representative handover: an additional fresh backup and recovery checklist.

A possible starting retention is seven daily and four weekly database copies, adjusted to measured size and your recovery needs. Scheduling and off-machine storage require your actual hosting and account configuration. The code provides export/restore commands; it does not claim an external backup destination or scheduled production job has already been configured.
