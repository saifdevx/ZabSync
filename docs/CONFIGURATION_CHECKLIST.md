# Configuration checklist

Use [START_HERE.md](START_HERE.md) first. **You do not need any provider account to try the local demonstration.** This guide prepares the optional real-account mode; it is not an instruction to publish Checkpoint 2 to real students.

## A. Local demonstration

- [ ] Node.js 24 and npm work in a new terminal.
- [ ] You extracted the source ZIP and opened the folder containing `package.json`.
- [ ] `npm ci` finished successfully.
- [ ] `npm run setup:demo` created your local configuration.
- [ ] `npm run dev` runs and `http://localhost:5173` opens.
- [ ] You can switch among the four fictional personas.

The demonstration uses `AUTH_MODE=demo`, loopback hosting, and a file-backed SQL database. It makes no verification-email requests. Its sample university-looking email addresses are fictional fixtures.

## B. Know which settings are private

The project reads its configuration from `.env` in the project root. `.env.example` lists the supported settings and contains no live credentials. Add missing lines from that example to your private `.env` when configuring a provider; the demo setup writes only the settings it needs. Stop and restart the application after changing `.env`.

| Variable                                         | Purpose                                              | Where to obtain it                                        |
| ------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| `AUTH_MODE`                                      | `demo` or `firebase`                                 | You choose the mode                                       |
| `NODE_ENV`                                       | `development`, `test`, or `production`               | Keep `development` while working locally                  |
| `HOST`                                           | Server bind address                                  | Keep `127.0.0.1` for local use                            |
| `PORT`                                           | API/compiled-app port                                | Default `3001`                                            |
| `ALLOWED_ORIGINS`                                | Exact permitted browser origins, separated by commas | Local URLs are provided; hosted URLs are configured later |
| `DATABASE_URL`                                   | Local SQL file or compatible remote libSQL URL       | Local value is provided; remote value comes from Turso    |
| `DATABASE_AUTH_TOKEN`                            | **Private** remote database credential               | Turso; empty for a local file                             |
| `MASTER_ADMIN_EMAIL`                             | Explicit initial owner account                       | Your own university email, chosen by you                  |
| `FIREBASE_API_KEY`                               | Public Firebase web project identifier               | Firebase web-app configuration                            |
| `FIREBASE_AUTH_DOMAIN`                           | Firebase authentication domain                       | Same web-app configuration                                |
| `FIREBASE_PROJECT_ID`                            | Firebase project ID                                  | Same web-app configuration                                |
| `FIREBASE_APP_ID`                                | Firebase web-app ID                                  | Same web-app configuration                                |
| `FIREBASE_USE_APPLICATION_DEFAULT`               | Use server-side Application Default Credentials      | Set `true` for the JSON-file method below                 |
| `GOOGLE_APPLICATION_CREDENTIALS`                 | Path to your **private** service-account JSON        | The private file you downloaded from Firebase             |
| `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Alternative private Admin credential values          | Service account; leave empty with the JSON-file method    |
| `APP_NAME`                                       | Display name                                         | Provisional default: `XVIA`                               |
| `UNIVERSITY_URL`                                 | University website shortcut                          | Supplied value: `https://szabist-isb.edu.pk/`             |

