# Academic API — cumulative Checkpoint 3

> Historical checkpoint reference. For version 0.4.0, the current requirements and routes in [SECTIONS_AND_SUBJECTS](SECTIONS_AND_SUBJECTS.md), [CHECKPOINT_4_GUIDE](CHECKPOINT_4_GUIDE.md) and [project context](../ZabSync_Project_Context.md) take precedence. Only the owner creates sections; student subject enrollment is restricted to one pinned section.


All endpoints require `Authorization: Bearer …`. All text is plain text; clients must render it as text, never HTML. UUIDs are identifiers, never access credentials. Server-side authorization uses current account status and current class membership on every route and again inside write transactions.

## Subjects

- `GET /api/classes/:id/subjects?deleted=false&limit=50&offset=0&q=` → `{subjects, pagination:{limit,offset,total}}`.
- `POST /api/classes/:id/subjects` and `PATCH /api/subjects/:id` accept `{name,code?,instructor?,description?,color?}`. Optional strings default to empty. `color` is one of `blue`, `teal`, `purple`, `amber`, `rose` (default blue).
- `GET /api/subjects/:id` → `{subject}`.
- `DELETE /api/subjects/:id` moves the subject to trash, hiding its content from students.
- `POST /api/subjects/:id/restore` restores it. Independently trashed child content remains trashed.
- Subject record: `{id,classId,className,name,code,instructor,description,color,createdAt,updatedAt,deletedAt,canManage,resourceCount,announcementCount}`.

## Announcements

- `GET /api/announcements` accepts `scope=global|class|subject`, `classId`, `subjectId`, `q`, `saved=true|false`, `deleted=true|false`, `limit` (1–100, default50), `offset` (default0). With no scope it includes every visible scope, including class-wide and global notices. A `classId` filter includes that class and global notices; a `subjectId` filter includes only that subject.
- `POST /api/announcements` accepts `{scope,classId?,subjectId?,title,body,priority?,pinned?,resourceIds?}`. Priority is `normal|important|urgent` (normal default). `pinned` defaults false. Attach at most5 active, same-audience resources. Global announcements cannot attach class-private files.
- `GET /api/announcements/:id`, `PATCH /api/announcements/:id`, `DELETE /api/announcements/:id`, `POST /api/announcements/:id/restore`.
- Editing accepts the same content fields `title,body,priority,pinned,resourceIds`; omitting `resourceIds` preserves existing attachment links (use this when the resources feature is off). Audience cannot be moved after publication. Create a new notice for a different audience.
- Announcement record: `{id,scope,classId,subjectId,className,subjectName,title,body,priority,pinned,authorName,createdAt,updatedAt,deletedAt,canManage,saved,resources}`. Single endpoints return `{announcement}`; list returns `{announcements,pagination}`.
- Only Master Admin may create, edit, delete or restore global notices. Class Admins may publish within their own class.

## Private resources

- `POST /api/classes/:id/resources` is multipart with exactly one `file`, plus `title`, optional `description` and optional `subjectId`. Fields can arrive before or after the file. Accepted extensions: `.pdf`, `.ppt`, `.pptx`. Maximum25MiB per file; default class quota100MiB, including trashed files.
- `GET /api/resources` filters `classId,subjectId,q,saved,deleted,limit,offset`.
- `GET /api/resources/:id` → `{resource}`.
- `PATCH /api/resources/:id` accepts `{title,description?}`. Its file, class and subject cannot be changed; upload a replacement and trash the old file.
- `DELETE /api/resources/:id`, `POST /api/resources/:id/restore`.
- `POST /api/resources/:id/purge` permanently removes an already trashed file and reclaims storage. Retry is safe after a storage interruption. This is a separate, explicit action. If its subject is also trashed, restore the subject before managing its individual files.
- `GET /api/resources/:id/download` streams the authorized attachment with no-store/nosniff headers. It never returns a public object URL. Use authenticated fetch and a local Blob URL in the web client.
- Resource record: `{id,classId,subjectId,className,subjectName,title,description,filename,mimeType,sizeBytes,authorName,createdAt,updatedAt,deletedAt,canManage,saved,storageState}`. Storage keys and private paths are never exposed. List returns `{resources,pagination,limits:{fileBytes,classBytes}}`.

## Bookmarks and notifications

- `POST /api/bookmarks/:kind/:id` and `DELETE /api/bookmarks/:kind/:id`, where kind is `announcement` or `resource`; returns `{saved:boolean}`. Saving does not download a file or grant future access after membership removal.
- `GET /api/notifications?unread=false&limit=50&offset=0` → `{notifications,pagination,unreadCount}`. Entries are announcement-derived `{id,announcementId,title,body,scope,classId,subjectId,priority,createdAt,read}`; they are filtered against current permissions. Newly joined students can see existing visible notices, including in their notification list.
- `POST /api/notifications/:id/read` and `POST /api/notifications/read-all` → `{ok:true}`. IDs are announcement IDs.
- Search uses the same `q` on the resources and announcements lists. The client can show both result sets without a separate global search service.

## Storage and deployment

`STORAGE_DRIVER=local` defaults to private `data/storage`, outside the client build. `STORAGE_DRIVER=r2` uses the S3-compatible R2 API with `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Bucket public access must remain disabled. `STORAGE_LOCAL_DIR` and `UPLOAD_TEMP_DIR` can set server paths. Local file storage requires a persistent disk on a deployed server; use R2 when deploying on ephemeral/free server storage. File delivery currently passes through the API, so hosting bandwidth and request load still matter even with R2.

Uploads spool into private temporary files with bounded multipart fields, parts and file size. The server checks extension and file structure: PDF signature/end marker, legacy PowerPoint compound-file signature, and a bounded PPTX ZIP package with PowerPoint entries. PPTX archives are inspected without extracting files; arbitrary archives and macro-enabled packages are rejected. These checks are not malware scanning. Files are downloaded as attachments, never executed or rendered as uploaded HTML. The owner should upload only trusted course material; optional malware scanning is a later operational gate.

Object storage and SQL cannot share one atomic transaction. Upload completion rechecks permissions and quota inside SQL; rejected completion removes its staged private object. Failed compensation logs its random storage key for operator reconciliation (never a filename or public URL). Permanent deletion retains a retryable deletion state until storage deletion and SQL cleanup succeed. An abrupt process failure during an upload can leave an unreferenced private object; reconcile objects against SQL during backup/maintenance before deleting them. Automatic orphan reconciliation is a later maintenance task. No public object keys are used.

Turning subjects off also hides subject-scoped resources and notices, including their attachments, bookmarks and notifications. Class-level files and class/global announcements remain available under their own feature switches. Re-enabling the subject feature restores access to retained data. Turning resources off hides file attachments without deleting announcement text. Maintenance pauses changes for non-owner accounts while reads remain available; class admin trash listings also remain readable.

## Dependencies and sources

- [Fastify multipart streaming and limits](https://github.com/fastify/fastify-multipart)
- [Cloudflare R2 AWS SDK v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [yauzl archive inspection documentation](https://github.com/thejoshwolfe/yauzl)

Checkpoint 3 adds explicit account-scoped snapshots and selected file blobs. A bookmark remains an online account preference and does not download its contents. See [OFFLINE](OFFLINE.md) for the device store and [TIMETABLE_API](TIMETABLE_API.md) for planning endpoints.
