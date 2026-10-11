import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase, first } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { ApiError } from '../server/errors.js';
import { CLASS_STORAGE_BYTES, type PrivateStorage } from '../server/storage.js';
import { bearer, createTestApp, demoToken, expectClientRejection, expectForbidden, expectSuccess, type TestApp } from './helpers.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

function multipart(fields: Record<string, string>, bytes = pdf, filename = 'lecture.pdf', extraFile = false) {
  const boundary = `xvia-${randomUUID()}`;
  const chunks: Buffer[] = [];
  // File first intentionally: real browsers and third-party clients can send fields in either order.
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from('\r\n'));
  for (const [key, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  if (extraFile) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from('\r\n'));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(app: TestApp, token: string, fields: Record<string, string> = { title: 'Lecture one', subjectId: DEMO_SUBJECT_IDS.os }, bytes = pdf, filename = 'lecture.pdf', extraFile = false, classId = DEMO_CLASS_ID) {
  const form = multipart(fields, bytes, filename, extraFile);
  return app.inject({ method: 'POST', url: `/api/classes/${classId}/resources`, headers: { ...bearer(token), 'content-type': form.contentType }, payload: form.payload });
}

async function postNotice(app: TestApp, token: string, values: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/api/announcements', headers: bearer(token), payload: {
    scope: 'class', classId: DEMO_CLASS_ID, title: 'Class trip update', body: 'Fictional test notice.', ...values,
  } });
}

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  const storage: PrivateStorage = {
    async putFile(key, path) { objects.set(key, await readFile(path)); },
    async open(key) { const data = objects.get(key); if (!data) throw new ApiError(404, 'missing', 'Missing'); return { stream: Readable.from(data), size: data.length }; },
    async delete(key) { deleted.push(key); objects.delete(key); },
  };
  return { objects, deleted, storage };
}

async function controlledApp(t: TestContext, storage: PrivateStorage) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.academic-'));
  const databaseUrl = pathToFileURL(join(directory, 'data.sqlite')).href;
  const db = await openDatabase(databaseUrl);
  const app = await createApp({ config: makeTestConfig({ databaseUrl }), db, storage });
  await app.ready();
  t.after(async () => { await app.close(); db.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, db };
}

test('student feed combines global, class and subject notices while excluding other classrooms', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student'), cr = await demoToken(app, 'cr'), master = await demoToken(app, 'master');
  const feed = await app.inject({ method: 'GET', url: '/api/announcements?limit=2', headers: bearer(student) });
  expectSuccess(feed);
  assert.equal(feed.json().pagination.total, 3);
  assert.equal(feed.json().announcements.length, 2);
  assert.equal(feed.json().announcements[0].scope, 'global');
  const page2 = await app.inject({ method: 'GET', url: '/api/announcements?limit=2&offset=2', headers: bearer(student) });
  assert.equal(page2.json().announcements.length, 1);
  assert.ok(![feed.body, page2.body].join('').includes('Separate class sample notice'));
  const search = await app.inject({ method: 'GET', url: '/api/announcements?q=Separate', headers: bearer(student) });
  assert.equal(search.json().pagination.total, 0);
  expectForbidden(await postNotice(app, student));
  expectForbidden(await postNotice(app, cr, { scope: 'global', classId: undefined }));
  expectForbidden(await postNotice(app, cr, { classId: DEMO_OTHER_CLASS_ID }));
  const global = await postNotice(app, master, { scope: 'global', classId: undefined, title: 'Owner notice' });
  expectSuccess(global);
  assert.equal(global.json().announcement.scope, 'global');
  const globalId = global.json().announcement.id;
  expectForbidden(await app.inject({ method: 'DELETE', url: `/api/announcements/${globalId}`, headers: bearer(cr) }));
  const classNotice = await postNotice(app, cr);
  expectSuccess(classNotice);
  const homeFeed = await app.inject({ method: 'GET', url: '/api/announcements', headers: bearer(student) });
  assert.ok(homeFeed.body.includes('Class trip update'));
  const badScope = await postNotice(app, master, { scope: 'global', subjectId: DEMO_SUBJECT_IDS.os });
  expectClientRejection(badScope, 'Global scope may not reference a class or subject');
});

