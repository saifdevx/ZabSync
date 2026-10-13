# Five-checkpoint roadmap — current Checkpoint 3

> Historical checkpoint reference. For version 0.4.0, the current requirements and routes in [SECTIONS_AND_SUBJECTS](SECTIONS_AND_SUBJECTS.md), [CHECKPOINT_4_GUIDE](CHECKPOINT_4_GUIDE.md) and [project context](../ZabSync_Project_Context.md) take precedence. Only the owner creates sections; student subject enrollment is restricted to one pinned section.


The application is **ZabSync**, a reusable class workspace for SZABIST Islamabad. Each class configures its own name, program, semester, section, subjects, and content. There is no fixed eight-semester catalogue to maintain before students can use it.

This is the third of **five cumulative checkpoints**. Each release contains the complete source ZIP, setup and upgrade guidance, and verification results. Use the new release in its own folder and follow its upgrade guide to preserve private configuration, database records, and uploaded files. Corrections remain within the same numbered checkpoint.

## At a glance

| Checkpoint | Main outcome                                                                                       | Status in this ZIP                                                      |
| ---------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1          | University accounts, class setup, membership, and permissions                                      | Included; roles and class creation have been updated in Checkpoint 3.   |
| 2          | Subjects, private files, announcements, profiles, owner controls, and web installation             | Included; the Tutor section has been replaced by Developer information. |
| 3          | Weekly timetable, dated changes, deadlines, private offline reading, and a clearer admin hierarchy | Current implementation.                                                 |
| 4          | Durable reminders, production operations, front-page PDF generation, and bounded help/AI           | Planned.                                                                |
| 5          | Release validation, hosting, and Android packaging                                                 | Planned.                                                                |

The current role names are **Student**, **Class Admin**, and **Master Admin**. Existing CR and GR memberships are migrated to class admin memberships without discarding their IDs or history. Several admins can manage the same class. The previous class approval queue is retired; historical records remain available for audit and migration continuity.

## Checkpoint 1 foundation — accounts and class membership

The retained foundation provides a responsive React interface, Node API, and persistent SQL. Local SQLite works without a cloud database; a libSQL-compatible Turso configuration path is included. Real authentication uses Firebase registration, verified-email sign-in, and password recovery. Three selectable local demo personas let you try Student, Class Admin, and Master Admin without external credentials.

Ordinary protected accounts require a verified email on the exact `szabist-isb.pk` domain. A separate external owner is supported only by an exact verified email and pinned Firebase UID in private server settings; see [OWNER_ACCOUNT.md](OWNER_ACCOUNT.md). The university domain is shared by students and staff, so mailbox verification alone does not prove student enrollment. Class admins approve known classmates' join requests; an official student directory would be a separate future integration.

### Current class creation and join flow

The Master Admin can create the first class, add an already registered account, and assign that account as a class admin. Someone with an active admin membership in an active class can then create a new class directly. Ordinary students cannot create classes or promote themselves. For a Class Admin creator, the server creates the class and its creator's admin membership together; a separate owner approval is no longer required. Owner-created classes start with no members. The owner manages them through the semester directory and uses a separate university account for class participation.

Each class has a permanent Class ID and a separate expiring, replaceable join code. Knowing the ID is not authority. Submitting a valid code creates a membership request; that class's admin or the owner approves it. Approval grants ordinary membership. Only the owner assigns or removes class admin roles. A person may administer one class and remain an ordinary student in another. See [ROLE_ADMIN_API.md](ROLE_ADMIN_API.md) for the full contract.

The campus website and ZABDESK shortcuts remain available. ZabSync redirects to those university services; it does not collect portal passwords or replace university authentication.

**Acceptance:** create a class as an authorized admin, request admission with a code, approve the member, and confirm that the student can read but cannot publish. Changing a role must affect an existing session on its next online request. Real Firebase use additionally requires private provider configuration and actual university-mailbox verification and recovery checks.

## Checkpoint 2 foundation — organized academic content

Class admins and the owner create and edit subjects with names, course codes, instructors, descriptions, and colors. Students read subjects for their approved classes. Publishing is restricted to admins; a general student chat service is not implemented.

Private PDF/PPT/PPTX resources support titles, descriptions, authorized download, search, bookmarks, edit, trash, restore, and separate permanent removal. Local storage works without cloud setup. The private R2 adapter is included, but its live connection has not been tested. Current code-level limits are **25 MiB per file and 100 MiB per class**, including trash and pending deletion. These are not dashboard quota controls.

Document checks validate type and structure; they are not malware scanning. Legacy PPT macros are not deeply inspected. SQL and object storage do not share one atomic transaction, so interrupted uploads may need private orphan-object reconciliation. See [SECURITY_AND_OFFLINE_PLAN.md](SECURITY_AND_OFFLINE_PLAN.md) and [ACADEMIC_API.md](ACADEMIC_API.md).

