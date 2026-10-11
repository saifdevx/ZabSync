# XVIA security and offline behavior — Checkpoint 2

XVIA is the short application name; **Node Compass Task** is the full product name. This document separates protections implemented in the current ZIP from the offline and operational work still planned.

## Identity, university eligibility, and class permissions

The application checks three things:

1. In real mode, Firebase verifies the sign-in identity and the backend verifies its token, including revocation checks.
2. The backend requires a verified email in the exact **`szabist-isb.pk`** domain.
3. SQL supplies the current account status, class membership, and representative role for the requested operation.

The browser cannot grant itself a role. A Class ID identifies a class; a join code requests admission and does not grant membership or administrative powers by itself. Codes expire, can be rotated, and are stored as hashes. Representatives review membership requests; only the owner approves new classes and changes representatives. Existing sessions use the updated role on their next request.

The domain is shared by students and staff. Email verification establishes mailbox ownership, not current student enrollment. Representatives should approve known classmates. An official student roster or student-only university identity integration remains an option for stronger eligibility checks.

For subjects, files, notices, bookmarks, and notifications, access depends on current class membership. Knowing a UUID or having bookmarked an item does not preserve access after removal. A deleted subject hides its child content. The server checks these rules on reads and again inside write transactions, including after a file finishes uploading. Student rosters omit classmates' email addresses.

### Firebase records versus application access

The backend rejects unsupported or unverified emails before protected application access. Someone bypassing browser validation may still create a Firebase Authentication record in a basic Firebase setup. That record does not grant class data or administration rights.

Provider-level registration/sign-in blocking requires separately configured Authentication blocking functions and an Identity Platform upgrade. This ZIP does not automatically install them. See [Firebase blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions).

### Passwords and secrets

Create a separate password for XVIA. **Never enter your university mailbox password in the XVIA registration form.** Verification mail arrives in the university mailbox and confirms ownership.

