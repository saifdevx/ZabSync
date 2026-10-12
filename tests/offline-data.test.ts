import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { ApiError } from '../client/src/auth.js';
import { buildOfflineSnapshot, offlineResponse } from '../client/src/offline-data.js';
import {
  OfflineStorageError,
  OfflineStore,
  type OfflineAccess,
} from '../client/src/offline-store.js';
import type { MeResponse } from '../client/src/types.js';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, demoToken, expectSuccess } from './helpers.js';
import { offlineNow, offlineTestApp, pdf } from './offline-fixtures.js';

test('complete snapshots use real authorized API data, all pages, and the shared offline week resolver', async (t) => {
  const { app, db, reader, upload, calls } = await offlineTestApp(t);
  const student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin');
  const resource = await upload(admin, DEMO_SUBJECT_IDS.os);
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/bookmarks/resource/${resource.id}`,
      headers: bearer(student),
    }),
  );
  const stamp = new Date(offlineNow).toISOString();
  // More than one API page, seeded directly into the real DB to avoid artificial write-rate-limit pressure.
  const tx = await db.transaction('write');
  for (let index = 0; index < 104; index++)
    await tx.execute({
      sql: 'INSERT INTO deadlines(id,class_id,kind,title,description,due_date,due_time,due_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      args: [
        randomUUID(),
        DEMO_CLASS_ID,
        'assignment',
        `Offline assignment ${index}`,
        'Fictional offline test',
        '2026-10-20',
        '10:00',
        '2026-10-20T05:00:00.000Z',
        DEMO_USERS.admin.id,
        stamp,
        stamp,
      ],
    });
  await tx.commit();
  tx.close();
  const extra = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`,
    headers: bearer(admin),
    payload: {
      kind: 'extra',
      date: '2027-10-21',
      title: 'Distant dated test session',
      startTime: '09:00',
      endTime: '10:00',
    },
  });
  expectSuccess(extra);
  const snapshot = await buildOfflineSnapshot(reader(student), DEMO_USERS.student.id, offlineNow);
  assert.deepEqual(
    snapshot.me.classes.map((value) => value.id),
    [DEMO_CLASS_ID],
  );
  assert.deepEqual(snapshot.classDetails[DEMO_CLASS_ID].members, []);
  assert.deepEqual(snapshot.classDetails[DEMO_CLASS_ID].pendingMembers, []);
  assert.equal(snapshot.classDetails[DEMO_CLASS_ID].invite, null);
  assert.equal(snapshot.me.canCreateClass, false);
  assert.deepEqual(snapshot.me.classRequests, []);
  assert.ok(!JSON.stringify(snapshot).includes('storage_key'));
  assert.ok(!JSON.stringify(snapshot).includes(student));
  assert.ok(calls.some((path) => path.endsWith('/deadlines?limit=100&offset=100')));
  assert.ok(calls.some((path) => path.includes('/schedule-exceptions?all=true')));
  assert.ok(
    snapshot.exceptions[DEMO_CLASS_ID].some((value) => value.id === extra.json().exception.id),
  );
  const compare = async (path: string) =>
    assert.deepEqual(
      offlineResponse(snapshot, path, offlineNow),
      await reader(student)(path),
      path,
    );
  await compare('/announcements?limit=2&offset=1');
  await compare(
    `/announcements?classId=${DEMO_CLASS_ID}&scope=class&limit=20&saved=false&deleted=false`,
  );
  await compare(`/classes/${DEMO_CLASS_ID}/subjects?limit=24&q=OS&deleted=false&offset=0`);
  await compare(`/classes/${DEMO_CLASS_ID}/timetable?week=2027-10-18`);
  await compare(
    `/classes/${DEMO_CLASS_ID}/deadlines?limit=20&offset=100&kind=assignment&completed=false`,
  );
  await compare('/notifications?unread=true&limit=1');
  const resources = offlineResponse<{
    resources: { id: string; saved: boolean; canManage: boolean }[];
  }>(snapshot, '/resources?limit=20&saved=true', offlineNow);
  assert.deepEqual(
    resources.resources.map((value) => [value.id, value.saved, value.canManage]),
    [[resource.id, true, false]],
  );
  for (const path of [
    '/admin/overview',
    '/users/any/avatar',
    '/resources?deleted=true',
    '/developer',
    '/offline/access',
  ])
    assert.throws(() => offlineResponse(snapshot, path, offlineNow), OfflineStorageError, path);
});

test('the owner console cannot prepare offline data while Class Admins retain only their enrolled class scope', async (t) => {
  const { app, reader, calls } = await offlineTestApp(t),
    master = await demoToken(app, 'master');
  await assert.rejects(
    buildOfflineSnapshot(reader(master), DEMO_USERS.master.id, offlineNow),
    (error: unknown) =>
      error instanceof OfflineStorageError && error.code === 'OFFLINE_OWNER_DISABLED',
  );
  assert.deepEqual(
    calls,
    ['/me'],
    'The owner identity is rejected before any academic content is downloaded.',
  );
  await assert.rejects(
    buildOfflineSnapshot(reader(master), DEMO_USERS.student.id, offlineNow),
    (error: unknown) => error instanceof OfflineStorageError && error.code === 'OFFLINE_CHANGED',
  );
  const admin = await demoToken(app, 'admin');
  const snapshot = await buildOfflineSnapshot(reader(admin), DEMO_USERS.admin.id, offlineNow);
  assert.deepEqual(
    snapshot.me.classes.map((value) => value.id),
    [DEMO_CLASS_ID],
  );
  assert.equal(snapshot.me.user.role, 'student');
  assert.ok(snapshot.subjects.every((value) => value.canManage === false));
  assert.ok(snapshot.announcements.every((value) => value.canManage === false));
  assert.deepEqual(
    Object.values(snapshot.classDetails).flatMap((value) => value.members),
    [],
  );
});

