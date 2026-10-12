# Update Checkpoint 3 to corrected version 0.3.1

This is still **Checkpoint 3 of five**. The complete ZIP replaces the earlier 0.3.0 source and build while preserving your configured accounts, classes, files and timetable records.

For an installation still on Checkpoint 1 or 2, use [UPGRADE_FROM_CHECKPOINT_2](UPGRADE_FROM_CHECKPOINT_2.md). For a fresh demo, use [START_HERE](START_HERE.md).

## Preserve your existing installation

1. Stop the old server with **Ctrl+C** and stop any other process using its database or uploads.
2. Keep a private backup of the old project and configuration.
3. Back up the local `data/` directory consistently, including database sidecars and its private files. With remote SQL/R2, retain a provider-supported database backup and the corresponding object bytes.
4. Extract the corrected ZIP into a new folder. Copy your private `.env` and preserved local `data/` into that new folder. Check any absolute storage paths deliberately.
5. Keep your existing Firebase, database and storage settings. Do not run demo setup over a real-account configuration or switch the identity mode of its database.

Do not copy the old source, `dist`, `node_modules` or package lockfile over the corrected version. Start only one application instance against the local database during the upgrade.

## Build and run the correction

From the new project folder:

```sh
npm pkg get version
npm ci
npm run db:migrate
npm run build
npm test
npm start
```

The version command must report **`0.3.1`**. Open **http://127.0.0.1:3001** for the compiled app. For ongoing source development, use `npm run dev` and port 5173 instead; offline reopening requires the compiled build.

This correction keeps schema versions **1–6**. No new SQL migration resets memberships or teaching schedules. The migration command remains safe to repeat and does not populate real installations with demo identities.

## What changes after the update

| Area                      | Corrected behavior                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student screens           | Joining and reading classes, personal profile/bookmarks/checklist; shared create/edit/publish controls require confirmed class-admin permission.                                            |
| Owner navigation          | Separate online Owner dashboard. Student Home, My classes, personal planning, Saved and Offline destinations lead the owner back to its console.                                            |
| Owner section tools       | Semester → section → People/content/timetable/deadlines. Global authority remains available inside this workspace.                                                                          |
| New owner-created classes | The owner is not enrolled automatically. Enroll registered university students and appoint their Class Admins.                                                                              |
| Existing memberships      | Preserved, including legacy owner memberships. This update does not silently delete or rewrite historical enrollments.                                                                      |
| Developer page            | Published content and private drafts are preserved. The sidebar opens a separate Meet the Developer page; the owner editor has a dedicated Developer tab.                                   |
| Weekly timetable          | Existing recurring entries and dated overrides appear together in a full Monday–Sunday view. No re-entry of the routine is needed.                                                          |
| Student offline data      | Existing eligible student/Class Admin snapshots keep their original seven-day expiry and device scope. Refresh them online for current information.                                         |
| Owner offline data        | The console is online-only. Legacy owner snapshots and their in-app file copies are removed when the new store reads them; independently downloaded files remain outside the app's control. |
| Owner identity            | A separate external owner is supported by exact verified email and pinned Firebase UID. Existing ownership is not transferred by updating source or changing `.env`.                        |

## Separate your owner and university accounts

The recommended arrangement is a verified Gmail owner account for administration and your university account for class participation. The Gmail address is a single private exception, paired with its Firebase UID. Other external accounts remain ineligible.

Follow [OWNER_ACCOUNT](OWNER_ACCOUNT.md). If a university account is already the Master Admin, the guide describes the explicit server-side transfer preview and application command. Changing `MASTER_ADMIN_EMAIL` by itself does not replace the existing owner. Existing class memberships and profile data remain available after an authorized transfer, so the former university owner can continue in its assigned class role.

The source update performs no live transfer on your behalf. Enter your actual settings privately when the Firebase account is ready.

## Refresh an installed web copy

Serve the new build at the same origin, finish any unsaved form, accept the app's update prompt, then reopen it. A service worker can keep an older installed interface until its update is activated. Starting an old terminal or opening a different port also shows a different build/storage origin.

If the previous controls remain visible, first confirm `npm pkg get version` in the running project, rebuild, stop the old process, restart the corrected one and reopen the app. Check the active demo persona or actual account role. The local demo selector is not a production permission system.

## Check the corrected flows

1. **Student:** open Home, My classes, Noticeboard and a class. Only enrolled classes appear. There is no Create class, Post announcement, shared deadline creation, upload or timetable editor. Personal profile/bookmarks/checklist actions remain available.
2. **Class Admin:** create a class directly, edit a subject/notice and the weekly routine in an assigned class. Check an ordinary membership in another class remains read-only.
3. **Owner:** open a semester and section, manage People, and open that section's timetable/deadlines. Creating another section does not add the owner to its roster.
4. **Developer:** save a private draft in the Developer tab, preview/publish it, then open Meet the Developer from the student sidebar. Unpublished content stays private.
5. **Timetable:** confirm all seven days are present. Test one dated cancellation or move without changing the recurring routine, then refresh a student's view.
6. **Offline:** prepare the university account online and reopen its timetable without a connection. Owner administration should require reconnection.

The automated results and remaining physical-device/provider checks are in [VERIFICATION](VERIFICATION.md). A source rollback should always use its matching configuration, database and private-file backup, particularly if an owner transfer or other data changes occurred after this update.
