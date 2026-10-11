# Five-checkpoint roadmap — current Checkpoint 2

The application is **XVIA**, with **Node Compass Task** as its full product name. It serves SZABIST Islamabad through a reusable class template. Each class configures its own name, program, semester, section, subjects, and content; no fixed eight-semester catalogue is required.

This is the second of **five cumulative checkpoints**. Each delivers the complete source ZIP, setup/upgrade instructions, and verification results. Extract the new version into its own folder and follow its upgrade guide to retain private configuration/data. You do not need to merge snippets manually. Corrections stay within the same numbered checkpoint.

## At a glance

| Checkpoint | Main outcome                                                        | Status in this ZIP        |
| ---------- | ------------------------------------------------------------------- | ------------------------- |
| 1          | Accounts, class setup, roles, and admission                         | Included and retained.    |
| 2          | Academic content, profiles, Tutor, owner controls, web installation | Current implementation.   |
| 3          | Timetable, deadlines, and private offline academic access           | Required next checkpoint. |
| 4          | Reminders, operations, PDF generator, bounded help/AI               | Planned.                  |
| 5          | Release validation, deployment, and Android packaging               | Planned.                  |

Checkpoint 2 brings forward profile customization, Tutor editing, read-only maintenance, suspension, feature switches, and basic PWA installation. Later checkpoints extend these existing features and validate production behavior.

## Checkpoint 1 — accounts, roles, and class setup

The retained foundation provides:

- Responsive React interface, Node API, and persistent SQL: local SQLite and a libSQL-compatible Turso configuration path.
- Four selectable local demo personas without external account setup.
- Firebase registration, verified-email login, and password recovery for real accounts.
- Exact `szabist-isb.pk` email-domain enforcement before protected application access.
- Student, class-scoped CR/GR, and global Master Admin permissions.
- Class requests/owner approval; permanent Class IDs and expiring, replaceable join codes.
- Separate membership requests and representative review.
- Class/member controls, representative handover, and retained request history.
- Official campus website and ZABDESK shortcuts.

The domain is shared by students and staff. Verification proves mailbox ownership; class approval supplies another eligibility check. Official enrollment integration would be a separate improvement.

