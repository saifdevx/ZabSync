# Checkpoint 2: profiles, Tutor, and owner controls

All endpoints below require an authenticated, active account. Firebase requests must still satisfy the verified exact university-domain rule. Browser UI permissions do not replace backend checks.

## Profile customization

`GET /api/me` continues returning the checkpoint 1 shape. Its `user` includes two additions:

```json
{
  "id": "immutable-provider-uid",
  "email": "verified@szabist-isb.pk",
  "displayName": "Student Name",
  "username": "student_name",
  "avatarVersion": null,
  "role": "student",
  "status": "active"
}
```

`username` and `avatarVersion` are strings or null. User IDs and verified email addresses cannot be edited through the profile API. A username is a display handle, not an authentication identity, roll number, or permission.

`PATCH /api/me` accepts one or both of:

```json
{ "displayName": "Student Name", "username": "student_name" }
```

- Display names contain 2–80 characters.
- Usernames contain 3–24 ASCII letters, digits, or underscores. They are normalized to lowercase. A leading `@` is accepted and removed; `null` or an empty string clears the handle.
- Case-insensitive uniqueness is enforced by a database constraint and a transactional check. Reserved administrator/official names are rejected. Changing a handle never changes membership, the database user ID, or Firebase identity.
- Successful mutations return `{ "user": ... }`.
- Student-visible class rosters include optional username/avatar version, but continue to omit classmates' email addresses.

`POST /api/me/avatar` accepts multipart form data containing exactly one field named `file`, with a JPEG, PNG, or WebP image, up to **2 MiB**. Animated/multipage images and files over **16 megapixels** are rejected. The server decodes the image, applies orientation, resizes within 512×512, and re-encodes WebP without original metadata. Original bytes, original filenames, metadata, and arbitrary uploaded HTML/SVG are never served as the profile photo.

`DELETE /api/me/avatar` removes the current photo and returns the updated user. Users can remove their existing photo while the photo feature is disabled; uploading and viewing photos remain disabled. Read-only maintenance pauses removal as well as other non-owner changes.

`GET /api/users/:id/avatar` returns the WebP bytes with `Cache-Control: private, no-store`. A viewer must be the photo owner, an active member sharing an active class, or the Master Admin. The response is 404 for absent/disallowed photos. Fetch with the bearer token and turn the returned blob into a temporary object URL; a plain unauthenticated image URL cannot read it. Revoke object URLs when the account changes or the component unmounts.

The same private local/R2 storage adapter serves avatars and lecture resources. Old avatar keys enter a durable cleanup queue in the same transaction as replacement/removal. Cleanup retries on app startup and subsequent avatar changes. Storage operations and SQL cannot form one distributed transaction; a complete simultaneous database-and-storage outage can still require manual orphan-object reconciliation.

## Site settings

`GET /api/site` returns the non-sensitive settings visible to signed-in users. `GET /api/admin/settings` returns the same object but verifies the Master Admin role:

```json
{
  "settings": {
    "version": 1,
    "features": {
      "subjects": true,
      "resources": true,
      "announcements": true,
      "tutor": true,
      "profilePhotos": true
    },
    "maintenance": {
      "enabled": false,
      "message": "We are updating XVIA. You can read your classes while changes are paused."
    },
    "updatedAt": "2026-10-10T09:00:00.000Z"
  }
}
```

Only the Master Admin can `PATCH /api/admin/settings`:

```json
{
  "version": 1,
  "features": { "tutor": false },
  "maintenance": {
    "enabled": true,
    "message": "Updates are in progress. Class information is still available."
  }
}
```

- Supply the version you most recently read. A stale version returns 409 `settings_changed`; refresh and deliberately resubmit instead of overwriting somebody else's settings.
- `features` is a partial object; `maintenance`, if supplied, includes both `enabled` and a 1–500-character plain-text `message`.
- Unknown controls/keys are rejected. These flags control implemented modules. Adding an entirely new software capability requires a reviewed code change and deployment.
- Disabled modules reject their normal server API calls as well as disappearing from navigation. Master-only settings and draft Tutor editing remain available to turn features back on or prepare content.
- Missing or corrupt stored feature controls fail closed with 503; they do not silently enable access.

### Read-only maintenance

When maintenance is enabled, students and representatives can read existing content and use sign-in/recovery, but all application mutations return **503 `maintenance_mode`**, including direct API calls. The Master Admin retains controls so maintenance can be switched off. The UI must clearly describe this as read-only maintenance; it is not a guarantee that the entire deployment is offline or that previously downloaded files can be remotely recalled.

