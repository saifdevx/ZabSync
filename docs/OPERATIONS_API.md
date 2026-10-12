# Checkpoint 3: profiles, Developer, and owner controls

All endpoints below require an authenticated, active account. Ordinary Firebase accounts must satisfy the verified exact university-domain rule. A separately configured external owner is the sole exception and must match both its verified email and the server-pinned Firebase UID; see [OWNER_ACCOUNT.md](OWNER_ACCOUNT.md). Browser UI permissions do not replace backend checks.

## Profile customization

`GET /api/me` returns the authenticated profile, active class memberships, historical join/class requests, and an authoritative `canCreateClass` boolean. Its `user` includes:

```json
{
  "id": "immutable-provider-uid",
  "email": "2412339@szabist-isb.pk",
  "rollNumber": "2412339",
  "displayName": "Student Name",
  "username": "student_name",
  "avatarVersion": null,
  "role": "student",
  "status": "active"
}
```

`username`, `avatarVersion`, and `rollNumber` are strings or null. Roll number is derived only from an all-digit mailbox on the exact university domain; names used in staff addresses produce null. It is display metadata, never enrollment proof or a permission. User IDs and verified email addresses cannot be edited through the profile API. A username is a display handle, not an authentication identity, roll number, or permission.

`PATCH /api/me` accepts one or both of:

```json
{ "displayName": "Student Name", "username": "student_name" }
```

- Display names contain 2–80 characters.
- Usernames contain 3–24 ASCII letters, digits, or underscores. They are normalized to lowercase. A leading `@` is accepted and removed; `null` or an empty string clears the handle.
- Case-insensitive uniqueness is enforced by a database constraint and a transactional check. Reserved administrator/official names are rejected. Changing a handle never changes membership, the database user ID, or Firebase identity.
- Successful mutations return `{ "user": ... }`.
- Student-visible class rosters include optional username/avatar version, but continue to omit classmates' email addresses and roll numbers. Authorized class admins and the owner can see those fields in their class directory.

`POST /api/me/avatar` accepts multipart form data containing exactly one field named `file`, with a JPEG, PNG, or WebP image, up to **2 MiB**. Animated/multipage images and files over **16 megapixels** are rejected. The server decodes the image, applies orientation, resizes within 512×512, and re-encodes WebP without original metadata. Original bytes, original filenames, metadata, and arbitrary uploaded HTML/SVG are never served as the profile photo.

`DELETE /api/me/avatar` removes the current photo and returns the updated user. Users can remove their existing photo while the photo feature is disabled; uploading and viewing photos remain disabled. Read-only maintenance pauses removal as well as other non-owner changes.

`GET /api/users/:id/avatar` returns the WebP bytes with `Cache-Control: private, no-store`. A viewer must be the photo owner, an active member sharing an active class, or the Master Admin. The response is 404 for absent/disallowed photos. Fetch with the bearer token and turn the returned blob into a temporary object URL; a plain unauthenticated image URL cannot read it. Revoke object URLs when the account changes or the component unmounts.

The same private local/R2 storage adapter serves avatars and lecture resources. Old avatar keys enter a durable cleanup queue in the same transaction as replacement/removal. Cleanup retries on app startup and subsequent avatar changes. Storage operations and SQL cannot form one distributed transaction; a complete simultaneous database-and-storage outage can still require manual orphan-object reconciliation.

## Site settings

`GET /api/site` returns the non-sensitive settings visible to signed-in users. `GET /api/admin/settings` returns the same object but verifies the Master Admin role:

```json
{
  "settings": {
    "version": 2,
    "features": {
      "subjects": true,
      "resources": true,
      "announcements": true,
      "developer": true,
      "profilePhotos": true,
      "timetable": true,
      "deadlines": true
    },
    "maintenance": {
      "enabled": false,
      "message": "We are updating ZabSync. You can read your classes while changes are paused."
    },
    "updatedAt": "2026-10-10T09:00:00.000Z"
  }
}
```

Only the Master Admin can `PATCH /api/admin/settings`:

```json
{
  "version": 2,
  "features": { "developer": false },
  "maintenance": {
    "enabled": true,
    "message": "Updates are in progress. Class information is still available."
  }
}
```

- Supply the version you most recently read. A stale version returns 409 `settings_changed`; refresh and deliberately resubmit instead of overwriting somebody else's settings.
- `features` is a partial object; `maintenance`, if supplied, includes both `enabled` and a 1–500-character plain-text `message`.
- Unknown controls/keys are rejected. These flags control implemented modules. Adding an entirely new software capability requires a reviewed code change and deployment.
- Disabled modules reject their normal server API calls as well as disappearing from navigation. Master-only settings and draft Developer editing remain available to turn features back on or prepare content.
- Missing or corrupt stored feature controls fail closed with 503; they do not silently enable access.

### Read-only maintenance

When maintenance is enabled, students and class admins can read existing content and use sign-in/recovery, but all application mutations return **503 `maintenance_mode`**, including direct API calls. The Master Admin retains controls so maintenance can be switched off. The UI must clearly describe this as read-only maintenance; it is not a guarantee that the entire deployment is offline or that previously downloaded files can be remotely recalled.

Register `registerMaintenanceGate` before API routes. Core handlers can also call `requireWritable` inside their write transaction to cover a maintenance setting changed concurrently with a request. Demo session creation and logout are exempt session operations. Provider sign-in/recovery is handled by Firebase.

## Developer

