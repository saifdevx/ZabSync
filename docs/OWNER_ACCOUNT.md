# Set up a separate Master Admin account

ZabSync supports one dedicated owner account. You can use a Gmail address for that account and keep your university account independent for student or Class Admin use. The owner opens the **Owner dashboard** and manages the semester → section → student directory. The university account sees its own enrolled classes and receives Class Admin controls only after an explicit appointment.

This does not enable Gmail student registration. Ordinary application accounts must still have a verified `@szabist-isb.pk` email. The one external owner is admitted only when **both** its verified Firebase email and immutable Firebase UID match private server settings.

## What the two accounts can do

| Account                          | How it receives authority                                                                   | Workspace                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Separate owner, optionally Gmail | Exact server-configured email and UID; verified Firebase identity; one database Master role | Online Master console, all sections, account controls, announcements, Developer and app settings |
| Your university account          | Verified university email; enrollment and Class Admin appointment are separate              | Its enrolled classes, student tools, and authorized Class Admin controls                         |
| Other university students        | Verified university email plus class enrollment                                             | Read shared class content; use personal profile, saved items and completion controls             |
| Other external email addresses   | No eligible identity                                                                        | Rejected by the API, even if a Firebase account exists                                           |

Students cannot create classes or post, edit, remove or restore shared subjects, lectures, announcements, timetable entries, dated changes or deadlines. Personal profile changes, bookmarks and marking their own assignment complete remain available. An admin of one class has no editing authority in another class without its own admin membership.

Owner-created classes begin with zero members. The Master is not enrolled automatically and cannot self-join, be enrolled or receive a class role. Use your separate university account to participate in a class. An active Class Admin who creates a new class is enrolled as that class's admin.

Existing memberships from previous checkpoints or an explicit ownership transfer are preserved. The upgrade does not silently remove historical records. The normal `/api/me.classes` and `GET /api/classes` lists remain enrolled-only even for an owner with historical memberships; the Master console uses the separate global directory. Owner offline preparation is disabled; use your university account for student offline features.

## 1. Complete Firebase configuration

Follow [CONFIGURATION_CHECKLIST.md](CONFIGURATION_CHECKLIST.md) to create your Firebase project, enable Email/Password authentication, register the web app, configure authorized domains and provide server-side Firebase Admin credentials. Use a separate real-account database; do not convert the demonstration database into your production identity database.

The owner uses Firebase Email/Password authentication for this application. A Gmail email address does **not** mean you enter your Gmail mailbox password. Choose a new password for ZabSync. A Google OAuth sign-in button is not part of this checkpoint.

## 2. Create and pin the intended owner identity

For an external owner:

1. Open your project's Firebase Console → **Authentication → Users**.
2. Add the intended owner with its exact email and a strong application-specific password. The public student registration form intentionally does not register Gmail accounts.
3. Copy that user's Firebase **UID**. It is a stable provider identity, not a roll number, class ID, username or browser role.
4. In the private server `.env`, set both values. Replace the placeholders yourself:

```dotenv
AUTH_MODE=firebase
MASTER_ADMIN_EMAIL=YOUR_EXACT_OWNER_EMAIL
MASTER_ADMIN_UID=THE_EXACT_FIREBASE_UID_FOR_THAT_EMAIL
```

An external email without a UID pin causes startup to fail. A university owner is still supported for existing installations; pinning its UID is recommended too. For an ownership transfer, both values are always required, including when the target is a university account.

These settings are server-only. Do not prefix them with `VITE_`, put them in the browser bundle, paste them into a Developer biography or commit your private configuration to GitHub. The public `/api/config` response exposes neither configured value.

The email is normalized for case. It must otherwise match exactly: a plus-address alias, different spelling, other Gmail account, different UID, domain lookalike or unverified token is rejected. The application does not grant roles from the displayed name, a submitted role field, local browser data or the first person to sign in.

## 3. First setup when the database has no owner

Use this section only for an installation that has no existing Master account.

After finishing the Firebase/database configuration, run from the project directory:

```sh
npm run db:migrate
npm run dev
```

For an already built local application, use the existing `npm start` instructions instead of `npm run dev`. Do not start a second server on the same port.

At the sign-in screen choose **Owner sign-in** and sign in using the exact owner email and its Firebase application password. If Firebase reports that the email is not verified, use the app's verification email action, open the message in the intended inbox, then refresh verification or sign in again. The API will not admit the account until the provider's token carries verified-email proof. Email ownership is established through Firebase; typing the same email into a form is insufficient.

The matching account becomes Master only if the database has no existing Master. This is recorded as `owner.bootstrapped` in the audit log. An ordinary university user can sign in before the owner without receiving any owner powers.

Once signed in:

1. Open **Owner dashboard** and create the first class in the semester directory.
2. Sign in at least once with the separate university account, using the normal student sign-in/registration path.
3. Return to the owner account, choose the semester and section, and open **People → Enroll a student**.
4. Enroll that registered university account, then appoint it as a **Class Admin** using its class role control.

The two accounts retain different Firebase UIDs. The university account never inherits the owner's global role, and appointing it in one section does not grant authority over every section.

## 4. Moving ownership from an existing account

