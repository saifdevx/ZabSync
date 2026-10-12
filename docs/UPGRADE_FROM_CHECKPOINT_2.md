# Upgrade to ZabSync Checkpoint 3

This cumulative ZIP can upgrade either Checkpoint 2 or Checkpoint 1. The schema migrates forward through versions 1–6. No existing installation was modified while preparing this deliverable.

## Preserve the old installation first

1. Stop the old server so no writes or uploads are in flight.
2. Keep the whole old project folder as a private backup.
3. Back up its database consistently. For local SQLite, stop all processes and copy the entire `data/` folder, including any database sidecar files and storage directory. For remote libSQL/Turso, use a provider-supported database export/backup.
4. Back up the private uploaded object store separately; SQL contains metadata and keys rather than lecture/photo bytes. R2 bucket/versioning or an appropriate object backup must preserve the corresponding object keys.
5. Record the current database URL, storage driver/path and deployment version privately.

Do not point an older app binary at a database after the CP3 role migration. Rollback uses the old source **and its matching pre-upgrade database/object backup**. Taking a source-only backup is not sufficient.

## Local upgrade

1. Extract `zabsync-checkpoint-3` into a new folder.
2. Copy only your private `.env` and your preserved `data/` folder from the old installation into the new project, while both servers are stopped. If storage paths are absolute, verify the intended directory and keep its backup.
3. For remote SQL/R2, retain the same private credentials and connection/object settings. Do not switch providers as part of this routine source upgrade.
4. In your copied `.env`, set:

```dotenv
APP_NAME=ZabSync
```

Keep the existing `AUTH_MODE`, database, storage, Firebase configuration and owner identity. Updating the name does not transfer ownership. Do not replace a configured real-account `.env` with the example or demo settings.

5. Open a terminal in the new project and run:

```sh
npm ci
npm run db:migrate
npm run build
npm test
```

6. Start the new app with `npm start` and open `http://127.0.0.1:3001`, or use `npm run dev` on port 5173 for source development.
7. Confirm existing accounts, class IDs, memberships, resources/downloads, notices, profiles, invitations and saved items before using the new features. In the owner directory, inspect at least one populated class.

Do not copy the old `node_modules`, `dist`, source files or lockfile over this version. Do not run two demo servers against the same local database. For a fresh demo without retained data, follow START_HERE instead.

## What changes in the data

| Data                     | Upgrade behavior                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Membership roles         | Existing `cr` and `gr` become the single `admin` value; existing students remain students                                                   |
| Global owner             | Existing Master Admin identity/role remains; class admin does not confer global ownership                                                   |
| Multiple admins          | Both former representatives remain admins; the owner may assign more than one                                                               |
| Accounts and IDs         | Existing IDs, emails, usernames and avatar references remain                                                                                |
| Classes/subjects/content | Existing IDs, metadata, files, notices, bookmarks, invitations and audit history remain                                                     |
| Class-creation requests  | Historical rows remain for preservation; new request/decision endpoints return the retired-workflow response and the UI does not offer them |
| Tutor content            | The old table remains private and unchanged; the new Developer profile starts blank/unpublished                                             |
| Timetable/deadlines      | New versioned tables are added; real databases get no fictional teaching schedule                                                           |
| Demo examples            | Demo-only planning seeds once; subsequent starts do not move existing sample dates                                                          |
| Feature switches         | Existing supported flags remain; Developer, timetable and deadlines gain their own switches                                                 |

The old migrations are retained unchanged, followed by the new migrations. Automated upgrade tests start with frozen CP1 and CP2 schemas to check preservation.

## Update installed web copies

Keep the same deployment origin and manifest ID when updating an existing hosted installation. The new worker understands the prior explicit update message as well as ZabSync's current one. Accept the update prompt after finishing any edits, then reopen.

Old icon URLs are retained as compatibility aliases; active metadata uses the ZabSync name and the same supplied university image. An operating system may retain its prior home-screen label/icon until it updates its installation metadata; removing/re-adding a shortcut is a device-level option if needed.

CP2 did not contain private offline snapshots. CP3 requires explicit preparation in **Offline access** for Student and Class Admin accounts. The owner console requires a connection and does not offer academic offline preparation. A changed browser session key may require signing in/selecting the demo account again. It does not delete the SQL account or class data. Browser data is scoped to its origin: ports 5173 and 3001 have separate local storage.

## Hosted update

Back up persistent SQL and private files before deploying. Use the build/start commands in [GITHUB_AND_DEPLOYMENT](GITHUB_AND_DEPLOYMENT.md), keep Firebase mode and the same persistent stores, and allow the additive migration before traffic. For multiple instances, coordinate schema migration as a controlled job. The included single-process pilot is not a rolling-deployment orchestration system.

Check: owner semester directory; student no-create behavior; Class Admin timetable edit; approved file download; Developer private/public visibility; new install update; offline preparation and logout cleanup. A failed rollout should use the matching backup procedure, not hand-editing migrations to conceal it.