test('subject management, trash and restoration preserve permission and parent boundaries', async (t) => {
  const app = await createTestApp(t);
  const cr = await demoToken(app, 'cr'), student = await demoToken(app, 'student');
  const form = { name: 'Networks', code: 'NET', instructor: 'Demo instructor', color: 'amber', description: 'Fictional subject.' };
  expectForbidden(await app.inject({ method: 'POST', url: `/api/classes/${DEMO_CLASS_ID}/subjects`, headers: bearer(student), payload: form }));
  expectForbidden(await app.inject({ method: 'POST', url: `/api/classes/${DEMO_OTHER_CLASS_ID}/subjects`, headers: bearer(cr), payload: form }));
  const created = await app.inject({ method: 'POST', url: `/api/classes/${DEMO_CLASS_ID}/subjects`, headers: bearer(cr), payload: form });
  expectSuccess(created);
  const id = created.json().subject.id;
  const duplicate = await app.inject({ method: 'POST', url: `/api/classes/${DEMO_CLASS_ID}/subjects`, headers: bearer(cr), payload: { ...form, name: 'networks' } });
  assert.equal(duplicate.statusCode, 409);
  const changed = await app.inject({ method: 'PATCH', url: `/api/subjects/${id}`, headers: bearer(cr), payload: { ...form, name: 'Computer Networks' } });
  expectSuccess(changed);
  const notice = await postNotice(app, cr, { scope: 'subject', subjectId: id, title: 'Network-only notice' });
  expectSuccess(notice);
  const noticeId = notice.json().announcement.id;
  expectSuccess(await app.inject({ method: 'POST', url: `/api/bookmarks/announcement/${noticeId}`, headers: bearer(student) }));
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/subjects/${id}`, headers: bearer(cr) }));
  for (const path of [`/api/subjects/${id}`, `/api/announcements/${noticeId}`]) expectForbidden(await app.inject({ method: 'GET', url: path, headers: bearer(student) }));
  for (const path of ['/api/announcements', '/api/announcements?saved=true', '/api/notifications']) {
    const response = await app.inject({ method: 'GET', url: path, headers: bearer(student) });
    expectSuccess(response);
    assert.ok(!response.body.includes('Network-only notice'), path);
  }
  expectForbidden(await app.inject({ method: 'GET', url: `/api/classes/${DEMO_CLASS_ID}/subjects?deleted=true`, headers: bearer(student) }));
  const trash = await app.inject({ method: 'GET', url: `/api/classes/${DEMO_CLASS_ID}/subjects?deleted=true`, headers: bearer(cr) });
  assert.ok(trash.body.includes(id));
  expectSuccess(await app.inject({ method: 'POST', url: `/api/subjects/${id}/restore`, headers: bearer(cr) }));
  const restored = await app.inject({ method: 'GET', url: `/api/announcements/${noticeId}`, headers: bearer(student) });
  expectSuccess(restored);
});

test('lecture upload uses private storage; authenticated attachment, bookmarks, trash and purge work', async (t) => {
  const app = await createTestApp(t);
  const cr = await demoToken(app, 'cr'), student = await demoToken(app, 'student');
  expectForbidden(await upload(app, student));
  const result = await upload(app, cr);
  expectSuccess(result);
  const resource = result.json().resource;
  assert.equal(resource.filename, 'lecture.pdf');
  assert.equal(resource.sizeBytes, pdf.length);
  assert.equal(resource.mimeType, 'application/pdf');
  assert.ok(!result.body.includes('storage_key') && !result.body.includes('private-storage'));
  const id = resource.id;
  const anonymous = await app.inject({ method: 'GET', url: `/api/resources/${id}/download` });
  assert.equal(anonymous.statusCode, 401);
  const download = await app.inject({ method: 'GET', url: `/api/resources/${id}/download`, headers: bearer(student) });
  expectSuccess(download);
  assert.deepEqual(download.rawPayload, pdf);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.match(String(download.headers['content-disposition']), /^attachment;/);
  assert.match(String(download.headers['cache-control']), /no-store/);
  const guessedPublic = await app.inject({ method: 'GET', url: `/private-storage/resources/${id}.pdf` });
  assert.notDeepEqual(guessedPublic.rawPayload, pdf);
  expectSuccess(await app.inject({ method: 'POST', url: `/api/bookmarks/resource/${id}`, headers: bearer(student) }));
  const saved = await app.inject({ method: 'GET', url: '/api/resources?saved=true&q=Lecture', headers: bearer(student) });
  assert.equal(saved.json().pagination.total, 1);
  assert.equal(saved.json().resources[0].saved, true);
  const attached = await postNotice(app, cr, { resourceIds: [id] });
  expectSuccess(attached);
  assert.equal(attached.json().announcement.resources.length, 1);
  const purgeBeforeTrash = await app.inject({ method: 'POST', url: `/api/resources/${id}/purge`, headers: bearer(cr) });
  assert.equal(purgeBeforeTrash.statusCode, 409);
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/resources/${id}`, headers: bearer(cr) }));
  expectForbidden(await app.inject({ method: 'GET', url: `/api/resources/${id}/download`, headers: bearer(student) }));
  const savedAfterTrash = await app.inject({ method: 'GET', url: '/api/resources?saved=true', headers: bearer(student) });
  assert.equal(savedAfterTrash.json().pagination.total, 0);
  const attachedAfterTrash = await app.inject({ method: 'GET', url: `/api/announcements/${attached.json().announcement.id}`, headers: bearer(student) });
  assert.equal(attachedAfterTrash.json().announcement.resources.length, 0);
  expectForbidden(await app.inject({ method: 'GET', url: `/api/resources?deleted=true&classId=${DEMO_CLASS_ID}`, headers: bearer(student) }));
  expectSuccess(await app.inject({ method: 'POST', url: `/api/resources/${id}/restore`, headers: bearer(cr) }));
  expectSuccess(await app.inject({ method: 'GET', url: `/api/resources/${id}/download`, headers: bearer(student) }));
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/resources/${id}`, headers: bearer(cr) }));
  expectSuccess(await app.inject({ method: 'POST', url: `/api/resources/${id}/purge`, headers: bearer(cr) }));
  expectForbidden(await app.inject({ method: 'POST', url: `/api/resources/${id}/restore`, headers: bearer(cr) }));
  const usage = await app.inject({ method: 'GET', url: `/api/resources?classId=${DEMO_CLASS_ID}`, headers: bearer(cr) });
  assert.equal(usage.json().storageUsedBytes, 0);
});

test('uploads reject fake document signatures, arbitrary archives, multiple files and mismatched subjects', async (t) => {
  const app = await createTestApp(t);
  const cr = await demoToken(app, 'cr');
  for (const [filename, data] of [
    ['renamed.pdf', Buffer.from('<html><script>alert(1)</script></html>')],
    ['incomplete.pdf', Buffer.from('%PDF-1.7 no end marker')],
    ['fake.ppt', Buffer.from('a presentation title')],
    ['fake.pptx', Buffer.from('PK\u0003\u0004not a zip directory')],
    ['program.exe', pdf], ['archive.zip', pdf],
  ] as const) {
    const response = await upload(app, cr, { title: 'Unsafe file' }, data, filename);
    expectClientRejection(response, filename);
  }
  expectClientRejection(await upload(app, cr, { title: 'Duplicate' }, pdf, 'lecture.pdf', true), 'Only one file may be uploaded');
  expectForbidden(await upload(app, cr, { title: 'Wrong subject', subjectId: DEMO_SUBJECT_IDS.other }));
  const list = await app.inject({ method: 'GET', url: '/api/resources', headers: bearer(cr) });
  assert.equal(list.json().pagination.total, 0);
});

test('revoked class membership removes files, bookmarks, notices and notifications immediately', async (t) => {
  const app = await createTestApp(t);
  const cr = await demoToken(app, 'cr'), student = await demoToken(app, 'student');
  const uploaded = await upload(app, cr);
  expectSuccess(uploaded);
  const id = uploaded.json().resource.id;
  expectSuccess(await app.inject({ method: 'POST', url: `/api/bookmarks/resource/${id}`, headers: bearer(student) }));
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.student.id}`, headers: bearer(cr) }));
  for (const path of [`/api/resources/${id}`, `/api/resources/${id}/download`, `/api/subjects/${DEMO_SUBJECT_IDS.os}`])
    expectForbidden(await app.inject({ method: 'GET', url: path, headers: bearer(student) }));
  const saved = await app.inject({ method: 'GET', url: '/api/resources?saved=true', headers: bearer(student) });
  assert.equal(saved.json().pagination.total, 0);
  const feed = await app.inject({ method: 'GET', url: '/api/announcements', headers: bearer(student) });
  assert.ok(feed.json().announcements.every((notice: { scope: string }) => notice.scope === 'global'));
  const notifications = await app.inject({ method: 'GET', url: '/api/notifications', headers: bearer(student) });
  assert.equal(notifications.json().pagination.total, 1);
  assert.equal(notifications.json().notifications[0].scope, 'global');
});