### Announcement audiences

| Scope             | Who can publish and manage               | Audience                                        |
| ----------------- | ---------------------------------------- | ----------------------------------------------- |
| Subject           | That class's admins and the Master Admin | Approved members of that class.                 |
| Class             | That class's admins and the Master Admin | Everyone in the class, including the Home feed. |
| Whole application | Master Admin only                        | Every active application account.               |

Announcements support priority, pinning, edit, trash and restore, and up to five same-audience attachments. Global notices cannot expose private class files. Class and global announcements appear on Home without opening a subject. In-app notifications have personal read status; edits can make a notice unread again. They are separate from device push notifications.

Deleting a subject hides its linked content. Restoring the subject returns its active children; independently trashed items remain trashed. Restore a deleted parent before managing its individual files. Trash counts toward class storage until an authorized admin removes the file permanently.

### Profiles and one owner dashboard

Students can customize their display name, optional unique username, and optional profile photo. Verified email and immutable identity remain unchanged. Photos are decoded, bounded, re-encoded without original metadata, and privately served to authorized viewers.

The owner dashboard now combines the semester-to-section directory, full class roster, account suspension and reactivation, class admin assignments, global notices, Developer editing, feature switches, and read-only maintenance. The directory only creates groups for semesters that have real classes; it is not a requirement to populate every semester.

**Developer information replaces Tutor.** The owner can save a private draft and publish a name, biography, portfolio link, updates, and other app links through **Master Admin → Developer**. Students open the separate **Meet the Developer** page (`/developer`) from the sidebar or Get the App. Existing Tutor records remain legacy data and are not presented as a second active feature. No identity, qualification, contact, or portfolio content is invented.

Feature switches control subjects, resources, announcements, Developer information, profile photos, timetable, and deadlines. They retain the stored content and are enforced by the server. New software still requires code, review, build, and deployment through GitHub; the dashboard changes implemented content and settings.

Maintenance pauses non-owner writes while preserving reads and owner recovery controls. Suspension blocks the affected account's future protected requests. These controls do not erase files that someone already exported to a device.

**Acceptance:** an admin creates a subject, uploads a file, and posts a class notice; a member sees it on Home and downloads the file. A different class cannot access it by changing the URL. Verify parent trash and restore, bookmark visibility, profiles, Developer publication, feature switches, and maintenance. Test inventory and verification status are recorded separately.

## Checkpoint 3 — timetable, deadlines, and actual offline reading

### A recurring week with dated exceptions

Class admins configure weekly sessions with a weekday, start and end times, optional subject, teacher, room, and notes. The schedule uses **Asia/Karachi**, independent of the server's timezone. Invalid dates and time ranges are rejected.

A dated cancellation or reschedule affects one occurrence. A rescheduled session preserves a marker on its original date and appears at its replacement date, including across week boundaries. Extra classes add a dated session without rewriting the recurring week. Exact duplicates are rejected; other overlaps are visibly flagged because parallel sessions may be intentional.

Edits and deletions use record versions. If two admins edit the same record, the later stale submission receives a conflict and must refresh. Changing a weekly weekday requires removing its dated overrides first. Removing a weekly entry hides its overrides; removing an override restores the underlying weekly occurrence.

### Quiz, assignment, and event deadlines

Admins create deadlines with a date, time, kind, optional subject, and details. Each member can mark a deadline done for themselves. Completion does not prove submission or grading. If an admin changes the deadline, its new version becomes incomplete until the member deliberately marks it done again.

These lists and status controls are implemented now. Reliable push or closed-browser reminders remain Checkpoint 4 work. Announce important changes through the existing class announcement feature in the meantime. See [TIMETABLE_API.md](TIMETABLE_API.md) for all fields and endpoints.

### Prepare a device for offline use

After signing in online, a student can explicitly prepare offline access. Preparation saves authorized class information, all recurring timetable entries, every page of active dated exceptions and deadlines, notices, notifications, and resource metadata. Dated exceptions use the new `all=true` API option, so moving to another saved week does not silently omit an exception outside the initial week.

Private files are saved separately through an explicit offline-file action after the full download succeeds. A bookmark saves a reference and does not download the document. The device page shows saved status, last synchronization time, file usage, refresh, individual removal, and clear-data controls.

Saved academic views are **read-only** and remain eligible for **seven days from the last successful full synchronization**. First login, new files, publishing, edits, joining classes, changing a profile, and marking deadlines done require internet. An expired or absent snapshot requires reconnection. The timetable uses the same pure schedule resolver online and offline.

