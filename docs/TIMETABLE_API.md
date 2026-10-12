# ZabSync timetable and deadlines — Checkpoint 3

All routes require an authenticated, active account. Student accounts require the configured university email domain; the application owner's identity is separately allowlisted in deployment configuration. Approved class members read; that class's admins and the Master Admin write. The server checks current permissions, feature controls, parent subjects, and read-only maintenance inside transactions. Browser role labels do not grant access.

## Using the weekly screen

The selected section's timetable renders Monday through Sunday together. Wide layouts use seven day columns, smaller layouts use readable day panels, and empty days remain visible. Every session shows its start/end time, title, teacher, and room; missing teacher or room information is labelled “Not set.” Accent colors are visual grouping aids, not official course classifications.

Previous/next week, **This week**, and **Go to week** change the displayed date range. A moved class retains its original marker and a link to the replacement date; the replacement links back to its original date. Both use the same dated schedule returned by the API or resolved from a complete saved offline snapshot.

Class admins can add a weekly entry directly under its weekday and open **Manage weekly template & changes** to edit the repeating routine. **One-time change** creates an extra, cancelled, or moved occurrence. Editing the routine does not turn a one-time change into a repeating event. Edit and remove forms send the current source record's version, never the generated display-session ID.

Students see the complete schedule without shared editing controls. Class admins only manage their own class memberships, and offline or read-only maintenance hides their editing forms. The owner opens planning from the section directory at `/admin/classes/:classId/timetable` or `/admin/classes/:classId/deadlines`; owner planning does not depend on enrollment in a student class. Owner tools require an online session.

## Time and record conventions

- Timezone is always `Asia/Karachi`.
- Calendar dates are real `YYYY-MM-DD` dates from 1970 through 2199; impossible dates are rejected. Weekdays are Monday `1` through Sunday `7`.
- Times are `HH:mm` using a 24-hour clock. End time must be later than start time on the same date; overnight sessions require separate entries.
- `subjectId` is optional/null. When present it must identify an active subject in the same class. Plain-text `teacher`, `room`, and `notes` are editable.
- Shared records return integer `version`, initially 1. PATCH requires the last-read version plus the complete editable form. DELETE requires `?version=N`. A concurrent change returns 409 `record_changed`; refresh and deliberately retry instead of overwriting newer information.
- Delete hides the record from future reads/snapshots. Deleting a weekly entry also hides its dated overrides. Dated overrides must be removed before changing that weekly entry's weekday.

## Weekly timetable

- `GET /api/classes/:id/timetable?week=YYYY-MM-DD` → `{entries,exceptions,sessions,weekStart,weekEnd,timezone,canManage}`. The selected date is normalized to its Monday; omitting it selects the current Karachi week. Weekly entries are complete (at most 100 active entries), not a silently truncated page. Exceptions include changes whose original date or replacement date falls in that week.
- `POST /api/classes/:id/timetable` accepts `{title,subjectId?,weekday,startTime,endTime,teacher?,room?,notes?}` →201 `{entry}`.
- `PATCH /api/timetable/:id` accepts `{version,...weeklyForm}` →`{entry}`.
- `DELETE /api/timetable/:id?version=N` →`{ok:true}`.
- Entry shape: `{id,classId,subjectId,subjectName,title,weekday,startTime,endTime,teacher,room,notes,version,createdAt,updatedAt}`.

Exact duplicate weekly entries are rejected. Other overlaps are retained and clearly flagged in resolved sessions because parallel/lab schedules may be intentional. The class admin can correct conflicts without losing existing data.

## Dated changes and extra sessions

- `GET /api/classes/:id/schedule-exceptions?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100&offset=0` →`{exceptions,pagination,from,to,timezone,canManage}`. Both dates are supplied together, with an inclusive range of at most 366 days. Defaults cover 30 days before today through 180 days after today. Results include an exception whose original occurrence or replacement date lies in the range. Pages are bounded to 100 records.
- `GET /api/classes/:id/schedule-exceptions?all=true&limit=100&offset=0` returns every active dated exception through pagination, including dates outside that default window. Offline synchronization follows every page. `all=true` cannot be combined with `from` or `to`; returned `from` and `to` are null.
- `POST /api/classes/:id/schedule-exceptions` accepts one of the forms below →201 `{exception}`.
- `PATCH /api/schedule-exceptions/:id` accepts `{version,...exceptionForm}` →`{exception}`.
- `DELETE /api/schedule-exceptions/:id?version=N` →`{ok:true}`. Removing a cancellation/reschedule restores the normal weekly occurrence.