The Developer page starts as a blank, **unpublished draft**. The owner supplies all names, biography, portfolio links, project descriptions, and update notes; no real claims or promotional content are invented. Previously saved Tutor data remains in a legacy table and is not copied or published here.

`GET /api/admin/developer` returns:

```json
{
  "developer": {
    "version": 1,
    "published": false,
    "title": "",
    "name": "",
    "bio": "",
    "portfolioUrl": "",
    "updatesText": "",
    "apps": [],
    "updatedAt": "2026-10-11T09:00:00.000Z"
  }
}
```

Only the active database-authorized Master Admin can read or edit this draft. `PATCH /api/admin/developer` requires `version`, plus any subset of these editable fields:

```json
{
  "version": 1,
  "title": "About the developer",
  "name": "Your chosen name",
  "bio": "Your own biography.",
  "portfolioUrl": "https://example.org/portfolio",
  "updatesText": "An update you choose to share.",
  "apps": [
    {
      "name": "Your project",
      "description": "Your own description of the project.",
      "url": "https://example.org/project"
    }
  ],
  "published": true
}
```

These values illustrate the format and are not seeded into the application.

| Field                | Validation                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `title`, `name`      | Plain text, maximum 100 characters each.                                                                                   |
| `bio`, `updatesText` | Plain text, maximum 4,000 characters each; newlines are allowed.                                                           |
| `portfolioUrl`       | Complete HTTPS URL without embedded credentials or whitespace/control characters, maximum 2,000 characters; blank allowed. |
| `apps`               | Maximum 12 entries; replacing this field replaces the list.                                                                |
| App `name`           | Required plain text, 1–80 characters.                                                                                      |
| App `description`    | Plain text, maximum 1,000 characters; blank allowed.                                                                       |
| App `url`            | Required complete HTTPS URL without embedded credentials or whitespace/control characters, maximum 2,000 characters.       |
| `published`          | Boolean. Publishing requires nonempty title, name, and biography.                                                          |

All objects reject unknown fields. Descriptive strings reject HTML and dangerous control characters. The server does not fetch the supplied URLs. Stale versions return **409 `developer_changed`**; refresh and review before saving again.

`GET /api/developer` returns `{ "developer": null }` until published, or the published object. If the Developer flag is off, normal page requests return **404 `feature_disabled`** for every role; the owner can still edit the draft in the admin panel. A draft is never disclosed to students or class admins.

The old `GET /api/tutor` and owner-only `GET/PATCH /api/admin/tutor` return **410 `feature_retired`**. They cannot expose or publish legacy Tutor content.

## Account suspension

`PATCH /api/admin/users/:id/status` accepts `{ "status": "suspended" }` or `{ "status": "active" }` and returns the updated public user.

Only the database-authorized active Master Admin can act. The owner/self account is protected. Every subsequent authenticated request checks account status, including existing sessions, so suspension blocks access without relying on a frontend refresh. Reactivation restores the account's existing memberships and roles; it does not delete or recreate identities. If a class admin is suspended, the owner can appoint another active member through the class-role controls documented in `ROLE_ADMIN_API.md`. A class may have multiple admins.

Settings changes, Developer publication/drafts, profile updates, avatar changes, suspension, and reactivation write audit events. This is not a provider-level deletion of a Firebase identity and does not revoke files somebody already downloaded.

## Request limits and campus Wi-Fi

Authenticated quotas use the **verified application user ID**, so classmates using the same Wi-Fi connection receive separate account limits. Refreshing a Firebase token, changing IP addresses, or supplying identity/forwarded headers does not reset an account's quota. Authentication results, including failures, are cached only for one request: the rate limiter, maintenance check, and route handler share that result; the next request rechecks current identity and account status.

| Limit                               | Key and behavior                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary authenticated API requests | 300 per minute per verified user across routes without a more specific limit.                                                                                                       |
| Public API requests                 | 600 per minute per observed peer IP, with endpoint-specific limits such as 30 per minute for the local demo session endpoint. Public endpoints do not invoke Firebase verification. |
| Failed/missing authentication       | 300 per minute per observed peer IP on ordinary routes; endpoint-specific lower limits still apply. Rotating invented bearer strings does not create new buckets.                   |
| Profile photo uploads               | 10 per minute per verified user.                                                                                                                                                    |
| Lecture uploads / downloads         | 20 uploads and 120 downloads per minute per verified user, each in its respective endpoint bucket.                                                                                  |
| Earlier class controls              | Limits: 10 direct class creations, 10 join attempts, and 15 invitation rotations per minute per verified user, in separate endpoint buckets.                                        |
| Subjects / announcements creation   | 30 per minute per verified user for each creation endpoint.                                                                                                                         |
| Pre-authentication network guard    | 6,000 API requests per minute per observed peer IP, before body parsing or identity-provider work; bounds floods across API routes.                                                 |
| Static app files / OPTIONS          | Excluded from these application/API quotas and do not trigger identity verification.                                                                                                |

Limit responses use status429 and `Retry-After`. These are in-process limits: restarting the process resets them, and several server instances have separate counters. Deployments that grow to multiple instances should move quotas to shared storage or a suitably configured gateway. The broad network guard intentionally allows normal campus bursts, but must be tuned against real traffic before scaling. The server continues to distrust arbitrary `X-Forwarded-For` headers; a host proxy may therefore appear as one observed peer. Configure trusted proxy/gateway policies explicitly during deployment rather than accepting forwarded identities from any client.