App-managed private stores are isolated to one active account in a browser profile. Logout and account switching clear them; asynchronous work from an old account cannot repopulate the new account's store. Reconnection checks the authoritative visibility manifest, removes revoked scope and inaccessible files, and refreshes content. This cannot recall an already saved copy while a device is disconnected, or erase files exported outside the app.

Current device safeguards are at most **20 classes**, **20 MiB of structured snapshot data**, and **150 MiB of explicitly saved files**. Ordinary students and Class Admins save their joined classes. The separate Master Admin console requires a connection and does not prepare offline academic snapshots. Browser storage may provide less space or be evicted; incomplete preparation must not be advertised as successful.

### App installation and reopening

The production service worker caches the public application shell and an explicit build-asset allowlist. Private data and file bytes live in the account-aware device store, not in an indiscriminate cache of authenticated API responses. The worker excludes APIs, authentication responses, private photos, and lecture downloads.

The manifest, supported-browser installation prompt, iPhone instructions, and shareable deployed-site link remain available. Students can open the HTTPS website and add it to their home screen. This does not require an App Store release and does not create an APK. A full offline reopening requires both a successfully installed public shell and a prepared private snapshot. Development hot reload is not the production service-worker test path.

**Acceptance:** prepare offline data, save a PDF, fully close the production app, disconnect, reopen, and read the timetable, deadlines, notices, and file. Check visible offline status and synchronization time; reconnect and apply changes, deletions, and revoked access. Confirm account isolation, snapshot expiry, interrupted preparation, incomplete download handling, and clear-data behavior. Automated API and device-store checks are included; physical-phone and actual browser installation validation remain separate release checks.

## Checkpoint 4 — reminders, student tools, and operational maturity

Add durable reminders with opt-in push and delivery-state handling. A changed or cancelled deadline must update its reminders. A closed offline browser is not promised an exact-time alert. The Android stage can add local notification support after device testing.

Extend existing owner controls with configurable budgets and quotas, backup and restore procedures, object reconciliation, shared rate limits when running multiple servers, and remaining recovery workflows. Basic maintenance and suspension already exist; they do not replace production operations.

Add the front-page PDF generator after receiving the approved design and fields. Aim for local generation after the template and assets are available on the device. Match the supplied example instead of inventing a university format.

Add approved university, application, and developer help. Optional AI uses approved sources, per-account limits, a global budget, and server-only credentials. Restrict answers to that scope and keep ordinary help usable with AI disabled. Course uploads and student data are not automatically sent to AI.

If public student discussion is selected, add moderation and abuse controls deliberately. Admin publishing remains usable without a real-time chat service.

**Acceptance:** reminders respect deadline changes; backup and restore recover intended records and files; the generated PDF matches its sample; configured AI obeys scope and usage limits.

## Checkpoint 5 — release, hosting, and Android

Complete end-to-end permission and recovery checks, realistic load validation, browser and phone usability, offline reopening, accessibility, error handling, and final setup and upgrade guidance. Validate the local or Render production path using configured services and HTTPS.

Add the Capacitor Android project and document Android Studio, API origin, authentication, downloads, notifications, device storage, signing, and updates. A wrapper still needs a hosted backend and persistent database/files. Claim an APK or AAB only after an actual successful build and verification.

For students outside the Play Store path, provide a signed APK at an owner-controlled HTTPS link with version and checksum information after packaging. The website installation link is already supported and remains distinct from a downloadable Android package. **Checkpoint 3 contains no APK, AAB, or store listing.**

Verify the then-current developer-account, testing, privacy, and release requirements when the owner is ready. Signing keys and publication accounts remain private and owner-controlled.

**Acceptance:** Student, Class Admin, and Master Admin flows pass; target devices work online and with the promised saved data offline; upgrades preserve data; the configured deployment and Android package are validated.

## Resources needed later

Nothing else is needed to try the local Checkpoint 3 demo. For actual class use and the remaining checkpoints, provide:

- Real subject names, trusted lecture files, and section timetable/deadline details, entered through the class admin screens.
- Developer biography, portfolio, update text, and other app links, entered through the owner dashboard.
- The approved quiz/assignment front-page design and required fields for Checkpoint 4.
- Approved university, application, and developer help content, plus an AI budget if enabling AI.
- The owner's chosen verified email and provider/hosting configuration, entered privately using the setup guide. An external owner also needs the exact Firebase UID; ordinary accounts stay university-only.
- Hosting and Android developer accounts when deployment and release testing begin.

Never send passwords, service-account JSON, database tokens, R2 secrets, signing keys, or API keys in chat. Live Firebase, Turso, and R2 connectivity; physical devices; realistic load; native builds; and store publication are not implied by passing local automated tests. See [VERIFICATION.md](VERIFICATION.md) for the current verification boundary.
