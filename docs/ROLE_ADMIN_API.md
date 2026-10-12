# Checkpoint 3: class admins and owner hierarchy

ZabSync has two global account roles: `student` and `master`. A class membership has a separate `student` or `admin` role. A user can administer one class and be an ordinary member of another. Class administration never grants access to the owner dashboard, all classes, global announcements, settings, developer drafts, or account suspension.

Every request requires an authenticated, active account. Ordinary users need verified university email; the single server-configured owner can use an external email only with its exact verified email and pinned Firebase UID. See [OWNER_ACCOUNT.md](OWNER_ACCOUNT.md). Permissions are reread from the database, including inside write transactions. Client flags, cached roles, user-supplied headers, profile names, roll numbers, and knowledge of a class ID never grant authority.

## Creating a class directly

`GET /api/me` includes a top-level `canCreateClass` boolean. It is true only for the active owner or an active admin membership in at least one active class. `classes` continues to describe the actor's own active memberships, up to 100. The owner can inspect every active class through the separate owner hierarchy regardless of membership.

An authorized actor can call:

```http
POST /api/classes
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "name": "5D",
  "program": "BS Computer Science",
  "semester": 5,
  "section": "D",
  "description": "Our class workspace."
}
```

Name: 1–80 characters; program: 2–100; semester: integer 1–12; section: 1–20; description: up to 1,000, default blank. Unknown fields are rejected. An ordinary student receives **403 `class_creation_forbidden`**. The active owner can create the first class before any class admin exists.

A successful Class Admin creation response is **201**:

```json
{
  "class": {
    "id": "generated-class-uuid",
    "name": "5D",
    "program": "BS Computer Science",
    "semester": 5,
    "section": "D",
    "description": "Our class workspace.",
    "createdAt": "2026-10-11T09:00:00.000Z",
    "role": "admin",
    "memberCount": 1
  }
}
```

When a Class Admin creates a class, the class and creator's active admin membership are created in the same transaction. When the Master Admin creates a class, **no membership is created**: the response uses `"role": null` and `"memberCount": 0`. The owner manages that class from the Master console and can enroll a separate university account. There is no approval queue or fictional join request. Duplicate active classes with the same creator, name, program, semester, and section return **409 `duplicate_class`**, including concurrent duplicate submissions. Names/program/sections are compared without case. Class creation has a per-account limit of 10 requests per minute.

`GET /api/classes?limit=100&offset=0` returns `{ "classes": [...], "pagination": { "limit": 100, "offset": 0, "total": 0 } }` with the caller's active memberships in active classes. The row shape is the same as `/api/me.classes`. This list is **enrolled-only for every role, including Master**; knowing how to create/manage a class does not enroll the account. Limit is 1–100 and offset is 0–100,000; unknown scope parameters are rejected. Use the owner hierarchy below for the global inventory.

The permanent class ID identifies the class; it is not an invitation secret. The creator can generate or rotate a separate expiring join code through `POST /api/classes/:id/invite`.

### Retired approval workflow

`POST /api/class-requests` returns **410 `workflow_retired`** after authentication. The legacy owner endpoints `POST /api/admin/class-requests/:id/decision` and `POST /api/admin/classes/:id/representatives` verify the owner and return the same 410. They cannot create a class or grant a role.

Historical `class_requests`, their review notes, and old audit events remain unchanged. `GET /api/me` retains the actor's historical `classRequests` list; `GET /api/admin/overview` retains historical `requests`. A historical pending record is not a current action item.

## Bootstrapping and assigning class admins

The owner can add an already registered, active account directly:

```http
POST /api/admin/classes/:id/members
```

```json
{ "userId": "immutable-provider-uid" }
```

Response:

```json
{
  "membership": {
    "id": "generated-or-existing-membership-id",
    "userId": "immutable-provider-uid",
    "classId": "class-uuid",
    "role": "student",
    "status": "active"
  }
}
```

The user must have signed in successfully at least once. Unknown/suspended accounts return 404. A global Master account cannot be enrolled and returns **403 `owner_membership_forbidden`**; the owner uses a separate university account for class participation. Repeating an add for an already active ordinary account returns that membership and preserves its role. Re-adding a pending, rejected, or removed member preserves the membership ID and historical request timestamp, but activates it as an ordinary student. It never silently restores an old admin role.

Only the owner can assign or remove a class admin role:

```http
PATCH /api/admin/classes/:id/members/:userId/role
```

```json
{ "role": "admin" }
```

Use `{ "role": "student" }` to demote. Response: `{ "userId": "...", "classId": "...", "role": "admin" }`. The target must be an active member with an active account and cannot be the global Master. Only `student` and `admin` are accepted; `master`, `cr`, and `gr` are rejected. Historical Master memberships remain as stored, but their class role cannot be changed while that account is the global Master.

Several admins can coexist. Appointing one does not demote another. The owner can demote or remove the final admin and can subsequently recover the class by assigning an active member. Existing bearer sessions immediately follow the new database role on their next request. `canCreateClass` also changes immediately if the user loses their final qualifying active admin membership.

