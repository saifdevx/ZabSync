# Checkpoint 1 verification record

Date: **10 October 2026**. This record describes the included Checkpoint 1 source and its local validation. It does not certify that an application cannot be hacked.

## Results

| Check                                                    | Result                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript client and server checks                      | Passed                                                                                                                                   |
| Production client bundle and compiled Node server        | Passed                                                                                                                                   |
| Automated API/security and UI integration suite          | 27 passed, 0 failed, 0 skipped                                                                                                           |
| Compiled application delivery                            | Home page, class deep link, JavaScript/CSS, favicon, supplied logos, and API behavior verified through injected HTTP requests            |
| Local setup script                                       | Created a demo `.env` without cloud accounts or credentials                                                                              |
| Migration command                                        | Created/upgraded the local schema without adding fictional identities                                                                    |
| npm dependency audit, including development dependencies | 0 known vulnerabilities reported at the time of validation                                                                               |
| Narrow-layout source review                              | Responsive breakpoints, mobile navigation, shrinking inputs, scrolling dialogs/tabs, text contrast, and reduced-motion behavior reviewed |

The backend and interface tests use temporary, isolated databases. The rendered component workflow uses jsdom and the actual React application. Only the fetch transport is adapted into Fastify's in-process request injection; the demo authentication, SQL storage, approval routes and permissions are real application code.

## Main workflows exercised

- Student access, exact university-email eligibility, verified-mailbox requirements, and role-header spoofing rejection.
- Student versus representative versus Master Admin boundaries, including access attempts against another class.
- Class request, Master Admin approval, requester promotion to CR, class editing, invitation generation and exact-code copying through the interface.
- Separate class membership approval and roster privacy for ordinary students.
- Invite rotation and seven-day expiry, tested with a fresh session after advancing the clock.
- Master-controlled representative handover, immediate application of new permissions to an existing session, one-CR integrity, and last-CR protection.
- Student removal revoking class access and retained membership request outcomes.
- Concurrent duplicate class requests producing one creation and one conflict instead of duplicate rows.
- Runtime demo guards for remote peers, unexpected origins and hostile Host headers; no production demo or test-verifier fallback.
- Additive schema migration and exclusion of seeded/automatically created memberships from join-request history.

The full individual tests and their limits are documented in [tests/README.md](../tests/README.md).

## Dependency choices

Dependencies are pinned in `package.json` and `package-lock.json`. TypeScript 5.9.3 is used as a portable JavaScript compiler; the newer native compiler could not run in this restricted validation environment.

An override pins the transitive `@grpc/grpc-js` dependency to **1.14.6**. The Firebase package otherwise pulled an older version through an unused Firestore dependency. The patched range was checked against the [maintainer's security advisory](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j), and the final audit reported no known vulnerabilities. Firebase Auth remains the authentication provider; Firestore is not the application's database.

A clean audit covers known advisories at that moment. It does not establish that the source, future dependencies, deployment, or provider configuration is free of defects. Recheck dependencies before the hosted release.

## Not verified in this environment

These checks still require the corresponding configured services or devices:

- **Live Firebase:** real service-account credentials, provider token verification and revocation, verification/reset email delivery, actual university inbox access, and provider password policy.
- **Remote Turso:** the owner's compatible libSQL database, authentication token, network behavior and persistent hosting configuration.
- **Rendered browser/phone layout:** desktop browser visual review, touch behavior, native dialog focus, narrow Android screenshots and actual screen-reader interaction. Simulated DOM tests do not measure layout or native clipboard behavior.
- **Network server startup on the owner's computer:** compilation and in-process HTTP behavior were checked; no public or preview listener was opened during validation.
- **Offline academic data:** timetable, deadlines, saved files and PWA reopening are scheduled for Checkpoint 3 and are not present in this checkpoint.
- **Load and release:** sustained concurrent-user performance, shared-campus-network rate limits, distributed hosting, backups, Android builds and Play submission are later release checks.

The UI and API work locally with fictional personas, but real-account access is not described as live-tested. Complete the [configuration checklist](CONFIGURATION_CHECKLIST.md) before inviting real students.

## Repeat the supported checks

After `npm ci` and `npm run setup:demo`:

```sh
npm run build
npm test
npm audit
```

The compiled assets in this ZIP allow the static-delivery test to run immediately. Building first ensures that the same test checks your latest source changes.