The Firebase web configuration, including its API key, identifies the Firebase project and appears in client code. It is not an administrative credential. Apply appropriate restrictions and rely on authentication and authorization, as described in [Firebase's API-key guidance](https://firebase.google.com/docs/projects/api-keys).

Firebase service-account credentials, Turso tokens, R2 credentials, and any future OpenAI API key are server secrets. Keep them outside source control, public folders, shared ZIPs, screenshots, and chat. A `VITE_` variable is exposed to client code and must not contain a server secret. See [Vite environment variables](https://vite.dev/guide/env-and-mode).

The real Master Admin email must be set explicitly in private configuration. The sample student email and the first person to register are not assigned ownership automatically.

## Profiles and the Tutor page

A student may edit a display name and an optional unique username. A username is a visible handle; it does not change the verified email, immutable user ID, roll number, or permissions. Reserved administrator/official handles are rejected.

Profile photos accept one JPEG, PNG, or WebP image up to **2 MiB** and **16 megapixels**. The server decodes it, rejects animated/multipage files, applies orientation, resizes within 512×512, and writes a fresh WebP without original metadata. It does not serve the original upload as a profile photo.

Photo reads require the photo owner, a current member sharing an active class, or the Master Admin. Responses are private and uncached. Temporary browser object URLs are cleaned up when the account or component changes. Replacement/removal records old photo keys in a durable cleanup queue, with retries on startup and subsequent changes.

Only the owner edits or publishes the Tutor profile. It starts as an unpublished, empty draft. Descriptions are plain text; contact/booking URLs must use HTTPS and cannot contain embedded credentials. The backend does not fetch those links. No tutor identity, qualification, price, or contact information is invented.

## Private lecture files

Representatives and the owner can upload PDF, PPT, and PPTX files. Files use opaque server-generated storage keys; user filenames never become storage paths. Downloads pass through an authenticated API and are sent as attachments with `no-store`, `nosniff`, and restrictive document headers. No public upload or R2 object URL is exposed.

| Current limit            | Enforcement                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| Lecture file             | 25 MiB per file, streamed to bounded temporary disk storage.       |
| Class storage            | 100 MiB, counting active, trashed, and pending-deletion resources. |
| Announcement attachments | Up to five existing files from the same audience.                  |
| Subjects                 | Up to 100 active subjects in a class.                              |

These are code-level defaults, not owner-dashboard quota controls. Changing a limit requires a reviewed code change that keeps API constants, multipart configuration, client validation, and messages consistent, followed by a build and verification. Runtime quota controls are planned with the later maintenance work.

The server checks extensions and document structure: a PDF signature/end marker, a legacy PPT compound-file signature, or a bounded PPTX ZIP package with actual PowerPoint metadata. PPTX inspection does not extract files and rejects unsupported macros, embedded executables, traversal paths, and unsafe XML metadata.

**File validation is not malware scanning.** Legacy PPT content is not deeply inspected for macros; an accepted PDF or presentation may still contain unwanted content. Only trusted representatives should publish course material. Antivirus/content scanning is a separate production control, not a capability claimed by this ZIP.

### Trash, restore, and storage accounting

Trashing a file hides it from students and keeps the bytes for restoration. It does not free the class's storage allowance. A representative or owner must choose the separate permanent-removal action to reclaim space. If the parent subject is also trashed, restore that subject before managing its individual files.

Deleting a subject hides active child files/notices without individually deleting them. Restoring the subject makes those active children available again. Independently trashed files/notices stay trashed.

### Local storage and R2

Local mode stores files outside the client build and public directories. Production local-file hosting needs a persistent disk and backups. A free/ephemeral server filesystem is not durable lecture storage. R2 is available through the private S3-compatible adapter; keep bucket public access disabled. Credentials remain server-only.

The live R2 connection has not been tested in this checkpoint. Local storage and injected failure cases have been tested. File delivery currently passes through the API server, so host bandwidth and request capacity still matter with R2. See the [Cloudflare R2 SDK v3 guide](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

SQL and object storage do not share a transaction. Upload completion rechecks permissions and quota inside SQL; rejected completion attempts to remove its private object. Failed compensation logs the random storage key for operator reconciliation. A crash between upload and SQL registration can leave an unreferenced private object. Reconcile objects against database records during backup/maintenance before removing suspected orphans; automatic resource-orphan reconciliation remains future work.

Permanent deletion stores a durable `deleting` state before removing the object. Failed deletion remains hidden and retryable; it cannot be restored as if the bytes were certainly present. Full database-and-storage outages can also require manual reconciliation of profile-photo objects, despite their cleanup queue.

## Master controls, suspension, and maintenance

The owner dashboard controls implemented subjects, resources, announcements, Tutor, and profile-photo modules. Flags are enforced by the backend as well as navigation. Turning a feature off preserves data:

- Turning subjects off hides subject-scoped files/notices throughout feeds, bookmarks, attachments, and notifications. Class-level files and class/global notices follow their own switches.
- Turning resources off hides downloads/attachments while retaining notice text and attachment links. Text edits can preserve those hidden links.
- Turning announcements off also disables the in-app announcement notification center.
- A user can remove an existing photo while new photos and photo viewing are disabled, unless maintenance pauses changes.

Settings and Tutor edits include version checks: stale edits return conflicts instead of silently overwriting newer changes. The owner can suspend/reactivate accounts; an existing session is blocked on its next protected request. The owner account is protected from accidental self-suspension. Reactivation retains memberships/roles, so review representative assignments when restoring an account.

Maintenance is **read-only mode**: students/representatives can read existing content, sign in, and recover accounts while application changes are paused. The owner retains recovery controls. Maintenance does not stop hosting, replace deployment procedures, or erase already downloaded data.

The dashboard controls existing software and stored content. Adding software requires a code change, review, build, and deployment through the GitHub workflow. It does not execute arbitrary code entered into a dashboard field.

## Request limits and campus Wi-Fi

Authenticated limits use the verified application user ID, giving classmates behind the same campus IP independent account quotas. A refreshed Firebase token, changed IP, or forged identity header does not reset an account's quota. Authentication is reused only within one request; the next request rechecks the account.

Ordinary authenticated APIs allow 300 requests per minute per user unless an endpoint has a tighter limit. Public APIs use a separate 600-per-minute peer-IP allowance; demo login has its own smaller limit. Failed/missing identities are grouped by observed peer IP. A broad 6,000-request-per-minute network guard runs before parsing and identity-provider work. Static assets and preflight requests do not consume the ordinary API quota.

Counters are in memory in one server process. Restarts reset them; multiple instances have independent counters. Scaling to multiple instances requires shared limits or a configured gateway. The server does not trust arbitrary forwarded headers. Verify trusted-proxy policy and tune the broad guard against actual campus traffic during deployment. See `docs/OPERATIONS_API.md` for details.

## Local demo and verification boundary

Demo personas are development identities, not verified university accounts. Demo mode is restricted to a loopback server, origins and peers, and local storage/SQL. Do not expose it through a public host, tunnel, or shared network. Production refuses demo authentication. Keep demo and real databases separate; do not promote seeded identities into a live student database.

Automated tests exercise the actual API, SQL permissions, uploads, relevant storage failures, owner controls, migration, worker rules, and rendered React workflows. Fixtures do not contact university mailboxes or live cloud providers. Tests do not prove live Firebase/Turso/R2 connectivity, email delivery, browser layout, phone installation, or Android behavior. Completed and outstanding checks are recorded in `docs/VERIFICATION.md`.

## PWA now; required academic offline access in Checkpoint 3

Checkpoint 2 includes the manifest, supplied app icon, installation guidance, supported-browser install prompt, and a production service worker. Students can use a deployed HTTPS website and add it to a home screen. Web installation does not require an App Store release or create an APK. See `docs/INSTALL_AND_ANDROID.md` for device-specific steps.

The current worker caches only `/offline.html` and the public app icon. After an initial successful visit to the production build, failed navigation can show a public reconnect page. It does **not** cache the authenticated app shell, class data, APIs, photos, lectures, Firebase responses, or requests carrying Authorization headers. It does not queue edits. Worker updates wait for the student's explicit update action to avoid automatic reloads during editing.

The limited cache is deliberate: private academic caching needs account partitioning, deletion/suspension behavior, storage controls, and synchronization. Adding a home-screen icon does not make timetable or saved-file access work offline. Academic offline access remains a **required Checkpoint 3 feature**, including reopening after the app was fully closed.

### First sync and later offline use

Initial sign-in and synchronization require internet. The Checkpoint 3 app must subsequently open saved content without waiting indefinitely for a network response.

| Feature                                      | Required later offline behavior                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| Weekly timetable                             | Show the last synchronized weekly pattern and saved dated exceptions.         |
| Quizzes and assignments                      | Show synchronized deadlines and details.                                      |
| Announcements                                | Read notices synchronized to that account/device.                             |
| Explicitly saved files                       | Open after their offline download has completed.                              |
| Bookmarks                                    | Show saved references; a file not downloaded still needs internet.            |
| Front-page generator                         | Generate locally after template/assets are saved, when added in Checkpoint 4. |
| First login and recovery                     | Require internet.                                                             |
| New notices, membership changes, and editing | Require a server connection.                                                  |
| University portal and AI                     | Require internet.                                                             |

Cached academic information must show **Offline — last updated [date/time]**. An offline device cannot know about a newly cancelled class or changed deadline.

Shared academic data will initially be read-only offline. Reconnection must refresh membership, fetch changes, apply deletions, and update the last-successful-sync time. Failed refreshes must preserve the last saved view and identify it as stale. File downloads need completed/failed states and retry controls.

### Saved-data privacy and reminder limits

Partition app-managed stores by account/class and clear private data on logout/account switching. Recheck permissions online. Do not indiscriminately cache authenticated responses or mistake an expired signed URL for a saved document. Distinguish app-managed offline copies from files in the device's Downloads folder.

Suspension prevents future authorized server access. It cannot immediately erase an offline device or recall files saved elsewhere. Browser storage can be cleared/evicted, so provide usage, removal, and redownload controls. See [browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

An offline deadline list does not need a push connection. New push requires connectivity, and permission does not guarantee delivery. Do not promise exact-time alerts from a closed, offline web browser. At the Android stage, local notifications may use synchronized deadlines, then update/cancel after changes arrive. See [Firebase message lifespan and delivery](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan).

### Required Checkpoint 3 acceptance checks

1. Sign in online and synchronize a class timetable, dated exceptions, deadlines, and notices.
2. Explicitly save a PDF and confirm completion.
3. Fully close the app, disconnect the network, and reopen it.
4. Read the saved timetable/deadlines and open the PDF.
5. Confirm visible offline status and last-update time.
6. Change/cancel a class on another device; the offline device must show its clearly marked saved version.
7. Reconnect and verify changes, deletions, and membership refresh.
8. Log out/switch accounts and verify that the next account cannot read the previous account's app-managed data.
9. Exercise failed downloads, storage eviction, and interrupted sync without claiming incomplete content is saved.

These are future requirements, not Checkpoint 2 results. The Android project, signed APK/direct download, AAB, and Play preparation remain Checkpoint 5; no current APK is claimed.
