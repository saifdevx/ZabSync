# Security and offline behavior

## What Checkpoint 1 provides

The application separates identity, eligibility, and class permission:

1. In real mode, Firebase authenticates the account.
2. The backend requires a verified email in the exact allowed domain.
3. The application database records account status and class membership.
4. Each protected operation checks the required role and class scope.

The browser cannot grant itself a role. A Class ID identifies a class; a join code requests admission and does not grant CR, GR, or Master Admin access.

`szabist-isb.pk` is the supplied email domain, shared by students and staff. A verified address therefore does not establish that someone is a currently enrolled student. Representatives should approve classmates against known class membership. A university roster or official student-only identity integration is a future way to make that check authoritative.

### Firebase account records versus application access

This project's backend rejects unsupported or unverified email accounts before protected application access. A person bypassing the browser's form validation may still create a Firebase Authentication record in a basic Firebase setup. That record must not grant class data or administrative access.

Blocking registration or sign-in at Firebase itself requires separately configured Authentication blocking functions and an Identity Platform upgrade. They are not automatically installed by this ZIP. See [Firebase blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions).

### Passwords and secrets

For email/password login, create a new password for CampusDesk. **Never enter the password for your university mailbox in the CampusDesk registration form.** Email verification arrives in that mailbox and confirms ownership.

The browser's Firebase web configuration, including its API key, identifies the Firebase project; it is expected to appear in the client. It is not an administrative credential. Restrict keys appropriately and rely on actual authentication and authorization, as described in [Firebase's API-key guidance](https://firebase.google.com/docs/projects/api-keys).

Firebase service-account JSON, Turso authentication tokens, future R2 credentials, and an OpenAI API key are server secrets. Keep them outside the source ZIP, source control, public folders, screenshots, and chat. A `VITE_` variable is exposed to client code and must never contain a server secret. See [Vite environment variables](https://vite.dev/guide/env-and-mode).

### Local demonstration

Demo personas are a local development convenience, not authenticated university accounts. They are suitable for learning the interface and testing role behavior without provider credentials. Demo mode is restricted to a loopback development server and must not be exposed through a public host, tunnel, or shared network.

Keep demo and real databases separate. Demonstration identities must not be promoted into a live student database.

### Current verification boundary

Source-level and automated checks validate only the cases they exercise. A successful build does not prove browser usability, real email delivery, live Firebase/Turso connectivity, a production deployment, or Android behavior. Record these checks separately when the corresponding environment is available.

## Offline access is a required Checkpoint 3 feature

**Checkpoint 1 does not yet include offline timetable access.** The following is the implementation and acceptance plan for that checkpoint.

### First use and later offline use

The first sign-in and initial synchronization need internet. Once saved, the application shell and selected data must remain readable when the student closes and reopens the app without a network connection. Startup must not wait indefinitely for a fresh API response before showing cached content.

| Feature                                   | Intended offline behavior                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| Weekly timetable                          | Show the last synchronized week pattern and saved dated changes                   |
| Quizzes and assignments                   | Show synchronized deadlines and details                                           |
| Announcements                             | Read announcements already synchronized to the device                             |
| Saved files                               | Open files whose explicit offline download has completed                          |
| Bookmarks                                 | Show saved references; an unsaved document still needs internet                   |
| Front-page generator                      | Generate locally after its template/assets are cached, once this feature is added |
| First login or password recovery          | Requires internet                                                                 |
| New announcements and changes             | Requires a new synchronization                                                    |
| Joining classes or administrative editing | Requires internet                                                                 |
| University portal and AI                  | Requires internet                                                                 |

Show **Offline — last updated [date/time]** beside cached academic information. An offline device cannot know about a newly cancelled class or a changed submission time.

### Reading, editing, and synchronization

Initially, shared academic data is read-only offline. This prevents conflicting timetable edits and changes based on stale administrative permissions. Personal drafts can remain on the device, but cross-device changes need a defined synchronization policy before that workflow is enabled.

Reconnection should fetch changes, apply deletions, refresh membership, and update the synchronization timestamp. Failed refreshes must preserve the last successfully saved view and explain that it is stale. File downloads need a clear completed/failed state and retry controls.

### Saved-data security

- Partition app-managed data by signed-in account and class.
- Clear private app-managed caches on logout or account switching.
- Do not cache every authenticated response indiscriminately, or treat an expired download URL as the saved document.
- Recheck current membership and permissions when connecting to the backend.
- Explain the difference between an app-managed offline copy and a file downloaded into the device's own Downloads folder.

Suspending a user can prevent future authorized server access. It cannot immediately erase data from an offline device, or recall a file someone saved elsewhere. This limitation must be reflected in the privacy notice and representative workflow.

Browsers can evict saved site data. Provide storage usage, removal, and redownload controls and avoid promising permanent retention. See [browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

### Reminder limits

An offline deadline list works without a push connection. A new server notification requires connectivity, and permission to show notifications is not a delivery guarantee. Do not promise exact-time alerts from a closed, offline web browser.

At the Android stage, local notifications may be scheduled from synchronized deadlines. They still represent the last synchronized schedule and must be updated or cancelled after new information arrives. See [Firebase message lifespan and delivery](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan).

### Offline acceptance checks for Checkpoint 3

1. Sign in online, select the class, and synchronize its timetable and deadlines.
2. Save a PDF and confirm that its offline download completes.
3. Close the application completely, disconnect the network, and reopen it.
4. Read the timetable and deadlines, and open the saved PDF.
5. Confirm that connection status and last-update time are visible.
6. Change a timetable entry on another connected device; confirm that the offline device continues showing its clearly marked saved version.
7. Reconnect and verify that the change synchronizes.
8. Log out and verify that another account does not receive the previous account's app-managed cached content.

These are required future checks, not claims that they have been run on this first checkpoint.
