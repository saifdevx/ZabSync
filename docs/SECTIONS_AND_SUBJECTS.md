# Checkpoint 4: one section, multiple subjects

This document supersedes older instructions that allowed a student or Class Admin to join/create several classes. Existing SQL/API names such as `classes` remain for safe upgrades; in the product a class means one university section, for example 5D.

## User experience

- A Student sees **My Class** and **My Subjects**. My Class opens their one approved section. My Subjects lists only subjects they enrolled in.
- A subject has its own Resources, Announcements, Deadlines, and Chat tabs. Students can discuss questions in chat when that subject's admin enables student participation. Chat does not grant shared academic publishing rights.
- The owner alone creates sections and explicitly transfers a student between them.
- Class Admins create and manage subjects inside their assigned section. They cannot create another section or appoint other admins. Only the owner appoints or demotes Class Admins.
- A course label such as `CS501` is descriptive. It is different from the generated, expiring **subject join code**.

## Admission and subject codes

1. The section's admin creates a subject and opens **Subject code** on its page.
2. The admin generates a code and shares it only with their own students. A full code is shown once; the database retains only its hash. Codes last seven days and can be replaced or revoked.
3. An unassigned Student enters the code through Join a subject. It creates a pending request for that section and subject, without granting access to either.
4. The section's admin reviews the student in My Class → Join requests. Approval pins the student's one section and enrolls all their pending subjects in that section. Rejection grants no access.
5. Once assigned and actively enrolled in the section, entering another valid subject code from that same section enrolls the student in that subject immediately.
6. Codes from other sections are rejected. A pending request for a different section must be cancelled or rejected before an unassigned account can request another section.

The app does not infer enrollment from an email address, roll number, URL, browser role, or knowledge of a subject ID. A university email proves mailbox eligibility; the first admission is reviewed by the section admin/owner.

## Owner transfer and old membership conflicts

Owner dashboard → semester → destination section → People → **Enroll or transfer a student**.

- **Enroll** adds an unassigned Student or restores their existing section membership. It refuses an account assigned to a different section.
- **Transfer / resolve** displays the student's membership history and asks for a reason. The owner explicitly confirms the destination and can select its subjects.
- Transfers use the current assignment version. Two conflicting requests using the same version cannot both succeed.
- Active/pending memberships in previous sections are marked removed/rejected, not deleted. Subject access there is removed. Previous admin authority does not follow the student; the new role is Student. Appoint an admin separately if required.
- Existing subject enrollment in the chosen section is retained. Optional selected destination subjects are enrolled; other subjects can later be joined with their codes.

Migration 7 creates `student_sections`, `subject_enrollments`, and `subject_invites`. A single pre-existing active membership is bound automatically. Existing members receive enrollment records for their pre-existing subjects so their access is preserved.

If an older account has multiple active sections, the migration does **not** silently choose one or discard its history. It marks the account `needs_resolution=1`, with no accessible section. An owner must use the explicit workflow above. Old memberships remain available in the owner history. Multiple conflicting pending memberships on an unassigned account also need owner resolution.

## Server enforcement

- `student_sections.user_id` is the single assignment key. SQL triggers reject a second active/pending section for the same student, independently of HTTP/UI checks.
- Admission, approval, transfer, cancellation, and role changes run in write transactions. An initial request pins the pending section before a competing request can proceed.
- `classAccess` requires an active account, active section, active membership, and a matching resolved section binding. The owner has explicit global management access.
- `subjectAccess` additionally requires active subject enrollment for a Student. A Class Admin can manage all subjects of their pinned section; the owner can manage any section.
- Feed/search queries, attachment lists, bookmarks, notifications, resource downloads, and subject deadlines use the same section/subject visibility rules. General section announcements and section-wide deadlines remain visible to approved section members. The shared full-week section timetable stays visible online and offline; a separate timetable-subject access list does not grant access to those subjects’ resources, notices, deadlines, or chat.
- Existing legacy class invitations stay in the database for history but cannot be used to join. `/api/join` and `/api/classes/:id/invite` return `410 workflow_retired`.

## API additions

| Method/path                                    | Purpose                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST `/api/subjects/join`                      | Body `{code}`; pending first admission or same-section subject enrollment               |
| DELETE `/api/me/section-request`               | Cancel the caller's pending admission requests                                          |
| GET `/api/subjects/:id/invite`                 | Subject admin reads expiry/active status, never the original secret                     |
| POST `/api/subjects/:id/invite`                | Generate/replace that subject's code                                                    |
| DELETE `/api/subjects/:id/invite`              | Revoke future use of that subject's code                                                |
| GET `/api/admin/users/:userId/section`         | Owner reads assignment version and preserved memberships                                |
| PUT `/api/admin/users/:userId/section`         | Owner body `{classId,version,reason,subjectIds?}` explicitly assigns/transfers/resolves |
| GET `/api/classes/:id/deadlines?subjectId=...` | Only the selected subject's authorized deadlines                                        |

Existing class membership decision and owner role endpoints remain; approvals now bind one section and activate the pending subject enrollment. `/api/me` adds `section` and `subjectRequests`; `classes` remains an array for compatibility but holds at most one accessible Student section. `canCreateClass` is true only for the active owner.

## Offline changes

The snapshot format is version 2. Checkpoint 3 snapshots cannot be opened by this build, preventing old multi-section data from silently remaining available through the new interface. Reconnect and prepare a new snapshot once after upgrading.

New snapshots are limited to one section, are read-only, and retain the seven-day freshness window. An online access check prunes removed sections, subject enrollments, attached content, deadlines, and saved file access. A full sync validates the access list before and after collecting records to avoid committing mixed permissions.

A device that is disconnected cannot learn about a later role change or removal until it reconnects; the existing freshness window limits that offline period. Files the user deliberately downloaded outside the app cannot be recalled by the application. The owner console remains online-only.

## Verification scope

The Checkpoint 4 tests exercise first admission, same-section subject joining, cross-section rejection, duplicate/concurrent requests, owner transfer version conflicts, preserved migration history, role demotion, subject-specific content/deadlines, offline visibility and invalidation, and rotated/expired/revoked subject secrets. They use isolated test databases and mocked identity verification where appropriate, never real university accounts.