test('notification reads are account-specific and edits make a notice unread again', async (t) => {
  let stamp = new Date('2026-10-10T08:00:00.000Z');
  const app = await createTestApp(t, { now: () => stamp });
  const student = await demoToken(app, 'student'), cr = await demoToken(app, 'cr');
  const notice = await postNotice(app, cr), id = notice.json().announcement.id;
  expectSuccess(notice);
  expectSuccess(await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: bearer(student) }));
  const empty = await app.inject({ method: 'GET', url: '/api/notifications?unread=true', headers: bearer(student) });
  assert.equal(empty.json().unreadCount, 0);
  const crUnread = await app.inject({ method: 'GET', url: '/api/notifications?unread=true', headers: bearer(cr) });
  assert.equal(crUnread.json().unreadCount, 4);
  stamp = new Date(stamp.getTime() + 1000);
  expectSuccess(await app.inject({ method: 'PATCH', url: `/api/announcements/${id}`, headers: bearer(cr), payload: { title: 'Changed notice', body: 'New details.' } }));
  const changed = await app.inject({ method: 'GET', url: '/api/notifications?unread=true', headers: bearer(student) });
  assert.equal(changed.json().unreadCount, 1);
  assert.equal(changed.json().notifications[0].id, id);
  expectSuccess(await app.inject({ method: 'POST', url: `/api/notifications/${id}/read`, headers: bearer(student) }));
  expectForbidden(await app.inject({ method: 'POST', url: '/api/notifications/30000000-0000-4000-8000-000000000004/read', headers: bearer(student) }));
});

