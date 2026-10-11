# GitHub updates and an initial Render pilot

The code is prepared for GitHub; no repository has been selected, created or pushed yet. The ZIP remains a complete standalone deliverable. When the owner supplies the repository URL, use that destination and preserve any existing project history.

## How updates will work

1. Develop the change in a branch.
2. Run `npm run build` and `npm test` locally.
3. Commit and push the source and lockfile to GitHub.
4. The included `.github/workflows/ci.yml` installs dependencies, builds, runs the test suite, and audits production dependencies.
5. Review and merge a passing change into the branch connected to the host.
6. Render can rebuild and deploy after CI checks pass. Confirm the deployed version and any required data migration before announcing it.

Use a private repository while working with university branding and project details unless you choose otherwise. `.gitignore` excludes `.env`, `data/`, `node_modules/`, build output, database files and ZIPs. Keep those exclusions. The archive has a compiled build for convenient local use; GitHub rebuilds from source.

The GitHub Actions workflow has `contents: read`, does not preserve checkout credentials, and does not use a privileged pull-request target trigger. Dependabot configuration can propose package and Actions updates after the repository is hosted. Review changes and let checks pass; updates do not merge themselves.

The workflow uses the primary Actions repositories' current documented `v7` usage. Recheck versions before changing CI; see [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node).

## What the Master Admin dashboard controls

The dashboard manages the app's implemented settings and data: account status, class approvals/representatives, global notices, published tutor information, feature switches, maintenance, and recycle-bin actions. Class-specific subject/resource controls are reached by opening a class from All classes.

A feature switch is a setting for existing code. To add a brand-new capability, implement its API/UI/permissions, add a registered flag if needed, and commit/deploy the update. The dashboard does not run arbitrary uploaded code, store service-account keys, or create new backend features from a text prompt.

Configuration secrets belong in the host environment. GitHub stores code, not the live SQL database, students' lecture files, or profile photos. Committing a code update should not erase those stores.

## Prepare the hosted configuration

Use a **Node web service**, because the application contains a real API and private file access. Deploying only the `dist/client` folder as a static site would leave the backend missing.

| Host setting      | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Runtime           | Node 24                                                              |
| Build command     | `npm ci --include=dev && npm run build`                              |
| Start command     | `npm start`                                                          |
| Health-check path | `/api/health`                                                        |
| Bind host         | `HOST=0.0.0.0`                                                       |
| Port              | Let Render supply `PORT`; do not hardcode the local development port |
| App name          | `APP_NAME=XVIA`                                                      |
| Environment       | `NODE_ENV=production`                                                |
| Authentication    | `AUTH_MODE=firebase`                                                 |
| Allowed origins   | Your exact HTTPS deployment origin in `ALLOWED_ORIGINS`              |
| Database          | A persistent compatible Turso/libSQL database URL and token          |
| File store        | `STORAGE_DRIVER=r2` plus a private bucket's server credentials       |

Set Firebase's public app values and server Admin credentials according to `CONFIGURATION_CHECKLIST.md`. Add the deployed hostname to the Firebase authorized domains. `MASTER_ADMIN_EMAIL` must be your own real, verified `@szabist-isb.pk` address. No example email is the production owner.

`npm ci --include=dev` is intentional in the build step: TypeScript/Vite are build-time dependencies even when the runtime environment is production. Do not run `setup:demo` on the host. The application rejects production demo mode.

The server applies additive schema migrations before accepting traffic. Back up an existing database before upgrading. There is no automatic destructive reset. For later multi-instance deployments, use a controlled migration job and a shared rate-limit/gateway strategy; the current counters live in one process.

## Free Render behavior

Render documents that free web services spin down after inactivity and that local files can be lost on restarts, redeploys and spin-down. A local SQLite database and `data/storage` are therefore unsuitable as the durable stores for a free hosted pilot. Use persistent remote SQL and private R2. Free compute also has usage limits and may take time to wake. See [Render's free service limitations](https://render.com/docs/free).

R2 removes local upload persistence concerns, but downloads still pass through this API. Host bandwidth, service-to-service traffic, cold starts, and Firebase/database requests remain relevant. A successful local test is not a capacity guarantee for hundreds of simultaneous students.

## Connect deployment to passing commits

In Render, connect the intended GitHub repository and branch, then choose **After CI Checks Pass** for auto-deploys once the workflow is running. Render documents this setting and its behavior in [Deploying on Render](https://render.com/docs/deploys). Keep manual deployment if you prefer to review each release yourself.

No deploy hook or GitHub token is embedded in the frontend or Master Admin dashboard.

## iPhone, Android browser and later APK

Share the final HTTPS **website link**. iPhone users can open it in Safari and add it to the home screen. Supported Android/desktop browsers can offer installation; everyone may use the web URL directly. Device instructions are inside the app and `INSTALL_AND_ANDROID.md`.

Checkpoint 5 will add the Capacitor Android project and build/signing instructions. A Play Store release and an APK distributed from a direct link must use the planned package identity/signing strategy to avoid incompatible updates. This ZIP contains no Android APK/AAB and no Play listing. Future native packaging will also configure the correct API origin and native authentication/file behavior; wrapping a localhost-only demo would not produce the finished mobile application.

## Before the first student pilot

Complete live provider verification and actual device installation, upload/download/profile/permission checks with a small pilot class. The final release checkpoint adds broader offline/load/mobile checks, backup recovery, and Android testing. The development team has not connected your external accounts or deployed this checkpoint on your behalf.
