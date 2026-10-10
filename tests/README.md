# Checkpoint 1 security tests

From the project root, after installing dependencies:

```sh
npm test
```

The suite uses Node's built-in test runner. It can also be invoked directly
without the `tsx` CLI's IPC listener, which is helpful in restricted execution
environments:

```sh
node --import tsx --test tests/*.test.ts tests/*.test.tsx
```

Tests create separate temporary SQLite databases beneath `tests/` and remove
them after completion. They do not use your development database or contact a
university account.

## What these tests exercise

- The actual Fastify application through `fastify.inject`, including its
  authentication and authorization handlers.
- Opaque server-issued demo sessions; missing, invented, and spoofed identity
  headers do not grant access.
- Student, CR, and GR boundaries across two independently seeded classes.
- Representative handover updates permissions on existing sessions, and the
  last CR cannot be removed or demoted without a replacement.
- Local demo mode rejects nonlocal peers, forged forwarded headers, foreign
  hostnames, unapproved browser origins, and public-listener configuration.
- Class requests that require master approval before the requester becomes CR.
- A separate invitation and representative approval step for new members.
- A membership identifier cannot be approved under a different class URL.
- Student rosters omit email addresses and hide real pending-member requests
  and invitation details.
- A user's join history retains approved, rejected, and removed decisions;
  seeded memberships and class-creator appointments are excluded.
- Rotated and expired invitation codes fail; fresh valid codes still work.
- Simultaneous duplicate class requests create one pending request and one
  conflict response, without duplicate records or database-error responses.
- Exact `szabist-isb.pk` domain checks, verified-email requirements, teacher
  addresses, and case-insensitive domain matching.
- Explicit owner bootstrap configuration, no first-user owner assignment,
  production demo refusal, and fail-closed Firebase configuration.

Invite expiry uses an injected clock. The test creates fresh login sessions
after advancing time, so a failure caused by an expired session cannot be
mistaken for correct invite-expiry enforcement.

## Frontend coverage

`ui.test.tsx` renders the actual application, authentication provider, toast
provider, and router in jsdom. Its fetch adapter sends requests to the real
Fastify application and SQLite database. The test signs in as a student,
requests a class through the form, switches to the master account and approves
it, switches back to the new CR, edits class details, generates an invitation,
and copies the actual code. It verifies that the edit form submits only the
five permitted class fields. Dialog open/close and clipboard APIs have small
jsdom platform adapters; authentication and API results are not mocked.

`static-app.test.ts` checks the actual `dist/client` build through Fastify
without opening a network port. It verifies SPA deep links, JavaScript, CSS,
branding images, and JSON 404 responses for unknown API routes. Run
`npm run build` before this check. This one test explicitly skips if no frontend
build exists; it does not substitute a fake build.

These checks verify component behavior and static delivery. They do not verify
browser rendering, CSS layout, real dialog focus behavior, or Android packaging.

## Firebase coverage boundary

The Firebase-mode integration tests start with a clean database and use the
application's explicitly test-only provider-verification seam. That seam returns
claims that a real Firebase Admin verifier would already have verified. The
tests then exercise the real university-email policy, account creation, role
lookup, and class-access routes. Rejected token-verifier results stay rejected;
they do not switch the application to demo authentication.

These tests do **not** validate live Firebase credentials, Google's signature
verification implementation, email delivery, OAuth consent, or a real user's
revoked Firebase token. Those checks require a correctly configured Firebase
project and authorized test accounts. The suite also does not test browser
layout, mobile packaging, or features scheduled after checkpoint 1.

The production application rejects the injected verifier seam. Never deploy a
test identity provider or use the local demo database for real accounts.