The website opens `https://szabist-isb.edu.pk/`. ZABDESK opens `https://zabdesk.szabist-isb.edu.pk/`, linked by the [official campus ZABDESK page](https://szabist-isb.edu.pk/zabdesk/). XVIA does not collect portal passwords or replace university authentication.

**Acceptance:** create/review class and membership requests, change representatives, and verify that students cannot edit settings or access another class. Real Firebase mode additionally needs configured credentials and actual university-mailbox verification/recovery checks before inviting real students.

## Checkpoint 2 — academic content and the requested additions

### Subjects, files, and announcements

Representatives can create/edit subjects with a name, optional course code, instructor, description, and color. Students read their class's subjects. Feeds currently let representatives and the owner publish while students read; general student chat is not implemented.

Private PDF/PPT/PPTX uploads support titles, descriptions, authorized downloads, search, bookmarks, edit, trash, restore, and separate permanent removal. Local storage works without cloud setup. A private R2 adapter is included for configuration; its live connection has not been tested. Current code-level defaults are **25 MiB per file and 100 MiB per class**, including trash. These are not runtime dashboard quota controls.

Document validation checks type/structure and bounded PPTX metadata. It is not malware scanning; legacy PPT is not deeply inspected for macros. SQL/object storage are not one atomic transaction, so an interrupted upload may need private orphan-object reconciliation. See `docs/SECURITY_AND_OFFLINE_PLAN.md` and `docs/ACADEMIC_API.md`.

Announcements have three audiences:

| Scope             | Who can publish/manage                  | Audience                                                          |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Subject           | That class's CR/GR and the Master Admin | Approved class members, in the subject feed and relevant notices. |
| Class             | That class's CR/GR and the Master Admin | Everyone in that class, including the home feed.                  |
| Whole application | Master Admin only                       | All active application accounts.                                  |

Notices support priority, pinning, editing, trash/restore, and up to five same-audience attachments. Global notices cannot expose private class files. Class/global announcements appear on Home without requiring students to open a subject. In-app notifications have per-account read state; edits can make a notice unread again. These are not push notifications.

Deleting a subject hides its content. Restoring it returns active children and leaves independently trashed items in trash. Restore a trashed parent before managing its individual files. Trashed files count toward storage until explicitly removed permanently.

### Profiles, Tutor, and one owner dashboard

Students can customize display name, unique optional username, and optional profile photo. Their verified email and immutable identity remain unchanged. Photos are decoded, bounded, re-encoded without original metadata, and privately served to authorized viewers.

The owner can edit a Tutor profile, keep a private draft, then publish it for students. The initial draft is empty; the owner supplies a real name, biography, subjects, and optional HTTPS contact/booking links.

The Master Admin area combines class requests, class/representative management, account suspension/reactivation, global notices, Tutor editing, feature switches, and read-only maintenance. Switches cover subjects, resources, announcements, Tutor, and profile photos, preserve data when disabled, and are enforced by the server.

New software still requires code changes and deployment. GitHub supports reviewable updates; dashboard fields change content/settings and do not install arbitrary code. Suspension blocks future server access. Maintenance pauses non-owner changes while retaining reads and owner recovery controls.

### Appearance and web installation

The interface uses XVIA branding, the supplied favicon/home-screen image, university artwork, additional subject/accent colors, mobile navigation, and restrained motion with reduced-motion support.

The manifest, conditional browser install prompt, iPhone instructions, shareable deployed-site link, and public reconnect page are included now. An iPhone user can open a deployed HTTPS website in Safari and add it to the home screen without an App Store release. Browser menus/support vary; real-device installation still needs validation. See `docs/INSTALL_AND_ANDROID.md`.

Checkpoint 2 caches only the public reconnect page and icon. It does not yet save the authenticated app, timetable, announcements, or lecture files for offline reopening. Private data will receive its dedicated, account-scoped offline implementation in Checkpoint 3.

**Acceptance:** a representative creates a subject, uploads a file, and posts a class notice; a classmate sees it on Home and can download the file; another class cannot access the file by changing its URL. Verify trash/restore, bookmark visibility after removal, profiles, Tutor draft/publication, feature switches, and maintenance. Automated coverage is in `tests/README.md`; provider/device status is in `docs/VERIFICATION.md`.

## Checkpoint 3 — timetable, deadlines, and offline academic access

This is the user's next priority: after initial online sign-in/synchronization, students must fully close and reopen XVIA without internet and read saved academic information.

Add the weekly timetable, dated changes, cancelled/extra classes, quiz/assignment deadlines, and personal reminder preferences. Use **Asia/Karachi** for schedules. A dated exception changes that occurrence without silently rewriting the recurring week.

Extend the PWA foundation with account/class-partitioned stores for timetable, deadlines, and previously synchronized notices. Files become available offline only after an explicit save completes. Bookmarks remain distinct from downloaded bytes.

Show connection status, last successful sync, file-save progress, storage usage, and removal/redownload controls. Startup must show valid saved content without waiting indefinitely for the API. Reconnection refreshes permissions/data and applies deletions. Shared academic editing initially requires a connection. Logout/account switching clears app-managed private stores.

**Acceptance:** synchronize, save a PDF, fully close, disconnect, reopen, and read the timetable/deadlines/file. Make a change elsewhere and verify the offline copy is labelled stale; reconnect and receive it. Confirm a second account cannot read the first account's saved data. Test interrupted synchronization and browser storage loss. Closed-browser exact-time offline alerts are not promised.

## Checkpoint 4 — reminders, operations, and student tools

Extend existing owner controls with durable reminders, opt-in push, configurable usage/storage budgets, audit review, backup/restore procedures, object reconciliation, and remaining recovery workflows. Basic maintenance and suspension already exist; production operations require more than those switches.

Add the front-page PDF generator after receiving its approved design/fields. Aim for local generation once template/assets are available on the device. Match the supplied example instead of inventing a university format.

Add approved university, app, and creator help. Optional AI uses approved sources, per-account limits, a global budget, and server-only credentials. Restrict it to university/app questions and approved owner information; keep help usable with AI disabled. Course uploads and student data are not automatically sent to AI.

If student discussion is selected, add deliberate moderation and abuse controls. Representative publishing remains available without public-chat costs.

**Acceptance:** changed/cancelled deadlines do not produce obsolete reminders; backup/restore recovers the intended records/files; the PDF matches its sample; configured AI respects scope/limits. Core features must work rather than appear as decorative buttons.

## Checkpoint 5 — release validation, hosting, and Android

Complete end-to-end permissions/recovery, realistic load checks, browser/phone usability, offline reopening, accessibility, error handling, and final setup/upgrade guidance. Validate the local/Render production path with configured services and HTTPS.

Add the Capacitor Android project and document Android Studio build, API origin, authentication, downloads, notifications, storage, signing, and updates. A wrapper still needs the hosted backend and persistent database/files. Claim an APK/AAB build only after it actually succeeds.

For students outside the Play Store path, provide a signed APK at an owner-controlled HTTPS link with version/checksum information after packaging and verification. A web-install link is already supported and is distinct from an APK download. No APK or App Store/Play listing is supplied in Checkpoint 2.

Prepare the Play bundle and verify then-current developer-account, testing, privacy, and release requirements when the owner is ready. Signing keys and publication accounts remain private and owner-controlled.

**Acceptance:** complete student, representative, and owner flows pass; target devices work online and with specified saved data offline; upgrades preserve data; the configured deployment and Android package are validated.

## Resources needed later

Nothing else is required to try the local Checkpoint 2 demo. For actual use and remaining checkpoints, supply:

- Real subject details, trusted lecture files, and section timetable/deadline examples. Add subjects/files directly through representative screens if convenient.
- Tutor biography, offered subjects, and contact links, entered in the owner dashboard.
- Front-page design and required quiz/assignment fields for Checkpoint 4.
- Approved university/app/creator help and an AI budget, if enabling AI.
- The real owner university email and provider/hosting configuration, entered privately using the guide.
- Hosting and Android developer accounts when deployment/release testing is reached.

The supplied icon and XVIA/Node Compass Task names are already applied. A higher-resolution original is optional for later icon refinement. Do not send passwords, service-account JSON, database tokens, R2 secrets, signing keys, or API keys in chat.