test('subject feature flag removes nested content from every read surface and re-enables safely', async (t) => {
  const { storage } = memoryStorage();
  const { app, db } = await controlledApp(t, storage);
  const cr = await demoToken(app, 'cr'), student = await demoToken(app, 'student');
  const result = await upload(app, cr);
  expectSuccess(result);
  const id = result.json().resource.id;
  expectSuccess(await app.inject({ method: 'POST', url: `/api/bookmarks/resource/${id}`, headers: bearer(student) }));
  const attached = await postNotice(app, cr, { resourceIds: [id] });
  expectSuccess(attached);
  const flags = { subjects: false, resources: true, announcements: true, tutor: true, profilePhotos: true };
  await db.execute({ sql: 'UPDATE site_settings SET features_json=? WHERE id=1', args: [JSON.stringify(flags)] });
  for (const path of [`/api/subjects/${DEMO_SUBJECT_IDS.os}`, `/api/resources/${id}/download`])
    expectForbidden(await app.inject({ method: 'GET', url: path, headers: bearer(student) }));
  const saved = await app.inject({ method: 'GET', url: '/api/resources?saved=true', headers: bearer(student) });
  assert.equal(saved.json().pagination.total, 0);
  const attachedView = await app.inject({ method: 'GET', url: `/api/announcements/${attached.json().announcement.id}`, headers: bearer(student) });
  assert.equal(attachedView.json().announcement.resources.length, 0);
  const notes = await app.inject({ method: 'GET', url: '/api/notifications', headers: bearer(student) });
  assert.ok(notes.json().notifications.every((notice: { subjectId: string | null }) => !notice.subjectId));
  flags.subjects = true;
  await db.execute({ sql: 'UPDATE site_settings SET features_json=? WHERE id=1', args: [JSON.stringify(flags)] });
  expectSuccess(await app.inject({ method: 'GET', url: `/api/resources/${id}/download`, headers: bearer(student) }));
  flags.resources = false;
  await db.execute({ sql: 'UPDATE site_settings SET features_json=? WHERE id=1', args: [JSON.stringify(flags)] });
  const noticeId = attached.json().announcement.id;
  const textEdit = await app.inject({ method: 'PATCH', url: `/api/announcements/${noticeId}`, headers: bearer(cr),
    payload: { title: 'Text edited while files paused', body: 'The original attachment should be retained.' } });
  expectSuccess(textEdit);
  assert.equal(textEdit.json().announcement.resources.length, 0);
  flags.resources = true;
  await db.execute({ sql: 'UPDATE site_settings SET features_json=? WHERE id=1', args: [JSON.stringify(flags)] });
  const resumed = await app.inject({ method: 'GET', url: `/api/announcements/${noticeId}`, headers: bearer(student) });
  assert.equal(resumed.json().announcement.resources[0].id, id, 'Editing text while files are off preserves its hidden attachment');
});