Changing `MASTER_ADMIN_EMAIL` or `MASTER_ADMIN_UID` does **not** transfer an existing database's owner role. In particular, a newly configured external owner receives `403 owner_transfer_required` while another Master exists; the failed sign-in does not create an application account or modify roles. Your existing eligible university owner remains authoritative until a controlled transfer succeeds.

The project provides an explicit **server operator command**, not a browser endpoint. Do not manually rewrite user IDs, delete the old owner, clear the database or change a student to `master` in browser storage.

### Prepare the intended target

Create the target account in the same Firebase project, verify its inbox and copy its UID. For an external owner, **Owner sign-in** can sign in to Firebase and present the unverified-email flow before the protected API accepts the account. After verification, an existing database owner still prevents automatic takeover; continue with the command below. Verification does not itself authorize the transfer.

The target must be enabled in Firebase. If the target already has an application account, it must also be active there. Its email must not belong to another application UID.

### Stop, back up and preview

1. Stop the running application. Keep a current restorable backup of the real database and private file storage; preserve the previous private owner configuration for recovery.
2. Record the **current owner's exact Firebase UID** from Firebase or the existing owner directory. The command requires this value as a guard against changing the wrong owner or wrong database.
3. Point the private server settings at the **existing real database**, the same Firebase project, and the **intended new** `MASTER_ADMIN_EMAIL` and `MASTER_ADMIN_UID`. Do not change the database URL to a new empty database.
4. Ensure that database has the current checkpoint schema. If upgrading an older real database, run the documented schema migration first after backing up. The transfer command itself never runs migrations or seeds identities.
5. Preview the transfer:

```sh
npm run owner:transfer -- --from-uid "CURRENT_OWNER_FIREBASE_UID"
```

The default is a read-only preview. It queries the target using the Firebase Admin SDK, verifies its enabled/verified state and both configured identity values, then checks the current owner in the database. It prints the old and intended new identity to your private terminal so you can review the concrete change. It does not insert an account, change a role or write an audit event. A missing local database path is rejected without creating a replacement database.

Check that both identities and the database configuration are the intended ones. To apply that exact transfer:

```sh
npm run owner:transfer -- --from-uid "CURRENT_OWNER_FIREBASE_UID" --apply
```

The apply command rechecks the current owner inside one database write transaction. It changes the former owner's global role to `student`, creates or updates the intended owner account as `master`, and adds one `owner.transferred` audit entry identifying the prior owner and the server-command source. A failure rolls the transaction back, including any role changes. The unique Master constraint continues to allow only one owner. A repeated or stale `--from-uid` fails rather than transferring from an unexpected account.

The transfer preserves all class IDs, content, memberships, join history and profile data of existing accounts. Class roles remain as recorded: for example, the former university owner may remain a Class Admin in a previously enrolled class. No class admin role is created merely because ownership changed. Firebase account passwords are not altered.

Restart the application with the new private owner configuration. Sign in to the new owner account and check the Master console. The old university account's already issued token follows its new database role on the next API request; it no longer authorizes owner actions. A former external owner no longer matches the configured external exception and cannot sign in as an ordinary student.

If an accidental transfer must be reversed, stop the app and use the same reviewed procedure with the intended previous owner as the target and the **current** owner's UID as `--from-uid`. Both identities must still satisfy verification, enabled-account and conflict checks. There is no automatic rollback based only on editing the environment.

## Troubleshooting and verification

| Result                                                     | Meaning and next action                                                                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup says an external email requires `MASTER_ADMIN_UID` | Copy the exact target UID from the same Firebase project and restart.                                                                                       |
| `email_not_verified`                                       | Verify the intended inbox, then refresh Firebase verification/sign in again.                                                                                |
| `university_email_required` for Owner sign-in              | The token is neither an eligible university identity nor the exact configured external email and UID. Check private values and Firebase project.            |
| `owner_transfer_required`                                  | Another Master already exists. Use the controlled command; changing configuration does not replace that owner.                                              |
| `owner_source_mismatch`                                    | The actual current owner differs from `--from-uid`, or this database has no existing owner. Do not guess; inspect the intended database and identity first. |
| `identity_conflict`                                        | One email maps to a different stored UID. Resolve the underlying Firebase/application identity conflict before proceeding.                                  |
| `owner_membership_forbidden`                               | The Master account is being enrolled or assigned a class role. Use the separate university account.                                                         |

For command syntax without opening Firebase or the database, run `npm run owner:transfer -- --help`.

The isolated backend tests cover matching and mismatching owner claims, private configuration, denial of silent owner substitution, preview without writes, transactional rollback on an audit failure, preserved history, immediate role changes on existing tokens, enrolled-only lists and denied student shared-content writes. They do not claim a live login, email delivery or transfer against your Firebase project. Complete a small real-account pilot using [CONFIGURATION_CHECKLIST.md](CONFIGURATION_CHECKLIST.md) before inviting a class.

Firebase references for provider setup: [Admin user management](https://firebase.google.com/docs/auth/admin/manage-users), [ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), and [email verification](https://firebase.google.com/docs/auth/web/manage-users#send_a_user_a_verification_email).
