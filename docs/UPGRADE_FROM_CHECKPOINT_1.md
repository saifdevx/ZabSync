# Upgrade from Checkpoint 1

> Historical CP1 → CP2 guide, retained for reference. To upgrade either previous checkpoint to the code in this ZIP, use [UPGRADE_FROM_CHECKPOINT_2.md](UPGRADE_FROM_CHECKPOINT_2.md), which covers the cumulative CP3 migrations and the ZabSync rename.

Checkpoint 2 is a complete replacement code package with additive database migrations. Existing accounts, class IDs, invitations, membership and representatives are preserved. A regression test uses the frozen original schema to verify this path and repeatable migration.

## If you only want to try the new demo

Extract this ZIP into a **new folder**, then follow `START_HERE.md`. No earlier project or account is required. Keep the earlier folder if you want to revisit it.

## Keep your local Checkpoint 1 data

1. Stop Checkpoint 1 with **Ctrl+C** in every terminal running it. Stop before copying its SQLite files.
2. Make a backup copy of the entire old `data/` folder and its `.env` configuration somewhere private. Keep the old source folder too.
3. Extract Checkpoint 2 into a new folder such as `xvia-checkpoint-2`.
4. Copy **only** the old `.env` and `data/` folder into that new project. Include any SQLite companion files in `data/`. Do not copy the old `node_modules/`, `dist/`, or source over the new code.
5. Open the copied `.env` in a text editor and set `APP_NAME=XVIA`. Preserve your authentication mode, database URL/token, owner email and other credentials. If `DATABASE_URL` points to an absolute old path, change it to the intended copied database; the default relative path `file:./data/campus.db` already follows the new project folder.
6. For the local demo, add these settings if they are absent:

```dotenv
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./data/storage
UPLOAD_TEMP_DIR=./data/tmp
```

7. Open a terminal in the new folder and run:

```sh
npm ci
npm run db:migrate
npm run dev
```

8. Open `http://127.0.0.1:5173`. Sign in again. The local demo token key changed with the new app name, so selecting your persona again is normal.
9. Verify your class name, role, and members. New subjects/notices are demo examples only in demo mode. Any new lecture files or photos you upload will be stored in the selected private storage directory.

Startup also applies migrations automatically. The explicit migration command above lets you see errors before starting the interface. It never resets the database or seeds demo data on its own.

## Real Firebase/Turso databases

Preserve real authentication mode and use a provider backup/export before upgrading. Do not switch a demo database to Firebase; those identity spaces must remain separate. Stop old application instances before a maintenance deployment that changes the schema. Confirm backups and the new instance before resuming normal edits.

Configure private R2 storage for an ephemeral cloud host. Copying only a SQLite file cannot back up R2 object bytes; database and object storage need coordinated backups. Detailed backup automation is a later checkpoint.

## If the upgrade fails

Keep the failed database and error message for diagnosis. Do not delete data or repeatedly change authentication modes. To return to the original checkpoint, stop the new process and restore the **old source and its corresponding pre-upgrade database backup** together. Running older code against a changed live database is not the rollback procedure.

The migrations add subjects/resources/announcements, profile customization, settings and tutor tables. They do not create or overwrite real university accounts or appoint a new owner.
