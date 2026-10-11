# XVIA Checkpoint 2 verification suite

From the extracted project root, install the pinned dependencies, build, and run the suite:

```sh
npm ci
npm run build
npm test
```

Tests use Node's built-in runner. They can also run without the `tsx` CLI's IPC listener:

```sh
node --import tsx --test tests/*.test.ts tests/*.test.tsx
```

Build first so static-delivery checks use the actual current `dist/client` output. That test explicitly skips when no frontend build exists; it does not generate a fake build or treat missing build validation as success.

Tests use isolated temporary SQLite databases/private file directories under `tests/`, or an isolated in-memory database. Fixtures are removed afterward. They do not use the development database, contact university mailboxes, or send requests to live cloud providers. Multipart temporary files are removed by the upload lifecycle. Injected R2/storage failures are not live-provider tests.

See `docs/VERIFICATION.md` for final commands, outcomes, and remaining checks. This inventory describes coverage without fixing a total test count that could become stale.

## Backend and security inventory

| File                         | Coverage                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity-policy.test.ts`    | Exact domain/verified-email policy, malformed/lookalike addresses, teacher addresses, immutable UID, explicit owner setup, production demo refusal, fail-closed configuration, test-verifier restrictions.                                |
| `firebase-boundary.test.ts`  | Firebase-mode seam, unsupported claims rejected before account creation, no first-user owner inference, teacher accounts needing membership, no fallback to demo on real-auth failure.                                                    |
| `access-control.test.ts`     | Missing/invented sessions, spoofed identity/role headers, cross-class reads/edits, owner endpoints, minimal student rosters without peer emails or pending-request/invite details.                                                        |
| `class-workflow.test.ts`     | Separate owner class approval and representative membership approval, membership-ID audience matching, rejected requests, ordinary permissions, retained request outcomes.                                                                |
| `representatives.test.ts`    | Owner-only handover, immediate permissions on existing sessions, last-CR protection, member removal revoking access.                                                                                                                      |
| `invites.test.ts`            | Rotation and expiry, using fresh sessions after advancing time so an expired login cannot masquerade as invite enforcement.                                                                                                               |
| `demo-boundaries.test.ts`    | Loopback peer, Host, origin, and listener restrictions; forwarded headers cannot make a remote demo client local.                                                                                                                         |
| `concurrent-writes.test.ts`  | Concurrent duplicate requests produce one created request and one conflict without duplicate rows.                                                                                                                                        |
| `academic.test.ts`           | Subject CRUD/trash/restore; three announcement scopes; private resources/attachments; bookmarks/search/notifications; deleted-parent and removed-member visibility; feature switches; quota/storage failures; role changes during upload. |
| `academic-storage.test.ts`   | Valid PPTX metadata; malformed/macro/executable/traversal/unsafe-XML rejection; private opaque keys; header sanitization; R2 configuration; actual multipart rejection at 25 MiB + 1 byte.                                                |
| `operations.test.ts`         | Unique handles without identity changes; Tutor draft/publication/links; stale conflicts; feature controls; maintenance/recovery; suspension; decoded/private photos; cleanup retries and partial writes.                                  |
| `rate-limits.test.ts`        | Independent users on one IP; token rotation/forged headers do not reset quota; invalid identities use peer limits; static assets avoid identity work; invalid storage fails before database creation.                                     |
| `checkpoint-upgrade.test.ts` | Frozen Checkpoint 1 schema upgrades preserving accounts/classes/roles/invites/history; additive migrations 3/4; repeated migration; new profile/owner controls; foreign-key checks.                                                       |

### Academic cases with practical consequences

The academic tests exercise the actual API and database, checking that:

- Relevant global/class/subject notices appear while another class's content stays hidden from feeds/search.
- Students cannot publish class notices, and representatives cannot publish globally or manage another class.
- Private bytes require an authorized download; guessed public paths do not return lecture files.
- Trash hides downloads/attachments, restore returns them, and permanent removal reclaims storage.
- Parent deletion and membership removal affect feeds, bookmarks, downloads, and notifications consistently.
- Bookmarks never grant access independently of current membership.
- Read state is per account, and notice edits can make an item unread again.
- Feature toggles preserve data; notice text edits while resources are off can preserve hidden attachment links.
- Trash counts toward quota, rejected registration removes uploaded bytes, and roles are rechecked after storage upload.
- Failed permanent deletion remains hidden/retryable instead of permitting restoration of uncertain bytes.

Document-format acceptance is not antivirus verification. Tests do not establish that every accepted PDF/PPT/PPTX is harmless.

## React interface coverage

Both UI files render the actual React app, router, authentication state, and providers in **jsdom**. Fetch adapters call the actual Fastify application and SQLite database. External requests are rejected by the test transport.

`ui.test.tsx` retains the first-checkpoint workflow: Student requests a class through the form; Master approves it; the requester becomes CR, edits details, generates an invite, and copies the real code. It checks that class editing submits only permitted fields.

`checkpoint2-ui.test.tsx` covers a CR creating a subject/class notice; a student seeing that notice on Home without edit controls and bookmarking it; the owner saving a private Tutor draft then publishing it; the student seeing the published profile; and display-name/username changes plus photo upload/removal through real multipart decoding and private storage. Verified ID, email, and role remain unchanged.

jsdom needs small platform adapters for dialog open/close, clipboard, or object URLs. Those adapters do not validate browser focus, native downloads, CSS layout, animation smoothness, or touch usability. API/authentication responses in these flows are not replaced with static mock responses.

## PWA and static delivery coverage

`pwa.test.ts` runs the actual service-worker source in a VM harness with controlled network/cache APIs. It checks:

- Authenticated requests, APIs, authentication/file paths, mutations, and external origins bypass its cache.
- Only the public reconnect page and icon are cached.
- Online class navigation comes from the network and is not cached.
- Failed navigation returns public reconnect content while retry retains the requested route.
- Updates wait for an explicit message, and activation clears only this app's old public caches.
- Manifest names/icon dimensions match supplied bytes, and the SVG wrapper preserves the PNG.

The harness does not run a browser's service-worker lifecycle, installation criteria, OS icon chooser, or phone home-screen installation. Private academic stores, offline timetable, and offline saved files remain Checkpoint 3 and are not claimed by these tests.

`static-app.test.ts` serves the actual compiled frontend through `fastify.inject` without opening a network port. It checks current SPA deep links, JavaScript/CSS, branding, the manifest and actual declared icon dimensions, public fallback, stamped service worker, and JSON 404 responses for unknown APIs. Source-level worker checks/static delivery are separate from native-browser installation tests.

## Migration fixture and data protection

`fixtures/checkpoint1-schema.sql` freezes the previously delivered schema. The upgrade test does not rebuild the old fixture from today's `migrationOne`, which could otherwise let current code silently rewrite the expected historical schema. It captures old rows, migrates, checks preserved values/access, modifies new settings, and migrates again without losing changes.

This validates the tested SQL path. It does not replace backing up an actual user's database/private storage or validating remote Turso/R2 restoration. Follow `docs/UPGRADE_FROM_CHECKPOINT_1.md` for an existing installation.

## Live-provider and release boundary

Firebase integration starts with claims returned by the explicitly test-only verifier seam, then exercises real email policy, accounts, roles, and class access. Rejected verification stays rejected. This does not validate real credentials, Google's signature verification, email delivery, an actually revoked token, or mailbox recovery. Production rejects the injected verifier seam.

Remote Turso/R2, provider outages, browsers/phones, slow mobile networks, hosting proxy rules, multi-instance quotas, load behavior, Capacitor Android, signing, and store releases need separate configured environments/checks. No APK or live deployment is implied by a passing local suite. See `docs/INSTALL_AND_ANDROID.md` and the five-checkpoint roadmap for remaining acceptance work.
