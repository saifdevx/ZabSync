# Start here — Checkpoint 2

You can run this checkpoint on your own computer without Firebase, Turso, Cloudflare, a credit card, or a Play Store account. Start with the included local demonstration. Real university accounts can be connected later using [the configuration checklist](CONFIGURATION_CHECKLIST.md).

The first download of project dependencies needs internet. Keep the project folder on your computer; opening files directly from inside the ZIP will not start the application.

## Before you begin

If you want to retain your previous accounts and class setup, follow [UPGRADE_FROM_CHECKPOINT_1.md](UPGRADE_FROM_CHECKPOINT_1.md) before starting. This ZIP also works as a fresh installation.

## 1. Install the one required development tool

Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org/en/download). npm is included with the normal Node installation. This project uses Node 24; the [official release table](https://nodejs.org/en/about/previous-releases) lists its support status.

An editor such as Visual Studio Code is useful for viewing files but is not required for the first run. You do not need Python, Docker, Android Studio, or a separate SQL server for this checkpoint.

Open a new terminal after installation and check:

```sh
node --version
npm --version
```

The first command should start with `v24.`. The second should print an npm version, not an error.

## 2. Extract the ZIP and open its folder

### Windows

1. Right-click the ZIP and choose **Extract All**.
2. Move the extracted project folder somewhere simple, for example `C:\Projects\xvia-checkpoint-2`.
3. Open that folder in File Explorer. You should see `package.json`, `.env.example`, and the `docs` folder.
4. Click the address bar, type `powershell`, and press Enter. The terminal opens in the project folder.

If you already opened PowerShell elsewhere, change to your actual project path:

```powershell
cd "C:\Projects\xvia-checkpoint-2"
```

If PowerShell says it cannot run `npm.ps1`, use `npm.cmd` in place of `npm` in the commands below. You do not need to weaken the computer's script-execution policy.

### macOS or Linux

1. Extract the ZIP using your file manager.
2. Open Terminal and change to the extracted project folder. For example:

```sh
cd ~/Downloads/xvia-checkpoint-2
```

Use the folder's actual location if different. If you get a “no such file or directory” error, find the extracted folder and correct the path.

## 3. Install and prepare the local demo

Run each command below, waiting for it to finish before running the next:

```sh
npm ci
```

This installs the exact dependency versions recorded in `package-lock.json`. Allow it to finish; the first run can take a few minutes.

```sh
npm run setup:demo
```

The setup creates a local demo configuration; the API creates the sample database when it first starts. It does not send emails, create cloud accounts, or use real university credentials. It preserves an existing configuration rather than silently overwriting your settings. If it reports that the project is configured for Firebase, keep that configuration and use a fresh extracted folder to try the demo.

## 4. Start the application

```sh
npm run dev
```

Leave this terminal open. It runs the web interface and API together.

Open **[http://127.0.0.1:5173](http://127.0.0.1:5173)** in your browser. The backend runs on port `3001`; you normally interact with the page on `5173` during development.

Choose a demo persona to explore the corresponding view:

| Persona      | What to explore                                             |
| ------------ | ----------------------------------------------------------- |
| Student      | Class access, profile, and requesting a class or membership |
| CR           | Managing the representative's own class                     |
| GR           | The equivalent class-management role                        |
| Master Admin | Reviewing requests and managing classes globally            |

The persona accounts are fictional local data. No password or university inbox is needed. An additional separate-class fixture is used for permission tests; it is not a fifth public persona.

Demo mode is for this computer only. Do not publish it or expose it through a tunnel. The real-account mode replaces the persona selector with Firebase authentication.

## 5. Try the new complete workflows

### Publish a lecture and notice

1. Enter as **CR**. Open the sample **5D** class, then choose **Subjects**.
2. Add your own subject, for example “Operating Systems Lab,” or open the clearly marked sample course.
3. Open that subject, choose **Resources**, and upload a real, non-sensitive PDF/PPT/PPTX. Use a file below 25 MiB. Its title and description are editable.
4. Return to **Announcements** in the subject. Post an update and optionally select your uploaded file as an attachment.
5. Return to the class and publish another announcement to **Everyone in this class**. Pin it if it needs prominence.
6. Switch to **Student**. Both updates can appear on Home, and the class-wide notice is visible without opening the subject. Open a notice, save it, and find it in **Saved for later**.
7. Use **Download** to save the lecture through your browser. Bookmarking alone does not download a file.
8. The bell opens the in-app notification inbox. Try marking notices as read.

No actual university timetable, deadline, or lecture is invented. Demo notices are explicitly sample information.

### Customize your student profile

Open your avatar or **More → My profile**. Change your display name, choose an optional unique username, and upload a JPEG, PNG, or WebP photo below 2 MiB. Your email and internal account ID stay stable. You can replace or remove the photo later.

### Use the central Master Admin dashboard

1. Switch to **Master Admin** and open **Master Admin** from the sidebar, shield icon, or More menu.
2. **Global notices:** publish a university-wide announcement. Only Master Admin can do this.
3. **Settings & Tutor:** enter your own accurate tutor information. Preview, save a private draft, and publish when ready. No tutor information is prefilled as fact.
4. Switch back to Student and open **Tutor** to check the published result.
5. Return to Master and try a feature switch. Disabling a feature hides it and blocks its API; it preserves data for re-enabling. Do not leave all features off if you want to explore the rest of the demo.
6. Try read-only maintenance. Students may read existing content while edits are paused. Master can still turn maintenance off. Its message is customizable.
7. **Members:** suspend/restore an ordinary demo account. Suspension immediately blocks its server access. Restore it before attempting to use that persona again. The owner cannot suspend their own Master account.
8. **All classes:** open any class to edit its contents and appoint CR/GR. **Activity** records important changes.

### Recycle bin

Representatives can move subjects, files, and announcements to trash, then restore them. Trashed files still occupy class storage. Permanently removing a trashed file is an explicit, confirmed action. If the whole subject was trashed, restore it first to manage individual files inside it. Downloaded student copies cannot be recalled by deleting the server copy.

### Install on a home screen

Open **Get the app** or **More → Get XVIA**. The screen explains iPhone/Safari and Android/browser installation. A native Install button appears only when the browser offers its installation event. See [INSTALL_AND_ANDROID.md](INSTALL_AND_ANDROID.md).

The development server does not register a worker. Use `npm run build` then `npm start` to check the compiled install setup on your computer. Real phone access needs a deployed HTTPS address and Firebase authentication; the loopback-only demo cannot be reached from a phone. The reconnect page is available after a successful service-worker installation. Saved timetables and offline academic data arrive in Checkpoint 3.

## Stop and reopen

Press **Ctrl+C** in the running terminal to stop the application. Later, open a terminal in the same project folder and run:

```sh
npm run dev
```

Your local SQL data lives under `data/`. Stopping the server does not normally erase it. You do not need to reinstall dependencies or recreate the demonstration each time.

## Run the checks and compiled application

From the project folder:

```sh
npm run build
npm test
```

Tests check the implemented cases; building checks that the client and server compile. These commands do not verify real Firebase email delivery or substitute for trying the interface in a browser.

To try the compiled application, stop the development server first, then run:

```sh
npm run start
```

Open **[http://127.0.0.1:3001](http://127.0.0.1:3001)**. In this mode the backend serves the compiled interface as well as the API. It still uses your local configuration; running a compiled build does not turn demonstration identities into secure public accounts.

## Common first-run problems

| Problem                                        | What to do                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` or `npm` is not recognized              | Install Node 24 and reopen the terminal. Check the version commands again.                                                                   |
| `package.json` cannot be found                 | You are in the wrong folder. Open the extracted folder that contains `package.json`.                                                         |
| `npm.ps1` is blocked on Windows                | Use `npm.cmd ci`, `npm.cmd run setup:demo`, and `npm.cmd run dev`.                                                                           |
| `npm ci` reports a download/network error      | Reconnect to the internet and rerun it. If an error persists, share the error text after removing secrets.                                   |
| Port `3001` or `5173` is already in use        | Stop your previous project terminal with Ctrl+C. Start only one copy at a time.                                                              |
| Browser says it cannot connect                 | Confirm that `npm run dev` is still running and use `http://127.0.0.1:5173`.                                                                 |
| API or configuration error                     | Read the terminal error. In a new demo folder, run `npm run setup:demo` before starting.                                                     |
| Changes to `.env` appear ignored               | Stop and restart the application; environment variables are read when it starts.                                                             |
| A phone cannot open the computer's `localhost` | `localhost` on the phone means the phone itself. This demo deliberately binds to the computer only. Real device deployment is handled later. |
| Timetable does not work in airplane mode       | Offline academic data is implemented in Checkpoint 3. This foundation does not yet contain it.                                               |

## Keep these files private

Keep `.env`, the `data/` directory, and any downloaded service-account key private. They are local configuration/data, not files to include when sharing the source project. The distributed ZIP should contain `.env.example` with empty credential fields.

When moving to a later checkpoint, keep the previous folder as a backup. The next ZIP will explain how to transfer settings and migrate data. Do not copy old `node_modules` or `dist` folders over a newer version.

## Your next step

Run the demonstration and note any error and the action immediately before it. We can resolve problems within Checkpoint 2 before progressing. Firebase/Turso setup is optional for this first local check; its instructions are in [CONFIGURATION_CHECKLIST.md](CONFIGURATION_CHECKLIST.md).
