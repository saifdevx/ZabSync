# Google Drive + private application storage

Checkpoint 4 implementation guide • ZabSync • 12 October 2026

## What is implemented

ZabSync keeps structured records (including chat text) in its SQL database. Profile photos and any explicitly configured fallback documents stay in the existing private local/R2 store. With Google Drive configured, newly uploaded course documents and videos use the publishing account's Google Drive by default.

Students still sign in with their verified university identity. A separate **Connect Google Drive** action in **My profile** lets the person choose a personal Gmail/Google account for storage. Firebase sign-in alone does not grant Drive access; the user must see Google's consent screen once. The app then stores an encrypted refresh token and reuses the connection while Google permits it. A student reading resources does not need a Drive connection. Only people who already have publication permission can publish a shared resource.

The original file stays a binary document or video; it is not converted to a Google Doc. The app uploads PDF, PPT, PPTX, DOC, DOCX, MP4 and WebM. It does not accept arbitrary executables, macro-enabled Office extensions, HTML or ZIP uploads as resources. Office package and media container checks are useful format validation; they are not an antivirus scanner. Legacy DOC/PPT checks inspect their container signature. Downloaded documents remain untrusted documents and are delivered as attachments.

No public sharing permission is created. Authorized students download through the existing ZabSync resource endpoint, which checks current section/subject membership before opening the uploader's private file. The browser never receives a Drive access/refresh token, private upload-session URL or public Drive share link. The original binary revision is pinned; a file changed directly in Drive is refused until the Class Admin publishes its updated version through ZabSync.

## Important ownership and cost consequences

- One published file is stored once in its uploader's Google Drive, rather than copied to every student's Drive. Reader accounts are not charged storage simply for reading or downloading a shared resource.
- This reduces the owner's R2 document storage. Downloads still pass through the application server, so Render bandwidth remains relevant. It is not a zero-bandwidth architecture.
- If the uploader deletes/trashes the file, disables downloads, revokes access, loses the account or disconnects Drive, online downloads can stop. The uploader must restore/reconnect or an admin must re-upload a replacement. Copies students already downloaded cannot be remotely recalled.
- Appointing a new Class Admin does not transfer personal Drive file ownership. Before a representative leaves, arrange an explicit content handover. A new admin can upload approved replacement files using their own Drive, then remove obsolete records through the app. Automatic cross-account Drive ownership transfer is not implemented.
- While an account has tracked files, it must reconnect the same Google storage identity. Switching accounts is blocked to avoid silently stranding old files. One Google storage identity links to only one ZabSync identity.
- Disconnect immediately removes the encrypted refresh token from ZabSync and attempts Google revocation. It does not delete the person's files. The UI reports if Google could not confirm revocation. A user can additionally remove access in their Google Account's third-party connections.
- Google imposes API, transfer and storage limits. Provider quota errors are shown clearly. Upload failures never silently switch to R2 or local storage.

## Set up your own Google Cloud project

Do this only when setting up Firebase-mode staging or production. No live Google OAuth credentials or account were configured during code delivery.

1. In your chosen Google Cloud project, enable **Google Drive API**.
2. Configure the Google Auth Platform consent screen for **ZabSync**, including your real support/developer email, app homepage, privacy policy and any required authorized domains.
3. Request only `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`. Do not request full `drive`, full `drive.readonly`, Gmail/mail access or unrelated scopes.
4. Create an OAuth **Web application** client. Its client secret belongs on the server. This OAuth client is separate from the public Firebase web configuration.
5. Add the exact server callback: `https://YOUR-APP-HOST/oauth/google-drive/callback`. Development can use `http://localhost:3001/oauth/google-drive/callback` with the frontend at `http://localhost:5173`. Use the same hostname (`localhost`, not a mixture of `localhost` and `127.0.0.1`) so the browser-binding cookie works. Vite proxies `/oauth` as well as `/api` for local development.
6. In testing, add approved test users. Google's external **Testing** status generally makes refresh tokens expire after seven days when requesting Drive scopes. Complete the appropriate publishing/verification process before relying on the connection for a university-wide release. A narrow non-sensitive scope reduces scope exposure but does not remove every consent-screen, branding or verification requirement.
7. Set the private environment variables below and restart the server. Do not put them in GitHub, client code, a context file or screenshots.
8. Sign in with an eligible verified ZabSync account. Open **My profile → Google Drive → Connect Google Drive**, choose the storage account, and consent.
9. As a Class Admin, upload a small test resource in a subject. Confirm it appears in that Google account, that a same-subject student can download, and that another section cannot. Test revoked permission and reconnect before inviting the pilot class.

```dotenv
# Existing small-file/private store. In hosted Firebase mode use R2.
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_BUCKET=your_private_bucket
R2_ACCESS_KEY_ID=your_private_access_key
R2_SECRET_ACCESS_KEY=your_private_secret

# Web OAuth client: server only. Never prefix these with VITE_.
GOOGLE_DRIVE_CLIENT_ID=your-web-client.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=your-private-client-secret
GOOGLE_DRIVE_REDIRECT_URI=https://YOUR-APP-HOST/oauth/google-drive/callback
DRIVE_RETURN_URL=https://YOUR-APP-HOST/account
DRIVE_TOKEN_ENCRYPTION_KEY=standard-base64-of-32-random-bytes

# With complete Drive configuration, drive is already the default.
RESOURCE_STORAGE=drive
BASE_STORAGE_LIMIT_MIB=8192
RESOURCE_MAX_DOCUMENT_MIB=25
RESOURCE_MAX_VIDEO_MIB=100
CLASS_STORAGE_MIB=500
```

