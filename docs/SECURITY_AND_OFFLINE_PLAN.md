# ZabSync security and offline behavior — Checkpoint 3

This document records the protections and limits implemented in the current cumulative release. It also identifies work that still requires configured live services, real devices, production operations, or later checkpoints. Security depends on server permissions and deployment configuration as well as the interface.

## Identity, university eligibility, and class permissions

Protected access checks three independent facts:

1. In real mode, Firebase supplies the sign-in identity and the backend verifies its token, including revocation checks.
2. Ordinary accounts require a verified email on the exact **`szabist-isb.pk`** domain. One external owner is allowed only when both its exact verified email and pinned Firebase UID match private server settings.
3. SQL supplies the current account status, class membership, and role for the requested operation.

The runtime roles are Student, Class Admin, and Master Admin. Student and Master are global account roles; admin is a separate class membership role. A class admin may manage one class while remaining an ordinary student in another. Multiple admins may serve the same class. Only the owner assigns or removes class admin roles; a profile name, browser role label, forged header, or known UUID cannot grant authority.

The owner creates the first class and can add a registered account and appoint its admin. An existing active class admin can create another class directly; ordinary students cannot. The former class approval queue is retired. Old CR/GR memberships become admin memberships during migration, retaining their IDs, statuses, timestamps, and history. Historical class requests are retained without granting new powers. See [ROLE_ADMIN_API.md](ROLE_ADMIN_API.md).

A Class ID identifies a class. A separate expiring join code requests admission; it does not grant content access or admin status by itself. Codes can be rotated and are stored as hashes. That class's admins or the owner review join requests. Approval creates an ordinary active membership.

The domain is shared by students and staff. Verification establishes mailbox ownership, not current student enrollment. Class admins should admit known classmates. An official student directory or student-only university identity integration would provide a separate eligibility check.

Subjects, files, announcements, bookmarks, notifications, timetables, and deadlines use current class access. Knowing a UUID or having bookmarked an item does not preserve access after removal. Parent deletion hides linked content. Reads enforce these rules, and writes recheck them inside transactions, including after an upload finishes. Existing bearer sessions follow the updated SQL role or account status on their next protected request.

Ordinary student directories omit classmates' email addresses and roll numbers. Class admins and the owner receive these fields for authorized class administration. App-managed offline snapshots omit rosters, invitations, pending requests, and owner directories entirely.

### Firebase records and application access

The backend rejects unsupported or unverified emails before protected application access. Someone bypassing browser validation may still create a Firebase Authentication record in a basic provider setup. That record does not grant class data or administration rights. If provider-level registration blocking is required, configure it separately in Firebase; this ZIP does not install blocking functions. See [Firebase blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions).

Create a separate application password. **Never enter a university mailbox password in ZabSync's registration form.** Verification mail arrives at the university mailbox to confirm ownership.