test('a real membership/feature revocation prunes offline scope and explicitly saved file bytes', async (t) => {
  const { app, db, reader, upload } = await offlineTestApp(t);
  const student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin');
  const resource = await upload(admin, DEMO_SUBJECT_IDS.os);
  // A persistent factory represents one browser storage partition.
  const weekly = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/timetable`,
    headers: bearer(admin),
    payload: {
      title: 'Parent subject deletion test',
      subjectId: DEMO_SUBJECT_IDS.os,
      weekday: 1,
      startTime: '13:00',
      endTime: '14:00',
    },
  });
  expectSuccess(weekly);
  const moved = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`,
    headers: bearer(admin),
    payload: {
      kind: 'rescheduled',
      entryId: weekly.json().entry.id,
      originalDate: '2026-10-12',
      date: '2026-10-13',
      subjectId: DEMO_SUBJECT_IDS.db,
      startTime: '13:00',
      endTime: '14:00',
    },
  });
  expectSuccess(moved);
  const factory = new IDBFactory(),
    device = new OfflineStore(
      () => factory,
      () => offlineNow,
    );
  const lease = await device.activateVerifiedAccount(DEMO_USERS.student.id);
  await device.commit(
    lease,
    await buildOfflineSnapshot(reader(student), DEMO_USERS.student.id, offlineNow),
  );
  const download = await app.inject({
    method: 'GET',
    url: `/api/resources/${resource.id}/download`,
    headers: bearer(student),
  });
  assert.equal(download.statusCode, 200);
  await device.saveFile(
    lease,
    resource,
    new Blob([new Uint8Array(download.rawPayload)], { type: 'application/pdf' }),
  );
  assert.equal(await (await device.file(lease.userId, resource.id))?.text(), pdf);
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}`,
      headers: bearer(admin),
    }),
  );
  await device.revalidate(
    (await device.snapshot())!.lease,
    await reader(student)<OfflineAccess>('/offline/access'),
    await reader(student)<MeResponse>('/me'),
  );
  assert.equal(await device.file(lease.userId, resource.id), null);
  assert.ok(
    !(await device.snapshot(lease.userId))!.snapshot.subjects.some(
      (value) => value.id === DEMO_SUBJECT_IDS.os,
    ),
  );
  const withoutParent = (await device.snapshot())!.snapshot;
  assert.ok(
    !withoutParent.exceptions[DEMO_CLASS_ID].some(
      (value) => value.id === moved.json().exception.id,
    ),
    'An override cannot survive the hidden weekly parent by choosing another active subject.',
  );
  assert.deepEqual(
    offlineResponse(
      withoutParent,
      `/classes/${DEMO_CLASS_ID}/schedule-exceptions?all=true&limit=100`,
      offlineNow,
    ),
    await reader(student)(`/classes/${DEMO_CLASS_ID}/schedule-exceptions?all=true&limit=100`),
  );
  await db.execute({
    sql: "UPDATE memberships SET status='removed' WHERE class_id=? AND user_id=?",
    args: [DEMO_CLASS_ID, DEMO_USERS.student.id],
  });
  await device.revalidate(
    (await device.snapshot())!.lease,
    await reader(student)<OfflineAccess>('/offline/access'),
    await reader(student)<MeResponse>('/me'),
  );
  const pruned = (await device.snapshot(lease.userId))!.snapshot;
  assert.deepEqual(pruned.me.classes, []);
  assert.deepEqual(pruned.classDetails, {});
  assert.deepEqual(pruned.timetables, {});
  assert.deepEqual(pruned.deadlines, {});
  assert.ok(pruned.announcements.every((value) => value.scope === 'global'));
  assert.equal(
    pruned.savedAt,
    new Date(offlineNow).toISOString(),
    'Validation must not pretend a full sync happened.',
  );
});

test('permission errors and access changes abort a new snapshot without returning partial content', async (t) => {
  const { app, db, reader } = await offlineTestApp(t),
    student = await demoToken(app, 'student');
  let accessReads = 0;
  const changingReader = async <T>(path: string): Promise<T> => {
    if (path === '/offline/access' && ++accessReads === 2)
      await db.execute({
        sql: "UPDATE memberships SET status='removed' WHERE class_id=? AND user_id=?",
        args: [DEMO_CLASS_ID, DEMO_USERS.student.id],
      });
    return reader(student)<T>(path);
  };
  await assert.rejects(
    buildOfflineSnapshot(changingReader, DEMO_USERS.student.id, offlineNow),
    (error: unknown) => error instanceof OfflineStorageError && error.code === 'OFFLINE_CHANGED',
  );
  await db.execute({
    sql: "UPDATE users SET status='suspended' WHERE id=?",
    args: [DEMO_USERS.student.id],
  });
  await assert.rejects(
    buildOfflineSnapshot(reader(student), DEMO_USERS.student.id, offlineNow),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
});