test('storage quota counts trash; rejected finalization removes its private object', async (t) => {
  const { storage, objects, deleted } = memoryStorage();
  const { app, db } = await controlledApp(t, storage);
  const cr = await demoToken(app, 'cr');
  const firstUpload = await upload(app, cr);
  expectSuccess(firstUpload);
  const id = firstUpload.json().resource.id;
  await db.execute({ sql: 'UPDATE resources SET size_bytes=? WHERE id=?', args: [CLASS_STORAGE_BYTES - pdf.length + 1, id] });
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/resources/${id}`, headers: bearer(cr) }));
  const overQuota = await upload(app, cr, { title: 'One byte over quota' });
  assert.equal(overQuota.statusCode, 409, overQuota.body);
  assert.equal(overQuota.json().error.code, 'storage_quota');
  assert.equal(objects.size, 1, 'Only the previously accepted object remains');
  assert.equal(deleted.length, 1, 'Rejected object is compensated in storage');
  assert.equal(Number((await first(db, 'SELECT COUNT(*) AS n FROM resources'))?.n), 1);
});

test('permission changes during object upload reject finalization and clean stored bytes', async (t) => {
  const { storage, objects } = memoryStorage();
  const { app, db } = await controlledApp(t, storage);
  const cr = await demoToken(app, 'cr');
  const originalPut = storage.putFile;
  storage.putFile = async (...args) => {
    await originalPut(...args);
    await db.execute({ sql: "UPDATE memberships SET role='student' WHERE class_id=? AND user_id=?", args: [DEMO_CLASS_ID, DEMO_USERS.cr.id] });
  };
  const result = await upload(app, cr);
  expectForbidden(result);
  assert.equal(objects.size, 0);
  assert.equal(Number((await first(db, 'SELECT COUNT(*) AS n FROM resources'))?.n), 0);
});

test('failed purge remains hidden and retryable instead of claiming a missing file is restored', async (t) => {
  const { storage, objects } = memoryStorage();
  const { app } = await controlledApp(t, storage);
  const cr = await demoToken(app, 'cr'), student = await demoToken(app, 'student');
  const result = await upload(app, cr);
  expectSuccess(result);
  const id = result.json().resource.id;
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/resources/${id}`, headers: bearer(cr) }));
  const originalDelete = storage.delete;
  storage.delete = async () => { throw new Error('Injected storage outage'); };
  const failed = await app.inject({ method: 'POST', url: `/api/resources/${id}/purge`, headers: bearer(cr) });
  assert.equal(failed.statusCode, 500);
  expectForbidden(await app.inject({ method: 'GET', url: `/api/resources/${id}/download`, headers: bearer(student) }));
  const restore = await app.inject({ method: 'POST', url: `/api/resources/${id}/restore`, headers: bearer(cr) });
  assert.equal(restore.statusCode, 409);
  const trash = await app.inject({ method: 'GET', url: '/api/resources?deleted=true', headers: bearer(cr) });
  assert.equal(trash.json().resources[0].storageState, 'deleting');
  storage.delete = originalDelete;
  expectSuccess(await app.inject({ method: 'POST', url: `/api/resources/${id}/purge`, headers: bearer(cr) }));
  assert.equal(objects.size, 0);
});

test('announcement trash, restore and bookmark permissions stay within its audience', async (t) => {
  const app = await createTestApp(t);
  const cr = await demoToken(app, 'cr'), student = await demoToken(app, 'student');
  const result = await postNotice(app, cr), id = result.json().announcement.id;
  expectSuccess(result);
  expectSuccess(await app.inject({ method: 'POST', url: `/api/bookmarks/announcement/${id}`, headers: bearer(student) }));
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/announcements/${id}`, headers: bearer(cr) }));
  expectForbidden(await app.inject({ method: 'GET', url: `/api/announcements/${id}`, headers: bearer(student) }));
  expectForbidden(await app.inject({ method: 'POST', url: `/api/announcements/${id}/restore`, headers: bearer(student) }));
  const search = await app.inject({ method: 'GET', url: '/api/announcements?saved=true', headers: bearer(student) });
  assert.equal(search.json().pagination.total, 0);
  const trash = await app.inject({ method: 'GET', url: '/api/announcements?deleted=true', headers: bearer(cr) });
  assert.equal(trash.json().pagination.total, 1);
  expectSuccess(await app.inject({ method: 'POST', url: `/api/announcements/${id}/restore`, headers: bearer(cr) }));
  const restored = await app.inject({ method: 'GET', url: '/api/announcements?saved=true', headers: bearer(student) });
  assert.equal(restored.json().announcements[0].id, id);
});
