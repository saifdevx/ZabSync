# Start here — ZabSync Checkpoint 3, corrected version 0.3.1

This is a complete project, not a patch that must be pasted into Checkpoint 2. You can try it locally without Firebase, Turso, Cloudflare, a credit card or a Play Store account. Real-account setup is separate.

If you already installed Checkpoint 3, start with [UPGRADE_FROM_CHECKPOINT_3](UPGRADE_FROM_CHECKPOINT_3.md). For Checkpoint 1 or 2, follow [UPGRADE_FROM_CHECKPOINT_2](UPGRADE_FROM_CHECKPOINT_2.md). A new extracted folder also works as a fresh demo.

## 1. Install Node.js 24

Install the Node.js 24 LTS package from [nodejs.org](https://nodejs.org/en/download). npm is included. Reopen your terminal after installation:

```sh
node --version
npm --version
```

The first result should begin with `v24.`. No separate SQL server, Python, Docker or Android Studio is needed for this checkpoint.

## 2. Extract the whole ZIP

On Windows, right-click the ZIP, choose **Extract All**, and put the extracted folder somewhere simple, for example `C:\Projects\zabsync-checkpoint-3`. Open the folder containing `package.json`. Type `powershell` in File Explorer's address bar to open a terminal there.

```powershell
cd "C:\Projects\zabsync-checkpoint-3"
```

On macOS/Linux, extract with your file manager and open Terminal:

```sh
cd ~/Downloads/zabsync-checkpoint-3
```

Use your actual folder location. Do not try to run the project from inside the ZIP. If Windows blocks `npm.ps1`, use `npm.cmd` instead of `npm`; changing the system's script-execution policy is unnecessary.

## 3. Install and configure the local demo

Run each command and wait for it to finish:

```sh
npm ci
npm run setup:demo
npm run dev
```

`npm ci` downloads the exact locked dependencies and needs internet. Demo setup creates local configuration without overwriting an existing `.env`. When the server starts, it creates the sample database and applies migrations. If your folder already has real Firebase settings, keep them and try a fresh extracted folder for the demonstration.

Open **http://127.0.0.1:5173** and keep the terminal running. The API uses port 3001 and the development interface uses 5173.

| Persona      | Try this                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Student      | Read class notices and files, timetable and deadlines; edit your own profile; no Create class/admin controls |
| Class Admin  | Create a class directly; manage your own class's subjects, content, invitations, timetable and deadlines     |
| Master Admin | Browse semesters/sections/people, enroll registered accounts, assign admins and manage global settings       |

These are fictional demo accounts. Old demo database email strings may remain after an upgrade to preserve identities; they do not create extra public roles. No real university timetable, teacher or deadline is implied by the clearly labelled sample data.

The demo is deliberately restricted to this computer. Use Firebase mode and persistent stores before hosting for students; do not expose the persona selector publicly.

## 4. Try the new owner workflow

1. Choose **Master Admin**. It opens the separate **Owner dashboard** automatically. Its navigation has no student Home, My classes or personal timetable destination.
2. Open **Semesters & sections**, choose **Semester 5**, then the sample **5D** section.
3. The **People** view shows enrolled students. The owner can see account IDs, names, email addresses and roll numbers where the email local part is numeric. Fictional demo emails are names, so their roll number is not fabricated.
4. Use the person's shield button, **Change class admin role**. In **Class role**, choose **Class Admin** or **Student**, then select **Save role**. Several Class Admins can coexist in one class.
5. To add an already registered account, use **Enroll a student** and select the matching account. Registration alone does not imply membership in every class.
6. A selected student's normal interface gains the Class Admin controls after their account state refreshes. Server permissions change immediately; the student does not receive Master Admin authority.

For your first real class, use **Create class** in the owner directory, enter its semester and section, then enroll registered students and appoint one or more Class Admins. Creating a class as owner does not enroll the owner. In an existing semester, the form starts with that semester selected. Class Admins can create a class directly and become its admin; ordinary students can only join.

Open a section to manage its subjects, files, announcements, students, timetable and deadlines. The owner keeps this broad management scope inside the owner console. For your own day-to-day studies, use a separate university account. [OWNER_ACCOUNT](OWNER_ACCOUNT.md) explains using one explicitly configured Gmail address as owner, with its Firebase UID, and transferring an existing owner safely.

Membership requests through join codes still need approval. The removed workflow is class-creation approval.

## 5. Add your section's weekly timetable

1. Choose **Class Admin** and open **Timetable**. Select the intended class.
2. Choose **Weekly class**. Enter **Title**, **Day**, **Start time** and **End time**. You can also select **Subject (optional)** and add a teacher, room and notes. Choose **Add to class** to save the repeating weekly routine.
3. Read the entire **Monday–Sunday** schedule on one page. Wide layouts place day panels side by side; smaller screens stack them with time, subject, teacher and room readable. Use the week controls to look ahead. The clock is the campus timezone, **Asia/Karachi**.
4. Open **Manage weekly template & changes** to edit or remove a recurring entry.
5. Use **One-time change** for an extra session, a cancelled occurrence, or a rescheduled occurrence. The selected date changes only that occurrence, not the weekly routine.
6. For a cancellation/reschedule, choose the recurring entry and its original date. Rescheduling also takes the replacement date/time. A conflict badge draws attention to overlapping sessions; review the schedule before students rely on it.
7. If classmates need attention drawn to a change, also post a whole-class announcement.

Students read the full week without shared editing controls. Empty days are visible too. Your saved routine repeats automatically; dated extras, cancellations and moves affect only the indicated occurrences. As owner, open a section from the directory and choose its **Timetable** or **Deadlines** link to manage the same information.

## 6. Add quizzes, assignments and events

Open **Deadlines** for the class. As Class Admin, create a quiz, assignment or event with its title, subject if applicable, date, time and details. Edit/delete actions use the latest version so one admin cannot silently overwrite another admin's update.

Each student has their own **Mark complete** control while online. This is a personal checklist, not an assignment-upload/submission system. When an admin changes a deadline, the updated version becomes open until the student reviews and marks it again. Deadline cards are included now; automatic scheduled/push reminders are part of Checkpoint 4.

## 7. Keep lectures and announcements organized

Inside a class, add subjects such as Operating Systems Lab and Databases. Each subject has resources and announcements. Upload a PDF, PPT or PPTX below 25 MiB. Edit its title/details, attach it to a notice, download it or place it in the recycle bin.

A class-wide notice reaches the class home feed without requiring students to open a particular subject. Only Master Admin can post a university-wide notice. Bookmarks and the in-app notification inbox remain available.

Trashed files continue to count toward the class quota. Restore the parent subject first if it was trashed. Permanent file removal asks for confirmation and cannot recall copies already downloaded to a student's device.

## 8. Prepare offline access using the compiled app

The development server is for editing code. For offline reopening, stop it with **Ctrl+C**, then run:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001** on the same computer. Do not use 5173 for this test.

1. Sign in as Student or Class Admin while online, then open **Offline access**. The Master Admin console requires a connection.
2. Click **Prepare offline access** and wait for the complete-sync time.
3. Check that **Reopen the app offline** says the app shell is ready. If it is still preparing, reopen this screen after the worker finishes; an uncached app cannot reopen offline.
4. Open a class's Resources and choose **Save offline** on a document. If offline access is not prepared yet, the button guides you to preparation first.
5. Return to Available offline and confirm the document appears with a size and save time.
6. Disconnect from the internet, or use your browser's offline network setting, then reopen/reload the compiled app. The saved view shows the last sync time. Browse your prepared timetable, notices and deadlines, and download a saved file copy.
7. Reconnect and use **Reconnect** / **Refresh offline information** to validate current membership and obtain a fresh complete snapshot.

Prepared access lasts up to seven days. It is read-only and specific to this browser/device. It does not permit a new account to sign in while offline. It does not save rosters, profile photos, admin controls, or all lecture bytes automatically.

**Bookmark**, **Download**, and **Save offline** are different: a bookmark is an account reference; Download makes a separate browser/device file; Save offline adds a copy to ZabSync's local device library. Use Clear this device to remove the in-app snapshot/files. Signing out or switching accounts also clears them.

See [OFFLINE](OFFLINE.md) for limits and the detailed acceptance checks. These steps are for you to verify on your own browser; no physical device test is claimed by the ZIP.

## 9. Add your developer information

As Master Admin, open the dedicated **Developer** tab. Enter **Your name**, **Title** and **Your introduction**. **Portfolio link**, **Updates from you** and other application links are optional; use HTTPS for any links you add. Choose **Save developer draft** to keep the content private and **Preview introduction** to review it. When it is ready, turn on **Publish developer details** and choose **Save & publish profile**.

Switch to Student and open **Meet the Developer** from the sidebar card or More menu. It is a separate page for your published introduction, portfolio, updates and promoted applications. **Get the App** also links to it. The destination stays understandable before publication with an empty-state message, rather than silently disappearing. To unpublish, return to **Developer**, turn off **Publish developer details**, and select **Save developer draft**. No Tutor biography is reused automatically.

## 10. Profiles, maintenance and feature controls

Use your avatar or **More → My profile** to change your display name and optional unique username. A profile photo may be JPEG/PNG/WebP below 2 MiB. Verified email, roll number derived from that email, and the internal ID stay stable.

**Master Admin → App controls** manages the implemented subjects, resources, announcements, timetable, deadlines, profile photos and Developer features. It also provides read-only maintenance. After changing a feature switch or maintenance setting, choose **Save application settings**. Account suspension, global notices, activity history and trash are in the same owner dashboard.

A feature switch controls code that already exists. Future functionality still needs a source update, tests and a deployment through GitHub.

## Reopen later and troubleshoot

Press **Ctrl+C** to stop. Later run `npm run dev` for development or `npm start` for the compiled application. Local data stays under `data/`; stopping does not normally erase it. Rebuild after source changes before using the compiled application. Run `npm pkg get version` in the folder you are starting; this corrected release reports `0.3.1`. After replacing the deployed build, accept the app update and reopen to avoid retaining the previous interface.

| Problem                              | Next action                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Node/npm missing                     | Install Node 24 and reopen the terminal                                                  |
| `package.json` not found             | Change to the extracted project folder                                                   |
| Windows `npm.ps1` blocked            | Use `npm.cmd` for the same command                                                       |
| Dependency download failed           | Restore internet access and retry `npm ci`                                               |
| Port already in use                  | Stop the previous project terminal; run one copy                                         |
| Browser cannot connect               | Confirm the terminal is running and use 5173 for dev or 3001 for compiled mode           |
| Old app name after upgrade           | Set `APP_NAME=ZabSync`, restart, rebuild, and accept the offered web-app update          |
| No offline reopening                 | Use a compiled build, prepare the device online, and wait for shell readiness            |
| Saved information expired            | Reconnect, sign in if needed, and prepare it again                                       |
| Phone cannot open computer localhost | Use a configured HTTPS deployment with Firebase; a phone's localhost is the phone itself |
| Conflict while saving                | Refresh and review the latest version before saving again                                |

Keep `.env`, `data/`, downloaded service-account keys and real student data private. They are not source files to commit or put in a shared ZIP. The included `.env.example` contains configuration names and empty credential fields.

Run `npm run build` and then `npm test` to repeat the automated checks. For real university accounts, continue with [CONFIGURATION_CHECKLIST](CONFIGURATION_CHECKLIST.md). For home-screen installation, see [INSTALL_AND_ANDROID](INSTALL_AND_ANDROID.md).
