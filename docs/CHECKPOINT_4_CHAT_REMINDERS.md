# Checkpoint 4 — subject conversation and personal reminders

This document describes the implemented source, its operating switches, and the boundaries still requiring real-provider/device verification. It does not claim an FCM account or hosted scheduler has been configured.

## Subject conversation

Each subject owns one text conversation. “All subject members” means approved members of that subject in their pinned section; it never means publicly accessible on the internet. Class Admins and the owner may choose **Class admins only** (the default) or **All subject members**. Students cannot change this setting. Removing enrollment, changing the pinned section, suspending an account, archiving its section, deleting the subject, disabling chat/subjects, and maintenance are checked by the API, including inside each write transaction.

The conversation supports text up to 2,000 characters, a reference to one currently available resource in the same subject, cursor pagination, editing/removing one's own messages, admin removal, message reports, report review, and subject-specific posting pauses of one hour, one day, or one week. Muted students may read and report; they may also remove their own messages. Admin messages cannot be rewritten by someone else. Class admins cannot mute other admins; the owner controls representative appointments.

Chat text and moderation records belong in **Turso/SQL**, where membership checks and message transactions can run consistently. R2 remains appropriate for profile image bytes and other small binary objects. The first chat implementation deliberately has no separate chat attachment upload path: questions reference the subject resources supplied through the existing authorized resource feature.

Limits are explicit: 12 mutations per user per UTC minute and 500 per UTC day, stored in SQL; 10,000 stored message records per subject; and 100,000 across the application. Deletion blanks message text and retains a removal marker, so deleted records still count. Reaching capacity stops new posts with a clear error. Review retention before raising limits; do not delete students, classes, or resources to free chat capacity. Important academic material should remain a resource or announcement, rather than depending on chat history.

The panel fetches at most 40 messages at once and checks every 30 seconds while visible and online. It stops on navigation/unmount and does not cache private chat for offline reading. Earlier pages load on demand. Edits/deletions in older loaded pages are refreshed when that page is reloaded. This is intentionally polling; no live typing, presence, delivery receipts, or instant delivery promise is made.

### API and source contracts

- Migration 9: `server/chat-migration.ts`, exported `chatMigration`.
- Registration: `registerChatRoutes(app, context)` from `server/chat.ts`.
- Client: `ChatPanel({ subjectId })` from `client/src/ChatPanel.tsx`.
- Styles: `client/src/chat-reminders.css`, imported by the main client entry point.
- Access dependency: `subjectAccess(db, actor, subjectId, manage?)` from `server/academic.ts`.
- `GET /api/subjects/:id/chat?before=&limit=` returns chronological page items, the earlier-page cursor, and current posting permissions/settings.
- `PATCH /api/subjects/:id/chat/settings` takes `{ mode, version }`; modes are `members` and `admins`.
- `POST /api/subjects/:id/chat/messages` requires `{ body, clientKey, resourceId? }`. `clientKey` is a UUID retained across a retry. Identical retries return the original result; reusing the key for different content conflicts.
- `PATCH` / `DELETE /api/subjects/:id/chat/messages/:messageId` require the current version. Only the author edits. Author or admin may remove.
- Reports: `POST .../:messageId/report`, `GET .../chat/reports`, and `POST .../:messageId/resolve-reports`.
- Posting pauses: `POST .../chat/mutes/:userId` takes `{ minutes: 0 | 60 | 1440 | 10080, reason? }`; zero removes the pause.

Author display names are plain text. React renders message content as text, not HTML. Resource IDs from another subject are rejected. Moderation actions are recorded without copying message bodies into the audit log. SQL parameters are used for request data.

## Personal deadline reminders

A student opts in on a specific upcoming deadline, choosing the due time or 15 minutes, one hour, or one day before it. This does not edit the shared deadline. A person can have up to 200 enabled reminders. Use the university student account for this feature; the owner account remains a management identity.

The scheduled worker builds jobs from the current deadline version and preference. The combination of person, deadline, version, and offset is unique. Delivery checks the live preference, active account, pinned section/membership, subject enrollment if applicable, feature settings, deleted state, deadline version, and personal completion state. Old revisions, removed access, completed work, and opt-outs are not delivered. A deadline revision creates a new job at the revised time. Re-enabling a cancelled matching preference may revive a not-yet-delivered job, but never duplicates an already delivered inbox record.

Jobs survive application restarts in SQL. Workers acquire expiring leases and retry recoverable failures with bounded backoff. Five unsuccessful attempts end in a failed state for operational review. A missed lease is recoverable; a stale worker cannot commit over a replacement lease. Maintenance pauses delivery and does not spend retries. More than 15 minutes after the due time, a missed job is cancelled instead of sending an out-of-date alert. An enabled reminder whose chosen time has already passed is delivered on the next worker check while still within the valid due-time window.

The **in-app inbox is the reliable application record**. Creating its record and marking its job delivered happen in one SQL transaction. Device push is an optional additional channel. Push delivery has its own durable outbox; a provider timeout cannot cause another inbox entry. SQL and an external provider cannot form one atomic transaction, so a timeout after the provider accepted a send can yield a repeated device alert. The service worker uses a stable notification tag/identifier to reduce duplicate visible alerts; exactly-once device delivery is not promised.