The separate ZABDESK shortcut opens `https://zabdesk.szabist-isb.edu.pk/`, as linked by the [official university page](https://szabist-isb.edu.pk/zabdesk/). It opens the university's own site; XVIA does not store or fill in its login credentials.

Firebase web configuration is deliberately available to the browser. The Firebase Admin private key and database token are not. Never put an Admin key, database token, R2 secret, or OpenAI key in a public frontend variable. See [Firebase API keys](https://firebase.google.com/docs/projects/api-keys).

The permitted email domain is currently fixed to `szabist-isb.pk`; the class timezone is `Asia/Karachi`. Neither a changed display name nor a browser setting can change the server's eligibility check.

## C. Prepare a Firebase development project

1. Open the [Firebase console](https://console.firebase.google.com/) and create or select a project you own. Google Analytics is not needed by this checkpoint.
2. Register a **Web app** inside that project. Copy its `apiKey`, `authDomain`, `projectId`, and `appId` into the matching `FIREBASE_*` fields in your private `.env`.
3. Open **Authentication → Sign-in method** and enable **Email/Password**. Passwordless email-link sign-in is not required by this project. Firebase documents this setup in its [password authentication guide](https://firebase.google.com/docs/auth/web/password-auth).
4. In **Authentication → Settings → Password policy**, use **Require** mode with a **12-character minimum** and **128-character maximum** to match the application's password inputs, including passwords set through recovery. The browser's check alone does not enforce a Firebase-wide rule. Leave additional character requirements off unless the app's instructions are updated to match. See the password-policy section of the [Firebase guide](https://firebase.google.com/docs/auth/web/password-auth).
5. In **Authentication → Settings → Authorized domains**, add `localhost` for your development project if it is absent. Newer Firebase projects do not automatically include it. Enter a hostname, not `http://localhost:5173`. Use `localhost` consistently in your browser while testing. See [Firebase's authorized-domain guidance](https://firebase.google.com/docs/auth/faq-and-troubleshooting).
6. Review the verification and reset email templates so the application name is recognizable. The application uses Firebase's [verification and password-reset flows](https://firebase.google.com/docs/auth/web/manage-users).
7. In **Authentication → Settings → User actions**, keep **Email enumeration protection** enabled. It helps avoid disclosing whether an address has an account through sign-in/reset errors. The [Firebase password-authentication guide](https://firebase.google.com/docs/auth/web/password-auth) explains the setting and its effect on error responses.

Keep a separate production project or review development-only settings before launch. Do not add arbitrary domains to resolve an error.

## D. Give the backend its Firebase Admin credential

This is separate from the public web-app configuration.

1. In Firebase, open **Project settings → Service accounts**.
2. Use **Generate new private key** and store the downloaded JSON in a private folder outside this project, for example a `XVIASecrets` folder in your user directory.
3. Do not edit the JSON or upload it to chat. Do not place it in `public/`, source control, or a shared ZIP.
4. Set these fields in `.env`:

```dotenv
FIREBASE_USE_APPLICATION_DEFAULT=true
```

Set `GOOGLE_APPLICATION_CREDENTIALS` to that file's actual absolute path. Examples of path syntax are:

```dotenv
# Windows: forward slashes avoid backslash-escape confusion.
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/YourName/XVIASecrets/firebase-admin.json
```

```dotenv
# macOS example; Linux often starts with /home/yourname/ instead.
GOOGLE_APPLICATION_CREDENTIALS=/Users/yourname/XVIASecrets/firebase-admin.json
```

Use one actual path, not both examples. Enclose the value in double quotes if the path contains spaces. Leave `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` empty when using this method. Confirm that the JSON and the public web configuration belong to the same Firebase project.

This follows the [Firebase Admin setup instructions](https://firebase.google.com/docs/admin/setup). A hosting provider can later supply the file or credential through its secret settings.

## E. Switch to real accounts using a clean local database

Stop the running app. Keep your previous demo `.env` privately if you want to return to it. Set:

```dotenv
AUTH_MODE=firebase
NODE_ENV=development
HOST=127.0.0.1
PORT=3001
DATABASE_URL=file:./data/campus-real.db
DATABASE_AUTH_TOKEN=
```

Using a different filename keeps real accounts separate from demo fixtures. Set `MASTER_ADMIN_EMAIL` to **your own chosen university email address**. It must be in `szabist-isb.pk`, and you must be able to verify its inbox. Do not use a demonstration or example address.

The owner bootstrap grants the initial Master Admin role to that matching verified account only when the application has no existing Master Admin. Changing the environment variable later is not a representative-replacement or ownership-transfer workflow. No real owner is preassigned in the source ZIP.

After the configuration is complete:

```sh
npm run db:migrate
npm run dev
```

Do not run demo setup against the real database. Open `http://localhost:5173`, create your XVIA account, and verify the email message before accessing protected data. **Use a new password specifically for XVIA, not your university mailbox password.** Return to the app and refresh the verification state or sign in again.

## F. Optional: use a Turso database

A remote database is not required for Firebase testing on your computer. When you choose Turso, create a fresh **libSQL-compatible database** for this project, obtain its connection URL and authentication token, and configure:

```dotenv
DATABASE_URL=libsql://YOUR_DATABASE_HOST
DATABASE_AUTH_TOKEN=YOUR_PRIVATE_DATABASE_TOKEN
```

Replace the placeholders privately, then run `npm run db:migrate` with that configuration.

This project uses `@libsql/client`. Turso's current documentation also covers a newer engine using `turso://` URLs and a different SDK. Use the **Remote libSQL database** section of the [official TypeScript quickstart](https://docs.turso.tech/sdk/ts/quickstart); a newer-engine URL is not interchangeable with this project's connection URL. If your dashboard offers only the newer engine, keep using the local database while we select a supported configuration.

Copying `.env` or changing the URL does not transfer existing records. Database migration creates/updates the schema; moving existing data needs a separate export/import or migration procedure. Never delete the old database before checking the new one.

## G. Real-account checks before inviting students

- [ ] The app starts in Firebase mode without the demo persona selector.
- [ ] Your chosen owner email can register, verify ownership, and receive the initial Master Admin role.
- [ ] A separate eligible account remains a student until explicitly granted another role.
- [ ] An unverified account cannot access protected application data.
- [ ] Firebase's enforced password policy matches the form's 12–128 character range.
- [ ] Email enumeration protection is enabled in the Firebase project.
- [ ] An address outside `szabist-isb.pk` cannot access protected application data.
- [ ] A verified user without membership cannot read or manage another class.
- [ ] Class/member approval and representative permissions behave as intended.
- [ ] Password recovery works through the configured Firebase email flow.
- [ ] The intended account and database belong to your development environment.

These are checks to perform with your configured services, not claims of live testing in this ZIP. The shared university domain does not itself distinguish students from staff; approvals must follow actual class membership.

Basic Firebase authentication can still contain an unsupported user's provider-side account record. This application denies that record protected app access. Provider-side registration blocking is a separate Identity Platform setup, explained in [SECURITY_AND_OFFLINE_PLAN.md](SECURITY_AND_OFFLINE_PLAN.md).

## H. Settings for the later hosted release

Checkpoint 5 provides the complete deployment instructions. A public deployment will require Firebase authentication, HTTPS, exact production origins and Firebase authorized domains, a persistent database, protected server secrets, and completed verification. Demo mode deliberately refuses production use.

On a host that requires it, the API will use `HOST=0.0.0.0`, `NODE_ENV=production`, and the host-assigned `PORT`. Those settings alone do not make this checkpoint ready for a public rollout. R2, push delivery, AI, the PDF template, and Android setup are introduced in their respective checkpoints.

## 8. Private lecture and profile-photo storage (Checkpoint 2)

Local practice uses `STORAGE_DRIVER=local`. Files are stored below `STORAGE_LOCAL_DIR` (default `./data/storage`) and temporary uploads use `UPLOAD_TEMP_DIR` (default `./data/tmp`). Both must be outside the web assets. The API never serves this directory directly. Back it up with the SQL database.

For an ephemeral hosted server use a private Cloudflare R2 bucket:

```dotenv
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=your-32-character-cloudflare-account-id
R2_BUCKET=your-private-bucket-name
R2_ACCESS_KEY_ID=your-bucket-scoped-access-key
R2_SECRET_ACCESS_KEY=your-bucket-scoped-secret
```

Replace each placeholder privately in your hosting environment. Grant the server object read/write/delete access to this one bucket. Keep public access disabled: no public `r2.dev` URL or public custom-domain access for academic files. See [Cloudflare's S3 SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) and [public access documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

This implementation sends file bytes through the authenticated Node API. It does not require browser-to-bucket CORS or expose presigned/public URLs. API hosting bandwidth and temporary disk still matter. R2 configuration is implemented but has not been exercised against your live account.

Changing `STORAGE_DRIVER` or bucket does not migrate existing files. Copy the private object keys and bytes as part of a planned migration, then switch configuration. Keep the original store until validation passes. Database rows hold storage keys, not the file bytes.

Current lecture limits are 25 MiB per file and 100 MiB per class, counting trash. Photo uploads accept JPEG/PNG/WebP up to 2 MiB and 16 megapixels and are re-encoded to WebP at a maximum 512×512 pixels. The limits are code constants in this checkpoint; dashboard budget/quota controls come in the operations phase. No aggregate 10 GB billing guarantee is enforced yet; check your provider usage before inviting many classes.

## 9. Master controls and first hosted smoke check

After your explicitly configured owner email is verified, open Master Admin. Its settings let you manage the implemented feature switches, Tutor publication, and read-only maintenance. These are database settings; do not put service-account keys or R2 credentials in Tutor text or other content fields.

Test with two real eligible accounts in a separate pilot class: verify email delivery, create/approve a class, approve membership, post all intended announcement scopes, upload/download/delete a non-sensitive test file, replace/remove a profile photo, revoke membership, and confirm denied access. Test installation on an actual iPhone and Android browser at the deployed HTTPS origin. Keep this as a small pilot until those provider and device checks pass.

For GitHub-based updates and the Render commands, follow [GITHUB_AND_DEPLOYMENT.md](GITHUB_AND_DEPLOYMENT.md). Do not deploy the local demo configuration.