Register `registerMaintenanceGate` before API routes. Core handlers can also call `requireWritable` inside their write transaction to cover a maintenance setting changed concurrently with a request. Demo session creation and logout are exempt session operations. Provider sign-in/recovery is handled by Firebase.

## Tutor

The page starts as an empty **unpublished draft**. No real tutor identity, qualifications, prices, contact details, or promises are invented.

`GET /api/admin/tutor` returns:

```json
{
  "tutor": {
    "version": 1,
    "published": false,
    "title": "",
    "name": "",
    "bio": "",
    "subjects": [],
    "contactLabel": "",
    "contactUrl": "",
    "bookingUrl": "",
    "updatedAt": "2026-10-10T09:00:00.000Z"
  }
}
```

`PATCH /api/admin/tutor` requires `version`, with any subset of the remaining editable fields:

```json
{
  "version": 1,
  "title": "Study support",
  "name": "Your chosen tutor name",
  "bio": "Your own tutor biography.",
  "subjects": ["Databases"],
  "contactLabel": "Contact",
  "contactUrl": "https://example.org/contact",
  "bookingUrl": "",
  "published": true
}
```

The example is a format illustration and is not seeded into the app. Title/name max100, bio max4000, up to20 subjects of max80 characters each, contact label max80. Contact and booking links must be complete HTTPS URLs without embedded credentials or can be blank. The backend does not fetch those links. All descriptive content is plain text, without arbitrary HTML. Publishing requires nonempty title, name, and bio. Stale versions return409 `tutor_changed`.

`GET /api/tutor` returns `{ "tutor": null }` until published, or the published object. If the Tutor flag is off, the normal page API returns404 `feature_disabled` even for an owner; owners can still edit the draft in their admin panel.

## Account suspension

`PATCH /api/admin/users/:id/status` accepts `{ "status": "suspended" }` or `{ "status": "active" }` and returns the updated public user.

Only the database-authorized active Master Admin can act. The owner/self account is protected. Every subsequent authenticated request checks account status, including existing sessions, so suspension blocks access without relying on a frontend refresh. Reactivation restores the account's existing memberships and roles; it does not delete or recreate identities. If a representative is suspended, the owner can appoint another active class member through the existing representative controls.

Settings changes, Tutor publication/drafts, profile updates, avatar changes, suspension, and reactivation write audit events. This is not a provider-level deletion of a Firebase identity and does not revoke files somebody already downloaded.

## Request limits and campus Wi-Fi

Authenticated quotas use the **verified application user ID**, so classmates using the same Wi-Fi connection receive separate account limits. Refreshing a Firebase token, changing IP addresses, or supplying identity/forwarded headers does not reset an account's quota. Authentication results, including failures, are cached only for one request: the rate limiter, maintenance check, and route handler share that result; the next request rechecks current identity and account status.

| Limit                               | Key and behavior                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary authenticated API requests | 300 per minute per verified user across routes without a more specific limit.                                                                                                       |
| Public API requests                 | 600 per minute per observed peer IP, with endpoint-specific limits such as 30 per minute for the local demo session endpoint. Public endpoints do not invoke Firebase verification. |
| Failed/missing authentication       | 300 per minute per observed peer IP on ordinary routes; endpoint-specific lower limits still apply. Rotating invented bearer strings does not create new buckets.                   |
| Profile photo uploads               | 10 per minute per verified user.                                                                                                                                                    |
| Lecture uploads / downloads         | 20 uploads and 120 downloads per minute per verified user, each in its respective endpoint bucket.                                                                                  |
| Earlier class controls              | Existing limits remain: 10 class requests, 10 join attempts, and 15 invitation rotations per minute per verified user, in separate endpoint buckets.                                |
| Subjects / announcements creation   | 30 per minute per verified user for each creation endpoint.                                                                                                                         |
| Pre-authentication network guard    | 6,000 API requests per minute per observed peer IP, before body parsing or identity-provider work; bounds floods across API routes.                                                 |
| Static app files / OPTIONS          | Excluded from these application/API quotas and do not trigger identity verification.                                                                                                |

Limit responses use status429 and `Retry-After`. These are in-process limits: restarting the process resets them, and several server instances have separate counters. Deployments that grow to multiple instances should move quotas to shared storage or a suitably configured gateway. The broad network guard intentionally allows normal campus bursts, but must be tuned against real traffic before scaling. The server continues to distrust arbitrary `X-Forwarded-For` headers; a host proxy may therefore appear as one observed peer. Configure trusted proxy/gateway policies explicitly during deployment rather than accepting forwarded identities from any client.
