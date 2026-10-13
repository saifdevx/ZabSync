# Start here — ZabSync Checkpoint 4

This is the beginner entry point for **version 0.4.0**. The full current instructions are in [CHECKPOINT_4_GUIDE](CHECKPOINT_4_GUIDE.md). Older checkpoint documents describe historical work; they do not override the current one-section/subject-code model.

## 1. Open the source folder

Install Node.js **24** and reopen your terminal. Check:

```sh
node --version
npm --version
```

Extract `zabsync-checkpoint-4.zip` first. Open a terminal in the extracted `zabsync-checkpoint-4` folder containing `package.json`. On Windows, File Explorer's address bar can open `cmd` in that folder. If PowerShell blocks `npm.ps1`, use `npm.cmd` for the commands below; changing system script policy is unnecessary.

## 2. Run the local demonstration

```sh
npm ci
npm run setup:demo
npm run dev
```

Wait for both servers to start, then open **http://127.0.0.1:5173**. Leave the terminal running. Stop it with **Ctrl+C**. Setup refuses to overwrite real-account configuration; use a fresh extraction if you want a separate demo.

The demo's three fictional personas are development tools. A real Firebase installation has a sign-in page, not a role picker.

| Persona      | Try                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student      | My Class, My Subjects, full-week timetable, subject resources/chat, personal reminders, front page and GPA calculator                                          |
| Class Admin  | Create/edit a subject inside 5D, create its join code, manage its resources/notices/deadlines/chat and update the section timetable                            |
| Master Admin | Open semesters → section → people; create sections, enroll/transfer users, assign Class Admins, publish developer/help content and use App controls/Operations |

Students cannot create sections or subjects. Only the owner creates sections. Class Admins manage their assigned section. The first subject-code request needs approval; later subjects must be inside the student's pinned section.

## 3. Check the new tools

Open **Front page**, enter your details and generate the Word document. The form uses the supplied template. Open **CGPA calculator**, enter marks and credits, and optionally add previous cumulative credits/CGPA. Both compute on the device.

Drive is deliberately unavailable in demo mode. Uploads use local private storage. The guide explains configuring verified Firebase accounts, then asking each uploader to connect Drive once. A personal Google Drive connection does not give that Gmail address permission to sign in as a student.

## 4. Prepare offline use

Stop the development server and run:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Sign in online, open **Offline access**, choose **Prepare offline access**, and wait for snapshot and app-shell readiness. Use **Save offline** for each resource you want to retain in the app. Then test reopening offline. The weekly timetable, saved academic information, front-page template and local calculator are the useful offline features; chat and admin changes require a connection.

A phone's localhost refers to the phone. Use the configured HTTPS deployment in Checkpoint 5 to test installation on an actual phone. Do not expose the demo publicly.

## 5. Continue safely

- Existing CP3 installation: [UPGRADE_FROM_CHECKPOINT_3](UPGRADE_FROM_CHECKPOINT_3.md).
- Real accounts and provider settings: [CHECKPOINT_4_GUIDE](CHECKPOINT_4_GUIDE.md), [CONFIGURATION_CHECKLIST](CONFIGURATION_CHECKLIST.md).
- Budget and 1,000-user target: [CHECKPOINT_4_COSTS_AND_SCALING](CHECKPOINT_4_COSTS_AND_SCALING.md).
- Backup and rehearsal: [BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md).
- Carry context to a new chat: [ZabSync_Project_Context](../ZabSync_Project_Context.md).

Keep your private `.env`, provider credentials, database and uploaded files out of shared ZIPs and GitHub. The source includes empty configuration fields, not a real owner account or connected cloud services.