The Firebase web configuration identifies the Firebase project and appears in client code; it is not an administrative credential. Apply the appropriate project restrictions and rely on authentication and authorization. See [Firebase API-key guidance](https://firebase.google.com/docs/projects/api-keys).

Firebase service-account credentials, Turso tokens, R2 credentials, and any future AI API key are server secrets. Keep them outside source control, public folders, source ZIPs, screenshots, and chat. A `VITE_` variable is exposed to client code and must not contain a server secret. See [Vite environment variables](https://vite.dev/guide/env-and-mode).

The real Master Admin email must be set explicitly in private configuration. An external owner also requires its exact Firebase UID; pinning the UID is recommended for a university owner too. Changing these values does not replace an existing owner. See [OWNER_ACCOUNT.md](OWNER_ACCOUNT.md) for fresh setup and the explicit transfer procedure. The sample student email and the first person to register do not receive ownership automatically. The campus website and ZABDESK shortcuts redirect to the university; the application never collects portal passwords.

## Profiles and Developer information

A student may edit a display name and optional unique username. The handle does not change verified email, immutable user ID, or permissions. Reserved administrator and official handles are rejected.

Profile photos accept one JPEG, PNG, or WebP image up to **2 MiB** and **16 megapixels**. The server decodes the image, rejects animated or multipage files, applies orientation, resizes within 512×512, and writes a fresh WebP without original metadata. It does not serve the original upload as a profile photo.

Photo access requires the owner of that photo, an active member sharing an active class, or the Master Admin. Responses are private and uncached. Temporary browser object URLs are cleaned up when the account or component changes. Replacement and removal record old photo keys in a durable cleanup queue, retried on startup and subsequent changes. Profile photos are not saved for offline viewing.

Developer information replaces the former Tutor feature. Only the owner edits its private draft or publishes the name, biography, portfolio, updates, and other app links through **Master Admin → Developer**. Students open the separate **Meet the Developer** page (`/developer`) from the sidebar or Get the App to read the published information. Descriptions are plain text; external links require HTTPS and exclude embedded credentials. The backend does not fetch those links. Legacy Tutor records remain in the upgraded database but have no active publishing route. No developer identity, credentials, or portfolio is fabricated.

## Private lecture files

Class admins and the owner publish PDF, PPT, and PPTX resources. Storage uses opaque, server-generated keys; original filenames never become server paths. Online downloads pass through an authenticated API and are sent as attachments with `no-store`, `nosniff`, and restrictive document headers. No public upload or R2 object URL is exposed.

| Current server limit     | Enforcement                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| Lecture file             | 25 MiB per file, streamed to bounded temporary disk storage.       |
| Class storage            | 100 MiB, counting active, trashed, and pending-deletion resources. |
| Announcement attachments | Up to five existing resources with the same audience.              |
| Subjects                 | Up to 100 active subjects per class.                               |
| Recurring timetable      | Up to 100 active entries per class.                                |
| Dated exceptions         | Up to 2,000 active exceptions per class.                           |
| Deadlines                | Up to 2,000 active deadlines per class.                            |

These are code-level limits, not runtime dashboard quota controls. Change the corresponding constants, multipart settings, validation, and messages together through a reviewed code change, then build and verify. Runtime budget controls remain later operational work.

Document validation checks an allowed extension and document structure: a PDF signature and end marker, a legacy PPT compound-file signature, or a bounded PPTX ZIP with actual PowerPoint metadata. PPTX inspection does not extract files and rejects unsupported macros, embedded executables, traversal paths, and unsafe XML metadata.

**File validation is not malware scanning.** Legacy PPT macros are not deeply inspected. An accepted PDF or presentation can still contain unwanted content. Only trusted class admins should publish course materials. Antivirus or content scanning is a separate production control.

### Trash, restore, and storage accounting

Trash hides a resource from ordinary members while retaining the bytes for restoration. It does not release the class allowance. An authorized admin must choose the separate permanent-removal action to reclaim space. If its subject is also deleted, restore that parent before managing an individual child resource.

Deleting a subject hides its linked active resources and announcements without separately trashing them. Restoring the subject makes those active children visible again; independently trashed children stay trashed. The same active-subject rule applies to linked timetable entries, exceptions, and deadlines.

### Local storage, R2, and interrupted operations

Local storage stays outside the client build and public directories. A production server using local files needs a persistent disk and backups; an ephemeral host filesystem is not durable lecture storage. The private S3-compatible R2 adapter is included, with public bucket access disabled and server-only credentials.

The live R2 connection has not been tested here. Local storage and injected failure cases have automated coverage. File delivery currently passes through the API server even with R2, so server bandwidth and request capacity still matter. See [Cloudflare R2's SDK guide](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

SQL and object storage do not share one atomic transaction. Upload completion rechecks permission and quota inside SQL; rejected completion attempts to remove the private object. Failed compensation logs its random storage key for operator reconciliation. A crash between upload and SQL registration can leave an unreferenced private object. Compare storage objects with database records during backup and maintenance before removing suspected orphans; automatic resource-orphan reconciliation remains future work.

Permanent removal records durable `deleting` state before deleting bytes. A failed deletion stays hidden and retryable; the resource cannot be restored as though its bytes were certainly present. Full database or storage outages can also require manual photo-object reconciliation despite the photo cleanup queue.

## Timetable and deadline integrity

Dates are real ISO calendar dates and times are `HH:mm`, interpreted in **Asia/Karachi**. End time must follow start time on the same date. Subject links must point to an active subject in the same class. Exact duplicate timetable entries and exceptions are rejected; other simultaneous sessions are retained with visible conflict flags.

A dated cancellation or reschedule refers to a specific weekly entry and its original occurrence date. At most one active override exists for that occurrence. Moving it across weeks preserves the original cancelled or moved marker and adds the replacement date without rewriting the recurring template. Deleting an override restores the normal occurrence. Deleting a weekly entry hides its overrides. An admin must remove active overrides before changing that entry's weekday.

Shared edits and deletes require the last-read record version. Conflicting changes return 409 rather than silently overwriting newer information. Deadline completion is personal to the authenticated member and is tied to the current deadline version. Changing academic details makes the new deadline version incomplete until the member marks it done again. The UI supplies that version when marking completion to reject a stale action.

These controls are personal organization, not assignment submission, grading, or guaranteed reminder delivery. All writes, including personal completion, require a connection. See [TIMETABLE_API.md](TIMETABLE_API.md).

## Owner switches, suspension, and maintenance

The dashboard controls subjects, resources, announcements, Developer information, profile photos, timetable, and deadlines. The backend enforces these switches. Disabling a module retains its stored records:

- Disabling subjects hides subject-scoped files, announcements, attachments, notifications, timetables, and deadlines. Unscoped class content follows its own feature switch.
- Disabling resources hides downloads and attachments while retaining notice text and attachment links; text edits can preserve the hidden links.
- Disabling announcements also disables the in-app notice center.
- Timetable and deadlines have separate switches. Either can remain enabled when the other is disabled.
- Existing profile photos can be removed when new photos and viewing are disabled, unless maintenance also pauses changes.

Settings and Developer publication use optimistic versions. Suspension blocks the account on its next protected request; the owner account is protected from accidental self-suspension. Reactivation retains current membership state, so review old admin assignments deliberately. Removing or re-adding a membership does not silently restore a removed admin role.

Maintenance is **read-only mode**. Students and class admins can read existing content, sign in, and recover accounts while non-owner mutations are paused. Owner recovery remains available. The dashboard does not execute arbitrary code, stop hosting, or replace deployment procedures. New features require a code change, build, and deployment.

## Request limits and campus Wi-Fi

Authenticated request limits use the verified application user ID, giving classmates on a shared campus IP independent account quotas. A refreshed identity token, changed IP, or forged identity header does not reset an account's quota. Authentication is reused only within one request; later requests recheck identity and account state.

Ordinary authenticated APIs allow 300 requests per minute per user unless an endpoint has a tighter limit. Public APIs use a separate 600-per-minute peer-IP allowance, and demo login has a smaller limit. Missing or failed identities share a quota by observed peer IP. A broad 6,000-request-per-minute network guard runs before parsing and identity-provider work. Static assets and preflight requests do not consume the ordinary API allowance.

Counters are in memory in one server process. Restarts reset them and multiple instances have separate counters. Scaling requires a shared limiter or configured gateway. Arbitrary forwarded headers are not trusted. Verify proxy policy and tune the broad guard against measured campus traffic during deployment. See [OPERATIONS_API.md](OPERATIONS_API.md).

## Private offline use in Checkpoint 3

Offline reading is now implemented through two separate components: a public app shell and an explicit, account-aware private device store. Initial authentication and preparation require internet. Subsequent reopening can use a valid saved snapshot without indefinitely waiting for the server.

### Public shell and installation

The production service worker caches the public HTML shell and a bounded build-asset allowlist, including the JavaScript, CSS, icons, and public assets needed to open it. It excludes API responses, authentication responses, requests with Authorization headers, profile photos, and lecture download endpoints. Private records and file bytes are never written to its general response cache. Worker updates wait for the user's update action instead of automatically reloading an open form.

A supported browser can install the HTTPS website to its home screen. Web installation does not require an App Store release and does not create an APK. The device screen separately checks public-shell readiness and private-data preparation. Development hot reload is not the production service-worker verification path. See [INSTALL_AND_ANDROID.md](INSTALL_AND_ANDROID.md).

### Explicit preparation, account isolation, and expiry

Offline preparation is opt-in. IndexedDB stores a single enabled account per browser profile with a changing account-generation marker. Each asynchronous commit verifies that marker; an old account's slow download or synchronization cannot overwrite a newer account's store. Snapshot fields are explicitly selected, not copied from arbitrary API responses. Class rosters, pending members, join codes, owner directories, Developer drafts, and authentication tokens are excluded.

A complete snapshot can include authorized class details, subjects, resource metadata, notices, notification state, all weekly timetable entries, all active exception pages, and all active deadline pages. The exception API supports `all=true` to include dates beyond the initial week. The same import-free schedule resolver creates the dated timetable online and offline.

Ordinary students and admins prepare their joined classes. The Master Admin console is online-only. Use a separate university student account for personal classes and offline preparation; legacy owner snapshots are cleared when this version reads them. Structured information is capped at **20 MiB**, classes at **20**, and explicitly saved file bytes at **150 MiB**. Browser storage may impose a lower limit. A failed or incomplete preparation does not replace the previous complete snapshot or extend its freshness timestamp.

Saved data is eligible for **seven days from the last successful full synchronization**, based on the device clock. Permission-only pruning does not extend that period. Once expired, the application requires reconnection and clears the invalid app-managed snapshot. This is a freshness policy, not tamper-proof encryption or remote document control.

Offline views show connection state and the last successful synchronization time. An offline device cannot know that a class was cancelled, a notice was edited, or a deadline was changed elsewhere. Shared content and personal completion are read-only offline; no background queue silently submits old edits when the connection returns.

| Feature                                                               | Current offline behavior after successful preparation                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Weekly timetable                                                      | Read the saved recurring pattern and all saved dated exceptions; move between weeks. |
| Quizzes, assignments, and events                                      | Read synchronized deadlines and saved personal completion status.                    |
| Announcements and notices                                             | Read the synchronized authorized content and notification state.                     |
| Resources and bookmarks                                               | Browse saved metadata and references; a bookmark alone is not a file download.       |
| Explicitly saved files                                                | Open after a complete authorized file save, while the snapshot remains eligible.     |
| Class rosters, owner controls, and profile photos                     | Not included in private offline snapshots.                                           |
| First login, recovery, publishing, editing, joining, and marking done | Require internet.                                                                    |
| University portal, external Developer links, and future AI            | Require internet.                                                                    |
| Front-page generator and durable push reminders                       | Planned for later checkpoints.                                                       |

### File saves and removal

Saving for offline use fetches a private resource through the authenticated download API and rechecks the authoritative manifest before committing the complete blob. It verifies the expected resource version metadata and byte size. Files have explicit saved and failed states; a partial transfer is not advertised as available offline.

Students can see usage, remove an individual offline file, refresh preparation, or clear app-managed private data. An ordinary browser download is separate: files exported to the operating system's Downloads folder are outside these controls. Browser storage can be cleared or evicted and is not a backup. See [browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

### Reconnection, revoked access, and shared devices

`GET /api/offline/access` derives the current visible scope from SQL in a read transaction. It includes class, subject, notice, and resource metadata without storage keys, private URLs, rosters, or invitation secrets. It fails explicitly if a complete bounded manifest cannot be returned. This access list is not a credential.

Reconnection and refresh revalidate the account and scope, remove unavailable classes, subject-linked records, disabled features, and stale or inaccessible file copies, then refresh academic data. New content versions become available after successful synchronization. An authoritative permission or suspension failure must not be disguised as a network outage that returns old private data.

Logout, account switching, and explicit clear-data actions remove the app-managed private store. Cross-tab changes invalidate another open tab's account view. Use offline preparation on a trusted device: someone able to open the same browser profile may be able to read its enabled offline snapshot. Namespace isolation does not secure an unlocked or compromised device.

**A disconnected device cannot receive immediate revocation.** Suspension or membership removal blocks subsequent server access and is applied to the device when it reconnects. It cannot immediately erase an offline copy, recall an exported document, or stop someone retaining information they previously viewed. The seven-day freshness window reduces indefinite in-app stale access but does not provide remote erasure.

### Reminder and release boundaries

An offline deadline list does not need a push connection. New push delivery requires connectivity, and permission alone does not guarantee delivery. Exact-time reminders from a closed offline web browser are not promised. Later Android notification support must update or cancel synchronized reminders when changes arrive. See [Firebase message lifespan and delivery](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan).

## Local demo and verification boundary

Demo personas are development identities, not verified university accounts. Demo mode is restricted to a loopback server, local origins and peers, local SQL, and local file storage. Production refuses demo authentication. Keep demo and real databases separate; seeded identities must not be promoted into a live student database.

Automated tests exercise real local APIs and SQL permissions, academic uploads and relevant storage failures, current roles and migration, timetable and deadline versioning, manifest visibility, account-aware device stores, and selected React and worker behavior. They do not contact university mailboxes or live providers. Passing them does not prove Firebase/Turso/R2 connectivity, email delivery, physical phone installation, real-browser offline reopening, realistic production load, or native Android behavior. Record completed and outstanding checks in [VERIFICATION.md](VERIFICATION.md).

Before broad use, perform the production-browser acceptance flow: sign in, prepare a class, save a PDF, fully close, disconnect, reopen, and read the timetable, notices, deadlines, and file. Verify visible timestamps, expiry, interrupted preparation, account switching, storage loss, reconnect updates, parent deletion, and removed membership. Repeat on target iPhones and Android browsers with the intended hosting configuration.

The Android project, signed APK/direct download, AAB, and Play preparation remain Checkpoint 5. No current APK or store publication is claimed. Backups, object reconciliation, live-provider configuration, load checks, and physical-device validation remain necessary operational and release work.