No task title, email, classroom name, or private document information is included in device payloads. The device displays a general ZabSync reminder and opens `/reminders`, where normal login and current permissions protect the details. A completed, changed, disabled, or no-longer-authorized reminder disappears from the active inbox query.

### Operating the worker

The app's controlled in-process runner can deliver in-app reminders while the paid web service is running. Tests do not start that background loop. Alternatively run:

```bash
node --import tsx server/reminder-runner.ts --once
node --import tsx server/reminder-runner.ts --watch
```

For compiled deployments:

```bash
node dist/server/reminder-runner.js --once
node dist/server/reminder-runner.js --watch
```

Use `--once` in a scheduled service, generally every minute. `--watch` is a persistent worker with one non-overlapping cycle per minute. One process may serve both website and worker for the pilot. Separate workers share SQL leases, but there is no reason to duplicate them without capacity evidence. Free hosting that sleeps cannot provide dependable minute-by-minute scheduling. A larger reminder backlog can take multiple batches; monitor pending age before making a timing commitment.

Monitor the counts and oldest eligible `next_attempt_at` in `reminder_jobs` and `reminder_push_deliveries`, their failed rows, the worker's structured counts, and the database's read/write budget. Error logs contain sanitized error codes rather than provider response text, personal message bodies, or credentials. Failed rows are preserved for review; do not blindly reset all delivery history.

### Optional Firebase device push

Push is off unless `REMINDERS_PUSH_ENABLED=true` is configured. It also requires:

- The actual Firebase-mode public project configuration.
- Its server-side Firebase Admin credentials (or correctly scoped application-default credentials).
- `FIREBASE_MESSAGING_SENDER_ID` — the public project sender number.
- `FIREBASE_WEB_PUSH_VAPID_KEY` — the public Web Push certificate key for that project.
- Enabled FCM APIs, a working HTTPS service worker, a compatible browser, and user-granted notification permission.

The user explicitly chooses **Enable on this device**; opening the app or signing in never automatically requests notification permission. At most five active devices may be registered per account. Removing a registration cancels its pending deliveries. Explicit logout removes this browser's registration and attempts to unsubscribe it, without removing another phone belonging to the same user. A device re-bound to a different account does not retain pending deliveries for its earlier account. Provider errors for unregistered/invalid destinations disable that device. No live sends occur in the test suite.

The installed Firebase 13 and Admin 14 SDKs expose Firebase Installation ID registration. This implementation uses `register()` / `onRegistered()` and server `send({ fid })`, rather than mixing current FID registration with the deprecated registration-token API. The generic database destination stores this FID privately and exposes only registration ID, label, and last update time through the account device list.

Service-worker contract: parse only a UUID-shaped `data.zabsyncReminderId`, ignore arbitrary URLs, show a generic notification with a stable tag, and open the application-owned `/reminders` route. Firebase CSP connections need `firebaseinstallations.googleapis.com`, `fcmregistrations.googleapis.com`, and `fcm.googleapis.com`. No external scripts need to be allowed; the SDK is bundled locally.

### Reminder API and source contracts

- Migration 10: `server/reminder-migration.ts`, exported `reminderMigration`.
- Routes: `registerReminderRoutes(app, context, options)` from `server/reminders.ts`.
- Configuration: `loadReminderOptions(env, config)`; push false by default and misconfiguration rejected.
- Runtime: `runReminderCycle(db, { now?, pushSender?, batchSize? })`; the `PushSender` seam is for internal injection/tests, not request input.
- Persistent loop: `startReminderRunner(...)` returns an async stop function. Stop it before closing its database; close any owned Firebase sender afterward.
- Optional provider: `createFirebasePushSender(config)` returns `{ send, close }`.
- Client: `ReminderPage`, `DeadlineReminderButton({ deadlineId })` from `ReminderPanel.tsx`.
- Personal preference: `GET` / `POST /api/deadlines/:id/reminder`.
- Inbox: `GET /api/reminders?before=&limit=`, `PATCH /api/reminders/:id/read`.
- Provider capability: authenticated `GET /api/reminders/config` returns public setup fields only.
- Device list/add: `GET` / `POST /api/reminders/push-subscriptions`; add takes `{ installationId, deviceLabel? }`.
- Device removal: `DELETE /api/reminders/push-subscriptions/:id`, scoped to the signed-in user.

### Verification boundary

The dedicated integration tests exercise real Fastify routes and isolated SQLite databases, with demo identities and a mock FCM sender only. They cover member/subject boundaries, non-self-grantable chat modes, retry keys, stale versions, redaction, references, cursor ties, SQL rate windows, reports/mutes, maintenance, opt-in scheduling, changed deadlines, completion/deletion/revocation, expired leases, inbox idempotency, transient provider retry, invalid-device suppression, and explicit provider setup.

Real Firebase consent, FID registration and push delivery on real Android/iPhone devices remain release checks. A phone that is offline or disallows notifications cannot be promised an exact-time alert. Do not present local mock-provider tests as proof of live push delivery.

Official references checked 12 October 2026:

- https://firebase.google.com/docs/cloud-messaging/web/get-started
- https://firebase.google.com/docs/cloud-messaging/web/receive-messages
- https://firebase.google.com/docs/cloud-messaging/send/admin-sdk