| Kind          | Fields                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extra`       | `{kind,date,title,startTime,endTime,subjectId?,teacher?,room?,notes?}`. No entryId/originalDate.                                                                                                                          |
| `cancelled`   | `{kind,entryId,originalDate,notes?}`. originalDate must match the weekly weekday. The cancelled occurrence remains visible as cancelled in its week.                                                                      |
| `rescheduled` | `{kind,entryId,originalDate,date,startTime,endTime,title?,subjectId?,teacher?,room?,notes?}`. Original date must match the weekly weekday. Omitted title/subject/teacher/room inherit from the weekly entry at save time. |

Only one active cancellation/reschedule is allowed per weekly entry and original date. A reschedule removes the normal original occurrence, shows its cancelled/moved marker, and adds the replacement on the chosen date. It never changes the recurring weekly template. Replacing one exception uses PATCH/version.

Exception shape: `{id,classId,entryId,originalDate,date,kind,subjectId,subjectName,title,startTime,endTime,teacher,room,notes,version,createdAt,updatedAt}`. Resolved sessions add `{id,entryId,exceptionId,date,source,originalDate,movedToDate,cancelled,conflict,startAt,endAt}` to their display fields. `source` is `weekly`, `extra`, `rescheduled`, or `cancelled`; timestamps are absolute ISO instants converted from Karachi local date/time. A moved original occurrence has its destination in `movedToDate`; other sessions use null. Resolved sessions are display occurrences, so their IDs are not edit/delete record IDs. Use `entryId` or `exceptionId` with the current source record's version.

## Deadlines and personal completion

- `GET /api/classes/:id/deadlines?from=YYYY-MM-DD&to=YYYY-MM-DD&kind=quiz|assignment|event&completed=true|false&limit=100&offset=0` →`{deadlines,pagination,timezone,canManage}`. Date filters are optional; omitting them includes all active past and future deadlines through pagination. When both bounds are supplied, the inclusive range must not exceed 366 days. Pages are bounded to 100 records.
- `POST /api/classes/:id/deadlines` accepts `{kind,title,description?,subjectId?,dueDate,dueTime}` →201 `{deadline}`.
- `PATCH /api/deadlines/:id` accepts `{version,...deadlineForm}` →`{deadline}`.
- `DELETE /api/deadlines/:id?version=N` →`{ok:true}`.
- `PATCH /api/deadlines/:id/completion` accepts `{completed:boolean,version?:number}` →`{deadline}`. Any approved class member can change only their own completion state; a `userId` field is rejected. Send the displayed deadline version to reject a stale completion with 409 `record_changed`. This is personal organization, not proof of assignment submission or grading.
- Deadline shape: `{id,classId,subjectId,subjectName,kind,title,description,dueDate,dueTime,dueAt,version,createdAt,updatedAt,completed,completedAt}`.

Editing a deadline's academic details resets its effective completion status for every member until each deliberately marks the new version complete. This prevents a changed deadline from silently remaining hidden as completed. A reminder/push delivery service is not part of these endpoints.

## Offline use and limits

Read snapshots contain only currently authorized, active records. A missing/deleted subject also hides its linked timetable/deadline items. Feature controls `timetable` and `deadlines` apply independently; subject-scoped records require the subjects feature. Initial sync and all edits/completion updates require internet in Checkpoint 3. Saved views are read-only offline and display their synchronization time.

Current code-level limits are 100 weekly entries, 2,000 active dated exceptions, and 2,000 active deadlines per class. For offline synchronization, read the complete recurring timetable, all `all=true` exception pages, and all deadline pages without a date filter. The browser uses the same import-free `server/schedule.ts` resolver as the server to display another saved week. The timetable, exception, and deadline lists remain independently bounded; an incomplete synchronization must not replace a complete saved snapshot.

`GET /api/offline/access` supplies the server's current class/subject/resource/announcement visibility manifest; it is an access list, not a credential or a general API-response cache. The device store separately checks the active account, successful full synchronization, expiry, and feature flags. See `SECURITY_AND_OFFLINE_PLAN.md` for the seven-day read-only window, account switching, and revocation limits. Notifications about changed schedules can be published through the existing class announcements feature.

Demo schedules/deadlines are clearly labelled fictional examples. Their dates are derived from the demo seed's current Karachi week and are not official university information. Live-provider connectivity and physical-device offline behavior need separate checks beyond the API tests.