`DELETE /api/classes/:id/members/:userId` removes an active membership, resets its class role to student, and records the review. Class admins may remove ordinary members only; they cannot remove themselves or another admin while that membership is an admin. The owner may remove any class member. Removed users lose class reads, edits, and downloads on subsequent online requests. An already exported file cannot be recalled.

## Joining through class codes

Existing invitation and join approval behavior remains:

1. A class admin or owner creates/rotates a code with `POST /api/classes/:id/invite`. Codes expire after seven days; rotation invalidates the old code immediately. Only its hash is stored.
2. An active university student account submits `{ "code": "..." }` to `POST /api/join`. A valid code creates a pending membership, never immediate content access or admin status. A Master self-join returns **403 `owner_membership_forbidden`**.
3. An admin of that exact class or the owner calls `POST /api/classes/:id/memberships/:membershipId/decision` with `{ "decision": "approve" }` or `reject`.
4. Approval creates an ordinary active member. The URL class and stored membership class must match. Pending members cannot approve themselves, even if they administer another class. A historical request whose account has since become Master cannot be approved into a class.

The join history retains pending, approved, rejected, and removed outcomes. Owner-added and directly created memberships do not invent join history. An ordinary member sees no pending-member directory or invitation details.

## Owner hierarchy and roster

All owner endpoints verify the authoritative global Master role. A class admin does not gain this directory.

### Semesters

`GET /api/admin/semesters` returns active classes grouped by semester:

```json
{
  "semesters": [
    { "semester": 5, "classCount": 3, "memberCount": 90, "studentCount": 84, "adminCount": 6 }
  ],
  "totals": { "classCount": 3, "memberCount": 90, "studentCount": 84, "adminCount": 6 }
}
```

Only semesters containing active classes appear. Member/student/admin counts include active memberships whose accounts are active. Suspended accounts and pending/rejected/removed memberships are excluded. These are enrollment counts: someone belonging to two classes is counted in both. `studentCount` and `adminCount` refer to class roles; historical owner memberships are counted when present, but new owner memberships are not created.

### Sections in a semester

`GET /api/admin/semesters/:semester/classes?limit=100&offset=0` returns:

```json
{
  "semester": 5,
  "classes": [
    {
      "id": "class-uuid",
      "name": "5D",
      "program": "BS Computer Science",
      "semester": 5,
      "section": "D",
      "description": "",
      "createdAt": "...",
      "memberCount": 30,
      "studentCount": 28,
      "adminCount": 2
    }
  ],
  "pagination": { "limit": 100, "offset": 0, "total": 1 }
}
```

Semester is 1–12, limit is 1–100, offset is 0–100,000. Ordering is section, class name, and stable class ID. Empty semesters return an empty list and total 0.

### Full class roster

Use `GET /api/classes/:id?limit=100&offset=0`. Existing class metadata, `myRole`, `members`, `pendingMembers`, `invite`, and pagination remain. Each active-membership entry includes:

```json
{
  "userId": "immutable-provider-uid",
  "displayName": "Student Name",
  "username": "student_name",
  "avatarVersion": null,
  "role": "student",
  "status": "active",
  "accountStatus": "active",
  "email": "2412339@szabist-isb.pk",
  "rollNumber": "2412339"
}
```

Email and roll number appear only for that class's admins and the owner. Ordinary members still see a minimal directory without those fields. Roll number is a display string derived from an all-digit mailbox on the exact university domain. Leading zeros are retained; staff-name mailboxes yield null. The immutable user ID is the reliable key for admin actions.

The class directory includes suspended accounts that still have active memberships, marked by `accountStatus`, so the owner can manage them. Its `memberCount`/`pagination.membersTotal` therefore describe the complete roster, unlike active-account enrollment totals in the semester summary. `pendingMembersTotal` is separately provided. Advance the same limit/offset to fetch subsequent pages.

### Owner overview

`GET /api/admin/overview` returns paginated `users`, `classes`, historical `requests`, and `audit`, plus:

```json
{
  "stats": {
    "users": 100,
    "classes": 3,
    "activeUsers": 98,
    "suspendedUsers": 2,
    "semesters": 2,
    "admins": 6,
    "pendingMemberships": 4,
    "legacyClassRequests": 0
  }
}
```

`admins` counts distinct active accounts with active admin membership in an active class. Other statistics use their named account/class/request scope. Historical class requests are not pending approvals. Profile objects include immutable ID, current name/username, email, derived roll number, global role, and account status. Pagination remains independently totaled for users/classes/history/audit.

## Migration and maintenance

Migration 5 rebuilds only the membership table with the new role constraint and indexes. It preserves IDs, foreign keys, timestamps, statuses, review actors, and join history while mapping both old CR and GR roles to admin. It removes the old one-CR/one-GR uniqueness restrictions. Original migrations 1–4 remain unchanged. Migration 6 adds timetable/deadline tables.

Migration 5 retains prior subjects/resources/announcements/profile-photo switches, replaces the Tutor flag with Developer, and enables the newly implemented timetable/deadline flags. Existing Tutor data remains legacy-only. See `OPERATIONS_API.md` for new settings and publication contracts.

Non-owner writes, including direct class creation and class management, are paused during read-only maintenance. Owner recovery remains available. Class creation, membership additions/removals/approvals, and role changes write audit events.
