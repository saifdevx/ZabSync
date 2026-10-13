import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { openDatabase, rows } from '../server/db.js';
import { createPrivateStorage } from '../server/storage.js';
import { bearer, demoToken, expectSuccess } from './helpers.js';

type WriteRequest = {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: Record<string, unknown> | Buffer;
  headers?: Record<string, string>;
};

function lectureUpload(subjectId: string) {
  const boundary = `zabsync-${randomUUID()}`;
  const bytes = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nLecture notes\r\n--${boundary}\r\nContent-Disposition: form-data; name="subjectId"\r\n\r\n${subjectId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lecture.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    bytes,
  };
}

test('student direct requests cannot publish, edit or remove shared class content; personal progress remains independent', async (t) => {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.student-permissions-'));
  const databaseUrl = pathToFileURL(join(directory, 'campus.sqlite')).href;
  const db = await openDatabase(databaseUrl);
  const objectDirectory = join(directory, 'objects');
  const storage = createPrivateStorage({ driver: 'local', localDirectory: objectDirectory });
  const app = await createApp({ config: makeTestConfig({ databaseUrl }), db, storage });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin'),
    owner = await demoToken(app, 'master');
  async function write(token: string, request: WriteRequest) {
    return app.inject({ ...request, headers: { ...bearer(token), ...request.headers } });
  }
  const classForm = {
    name: 'Unauthorized 6A',
    program: 'BS Computer Science',
    semester: 6,
    section: 'A',
    description: '',
  };
  const subjectForm = {
    name: 'Permission regression subject',
    code: 'SEC301',
    instructor: 'Teacher',
    description: '',
    color: 'teal',
  };
  const subjectResponse = await write(admin, {
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/subjects`,
    payload: subjectForm,
  });
  expectSuccess(subjectResponse);
  const subjectId = subjectResponse.json().subject.id;
  const subjectInvite = await write(admin, {
    method: 'POST',
    url: `/api/subjects/${subjectId}/invite`,
  });
  expectSuccess(subjectInvite);
  expectSuccess(
    await write(student, {
      method: 'POST',
      url: '/api/subjects/join',
      payload: { code: subjectInvite.json().code },
    }),
  );

  const upload = lectureUpload(subjectId);
  const resourceResponse = await write(admin, {
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/resources`,
    payload: upload.payload,
    headers: upload.headers,
  });
  expectSuccess(resourceResponse);
  const resourceId = resourceResponse.json().resource.id;
  const noticeContent = {
    title: 'Read-only shared notice',
    body: 'Published by an authorized class admin.',
    priority: 'important',
    pinned: false,
  };
  const noticeRequests: WriteRequest[] = [
    {
      method: 'POST',
      url: '/api/announcements',
      payload: { ...noticeContent, scope: 'class', classId: DEMO_CLASS_ID },
    },
    {
      method: 'POST',
      url: '/api/announcements',
      payload: { ...noticeContent, scope: 'subject', classId: DEMO_CLASS_ID, subjectId },
    },
    { method: 'POST', url: '/api/announcements', payload: { ...noticeContent, scope: 'global' } },
  ];
  const noticeIds: string[] = [];
  for (const request of noticeRequests) {
    const response = await write(
      request.payload && 'scope' in request.payload && request.payload.scope === 'global'
        ? owner
        : admin,
      request,
    );
    expectSuccess(response);
    noticeIds.push(response.json().announcement.id);
  }
  const weeklyForm = {
    title: 'Permission regression class',
    subjectId,
    weekday: 7,
    startTime: '15:00',
    endTime: '16:00',
    teacher: 'Teacher',
    room: '204',
    notes: '',
  };
  const weeklyResponse = await write(admin, {
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/timetable`,
    payload: weeklyForm,
  });
  expectSuccess(weeklyResponse);
  const entryId = weeklyResponse.json().entry.id;
  const exceptionForm = {
    kind: 'extra',
    date: '2026-10-19',
    title: 'Extra permission class',
    subjectId,
    startTime: '11:00',
    endTime: '12:00',
    teacher: 'Teacher',
    room: '204',
    notes: '',
  };
  const exceptionResponse = await write(admin, {
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`,
    payload: exceptionForm,
  });
  expectSuccess(exceptionResponse);
  const exceptionId = exceptionResponse.json().exception.id;
  const deadlineForm = {
    kind: 'assignment',
    title: 'Read-only assignment',
    description: 'Assigned to the class.',
    subjectId,
    dueDate: '2026-10-20',
    dueTime: '23:59',
  };
  const deadlineResponse = await write(admin, {
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/deadlines`,
    payload: deadlineForm,
  });
  expectSuccess(deadlineResponse);
  const deadlineId = deadlineResponse.json().deadline.id;
  const tables = [
    'classes',
    'subjects',
    'resources',
    'announcements',
    'announcement_resources',
    'timetable_entries',
    'schedule_exceptions',
    'deadlines',
    'audit_logs',
  ];
  async function sharedSnapshot() {
    return Promise.all(
      tables.map(async (table) => ({
        table,
        records: await rows(db, `SELECT * FROM ${table} ORDER BY rowid`),
      })),
    );
  }
  const before = await sharedSnapshot();
  const beforeObjects = (await readdir(objectDirectory, { recursive: true })).sort();
  const deniedWrites: WriteRequest[] = [
    { method: 'POST', url: '/api/classes', payload: classForm },
    { method: 'PATCH', url: `/api/classes/${DEMO_CLASS_ID}`, payload: classForm },
    { method: 'POST', url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite` },
    {
      method: 'POST',
      url: `/api/classes/${DEMO_CLASS_ID}/subjects`,
      payload: { ...subjectForm, name: 'Unauthorized new subject' },
    },
    {
      method: 'PATCH',
      url: `/api/subjects/${subjectId}`,
      payload: { ...subjectForm, name: 'Unauthorized subject edit' },
    },
    { method: 'DELETE', url: `/api/subjects/${subjectId}` },
    { method: 'POST', url: `/api/subjects/${subjectId}/restore` },
    {
      method: 'POST',
      url: `/api/classes/${DEMO_CLASS_ID}/resources`,
      payload: upload.payload,
      headers: upload.headers,
    },
    {
      method: 'PATCH',
      url: `/api/resources/${resourceId}`,
      payload: { title: 'Unauthorized lecture edit', description: '' },
    },
    { method: 'DELETE', url: `/api/resources/${resourceId}` },
    { method: 'POST', url: `/api/resources/${resourceId}/restore` },
    ...noticeRequests,
    ...noticeIds.flatMap((id): WriteRequest[] => [
      {
        method: 'PATCH',
        url: `/api/announcements/${id}`,
        payload: { ...noticeContent, title: 'Unauthorized notice edit' },
      },
      { method: 'DELETE', url: `/api/announcements/${id}` },
      { method: 'POST', url: `/api/announcements/${id}/restore` },
    ]),
    {
      method: 'POST',
      url: `/api/classes/${DEMO_CLASS_ID}/timetable`,
      payload: { ...weeklyForm, title: 'Unauthorized new weekly class' },
    },
    {
      method: 'PATCH',
      url: `/api/timetable/${entryId}`,
      payload: { ...weeklyForm, title: 'Unauthorized weekly edit', version: 1 },
    },
    { method: 'DELETE', url: `/api/timetable/${entryId}?version=1` },
    {
      method: 'POST',
      url: `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`,
      payload: { ...exceptionForm, title: 'Unauthorized extra class' },
    },
    {
      method: 'PATCH',
      url: `/api/schedule-exceptions/${exceptionId}`,
      payload: { ...exceptionForm, title: 'Unauthorized extra-class edit', version: 1 },
    },
    { method: 'DELETE', url: `/api/schedule-exceptions/${exceptionId}?version=1` },
    {
      method: 'POST',
      url: `/api/classes/${DEMO_CLASS_ID}/deadlines`,
      payload: { ...deadlineForm, title: 'Unauthorized deadline' },
    },
    {
      method: 'PATCH',
      url: `/api/deadlines/${deadlineId}`,
      payload: { ...deadlineForm, title: 'Unauthorized deadline edit', version: 1 },
    },
    { method: 'DELETE', url: `/api/deadlines/${deadlineId}?version=1` },
  ];
  // Reuse the successfully uploaded multipart payload so denial comes from
  // permissions, not a malformed boundary, document signature or metadata.
  for (const request of deniedWrites) {
    const response = await write(student, {
      ...request,
      headers: { ...request.headers, 'x-role': 'master' },
    });
    assert.equal(response.statusCode, 403, `${request.method} ${request.url}: ${response.body}`);
    assert.ok(
      ['admin_required', 'master_required', 'class_creation_forbidden'].includes(
        response.json().error.code,
      ),
      `${request.url} must deny authority, not validation.`,
    );
  }
  assert.equal(
    (await write(student, { method: 'POST', url: '/api/class-requests', payload: classForm }))
      .statusCode,
    410,
  );
  assert.deepEqual(
    await sharedSnapshot(),
    before,
    'Denied requests must leave shared content, versions and audit history unchanged.',
  );
  assert.deepEqual(
    (await readdir(objectDirectory, { recursive: true })).sort(),
    beforeObjects,
    'A denied upload must not create a stored object.',
  );
  const download = await app.inject({
    method: 'GET',
    url: `/api/resources/${resourceId}/download`,
    headers: bearer(student),
  });
  expectSuccess(download);
  assert.deepEqual(download.rawPayload, upload.bytes);
  const personalProgress = await write(student, {
    method: 'PATCH',
    url: `/api/deadlines/${deadlineId}/completion`,
    payload: { completed: true, version: 1 },
  });
  expectSuccess(personalProgress);
  assert.equal(personalProgress.json().deadline.completed, true);
  const progressRows = await rows(
    db,
    'SELECT user_id,deadline_id FROM deadline_completions WHERE deadline_id=?',
    [deadlineId],
  );
  assert.deepEqual(
    progressRows.map((row) => ({ userId: row.user_id, deadlineId: row.deadline_id })),
    [{ userId: DEMO_USERS.student.id, deadlineId }],
  );
  assert.deepEqual(
    await sharedSnapshot(),
    before,
    'Personal completion must not edit the shared assignment or another student.',
  );
});