Generate the encryption key privately using Node's `crypto.randomBytes(32).toString('base64')`. Store the same key in your protected recovery material; changing it without re-encrypting stored credentials makes those credentials unreadable. The key is not stored in the SQL database. Do not substitute a memorable password.

For the local demo, leave every Google Drive credential unset, use `STORAGE_DRIVER=local`, and omit `RESOURCE_STORAGE` or set it to `base`. Cloud Drive is deliberately refused in demo mode. Real Google consent requires Firebase-mode identities and a separate clean real-account database.

## Existing files and deliberate fallback

The migration preserves every existing `resources.storage_key`. New Drive objects have a separate mapping from that exact key to a private Google file ID and its owning connection. Reads and deletion use this persisted mapping, never today's default. Existing R2/local files continue working; changing `RESOURCE_STORAGE` does not move them.

Set `RESOURCE_STORAGE=base` only as an explicit operator choice for future document uploads. Keep the original base-storage driver, bucket, and local objects available for older records. Switching from a local store to R2 also requires transferring the existing objects; changing the environment alone is not a migration.

R2 stays private. A Drive outage, full personal account or failed OAuth attempt must not unexpectedly consume the owner's Cloudflare budget.

## Limits, accounting and cleanup

- Documents default to 25 MiB; videos default to 100 MiB. Configurable upper bounds are 100 MiB for documents and 500 MiB for video. Uploads use a bounded private disk spool and streaming provider requests. They are not accumulated as a full-file server Buffer.
- The class's logical resource allowance defaults to 500 MiB, including trashed resources, and is configurable. It applies regardless of the provider.
- Private base storage defaults to an 8 GiB application-managed budget. Durable SQL reservations count simultaneous in-progress uploads, retained resources and avatars. Drive documents do not consume this base ledger.
- The migration backfills older resource sizes exactly. Previous photos have no stored size column, so each is initially counted conservatively at 2 MiB until replaced or deleted. Newly written photos are counted at their actual stored size.
- The app's ledger covers managed objects. It cannot see unrelated objects, provider revisions or external backups you manually keep in the same bucket/account. Review provider totals and configure provider alerts too. Alerts do not enforce a spending ceiling.
- `/api/admin/storage/usage` is owner-only and returns aggregate base/Drive usage and outstanding-operation counts. It does not list students' personal Google emails or credentials.
- Owner cleanup is explicit: `POST /api/admin/storage/cleanup` with `{ "confirm": true, "limit": 10 }`. It considers at most 50 tracked objects per call and only unreferenced objects older than one hour. It never scans or deletes arbitrary Drive files. A failed deletion stays tracked so accounting is not falsely reduced. Reconnect the uploader and retry when consent was revoked.
- Drive originals and their pinned revisions consume the uploader's Google account storage. Permanent deletion through ZabSync deletes that tracked original; moving a resource to the app's trash does not immediately remove its storage object.

## Security boundaries

The OAuth state is random, single-use, expires after ten minutes, and is stored as a hash. It is tied to the starting user and to a host-only HttpOnly SameSite=Lax cookie. HTTPS adds Secure; production requires same-origin frontend/callback. PKCE binds the authorization code exchange. Redirect/return targets are configured and validated, and the callback never accepts a user-supplied destination.

Refresh tokens and incomplete upload-session capabilities use AES-256-GCM with random nonces and authenticated data bound to the user or object. Access tokens remain in a bounded process memory cache behind an authoritative connection-status/revision check. Secrets and provider response bodies are never returned in application errors or logs. Provider calls use fixed Google endpoints; redirects are disabled and resumable-session locations must match the expected Google HTTPS host and path. Explicit transport injection is accepted only in Firebase-mode tests.

The connect callback rechecks active account status and maintenance. Account disconnect invalidates pending connection states and increments the connection revision. Public callback responses only redirect to the trusted account page with a fixed success/error status; no code or token is copied into that destination.

Back up the SQL mappings and encrypted connections together with the private encryption key recovery procedure. Database backups alone cannot restore a deleted user-owned Drive file. Test the restore and representative-handover procedures with the actual Google account setup.

## Validation delivered versus remaining live checks

The code contains focused tests for encryption/AAD, one-use browser state, PKCE, expired/suspended consent, role-gated endpoints, explicit fallback routing, private revision downloads, provider errors, changed files, revoked consent, non-public uploads, bounded streams, storage quotas, orphan cleanup and malicious session URLs. Those tests use a trusted in-process Google response stub; they do not prove live Google approval or actual provider connectivity.

Before production, check the exact OAuth client/consent publishing state, Google permission behavior on real accounts, a real R2 bucket, HTTPS cookies on target browsers, slow/large upload timeouts, hosted bandwidth and user-device downloads. Android wrapper OAuth must open the permitted system browser flow and return to the correct app; that device integration remains a Checkpoint 5 validation gate.

## Official references

Verified 12 October 2026:

- [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth refresh-token expiration, including external Testing](https://developers.google.com/identity/protocols/oauth2)
- [Drive uploads and resumable sessions](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Private Drive downloads and binary revisions](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [Drive file metadata, checksums and head revision](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
