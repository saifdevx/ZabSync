# CampusDesk: scope and five checkpoints

CampusDesk is the provisional name for the SZABIST Islamabad class application. The interface uses the requested navy, white, and green palette. The supplied university artwork is a starting asset; a clearer original can replace it later.

Each checkpoint delivers a complete, cumulative source ZIP. You will extract the new version into its own folder, follow its upgrade instructions, and keep your private configuration and existing data. You will not need to combine code snippets manually. Corrections belong to the same checkpoint, so the project remains five numbered checkpoints.

## Checkpoint 1 — accounts, roles, and class setup

This ZIP establishes the application foundation:

- A responsive web interface and a backend with a persistent SQL database.
- A local demonstration with four selectable personas and no external account setup.
- A Firebase email/password mode for real accounts, with email verification and password recovery.
- The approved email domain, `szabist-isb.pk`, enforced before access to application data.
- Student, CR, GR, and Master Admin permissions.
- A reusable class template; class requests and approval; stable Class IDs and replaceable invitation codes.
- Class membership requests, representative review, class details, and profile management.
- Shortcuts to the official campus website and ZABDESK.

**Completion check:** run the project locally; inspect the student and representative views; submit and review a class or membership request; verify that students cannot use representative actions. Configured Firebase mode additionally needs real email verification and account-recovery checks before real students use it.

The domain is shared by students and staff. Email verification proves mailbox ownership. Class approval remains necessary, and it does not replace an official enrollment check.

The university website shortcut opens `https://szabist-isb.edu.pk/`. The separate ZABDESK shortcut opens `https://zabdesk.szabist-isb.edu.pk/`, linked from the [official campus ZABDESK page](https://szabist-isb.edu.pk/zabdesk/). It opens the external university site; CampusDesk does not embed or collect portal credentials.

**Timetable, academic deadlines, document uploads, notifications, and offline academic data are later checkpoints.** A local database in this version does not mean the web app already works offline.

## Checkpoint 2 — subjects, documents, and announcements

Add customizable subjects, private R2 document storage, authorized downloads, titles and descriptions, search/filtering, bookmarks, content editing and deletion, and an in-app notification center.

Announcements have three audiences:

| Scope             | Publisher          | Audience                                     |
| ----------------- | ------------------ | -------------------------------------------- |
| Subject           | That class's CR/GR | Members of the relevant course/class         |
| Class             | That class's CR/GR | Everyone in that class, from the home screen |
| Whole application | Master Admin       | All active application users                 |

Subject feeds begin with CR/GR posting and students reading. Student discussion remains an explicit feature decision based on budget and moderation needs; it will not be silently presented as implemented.

**Completion check:** a representative uploads a course file and publishes a class notice; a classmate can read both; a student in another class cannot access the file by changing its URL or ID.

## Checkpoint 3 — timetable, deadlines, and offline access

Add the weekly timetable, one-date changes, cancelled and extra classes, quizzes and assignment deadlines, and personal reminder preferences. Use Asia/Karachi for the class schedule.

Add installable web-app support and an offline cache. After a successful online login and synchronization, students can reopen the app offline and read the saved timetable, upcoming deadlines, and previously synchronized announcements. Files become available offline only after the student explicitly saves them and the download completes.

Show connection status, the last successful update, and controls to remove saved files. Returning online refreshes academic data. Administrative changes require a connection in the initial offline implementation.

**Completion check:** synchronize, close the app, turn off the network, and reopen it. The saved timetable and deadlines must remain readable. Saved documents must open. Reconnect and verify that a timetable change arrives.

## Checkpoint 4 — reminders, complete administration, and student tools

Add durable reminder processing, opt-in push notifications, maintenance controls, usage limits, audit/recovery support, and the remaining Master Admin management workflows.

Add the front-page PDF generator when its design and fields have been supplied. Add approved university, application, and creator help content. The optional AI integration uses approved sources, per-user limits, and a global budget; its API credentials stay on the server. The help content stays usable when AI is disabled.

If student discussion is selected, implement its audience settings, moderation, and abuse limits here.

**Completion check:** changed deadlines do not send obsolete reminders; representative changes remove the old privileges; the PDF matches the approved example; configured AI observes scope and usage limits. No promised core tool is left as a decorative button.

## Checkpoint 5 — verification, deployment, and Android

Complete end-to-end permission and recovery checks, performance checks at the planned pilot size, real-device usability and offline checks, error handling, and the final setup/upgrade instructions.

Provide the supported local and Render deployment path and the Capacitor Android project. Include Android build, signing, notification, and file-handling instructions. An APK or AAB is described as built only when the build has actually succeeded; release signing and Play publication depend on the owner's accounts and signing setup.

**Completion check:** the full student, representative, and Master Admin workflows pass; offline reopening works on the target Android devices; the selected hosting deployment is validated once its accounts are configured.

## What remains to supply

These items do not prevent trying Checkpoint 1 locally:

- Your chosen verified university email for the real Master Admin account. Example student addresses are not automatically assigned ownership.
- The front-page sample and all required fields.
- Approved university/app/creator chatbot content and an AI budget, if AI is enabled.
- A higher-resolution logo if available, and the final application name.
- Hosting and Android developer accounts when those integrations are reached.

Do not send passwords, service-account JSON, database tokens, or API keys in chat. Configuration instructions explain where to store them privately.
