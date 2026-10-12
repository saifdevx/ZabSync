import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const stamp = '2026-10-11T19:30:00.000Z';
const manifestUrl = '/api/offline/access';
const noticeIds = {
  global: '30000000-0000-4000-8000-000000000001',
  ownClass: '30000000-0000-4000-8000-000000000002',
  subject: '30000000-0000-4000-8000-000000000003',
  otherClass: '30000000-0000-4000-8000-000000000004',
};

async function manifestApp(t: TestContext) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.manifest-'));
  const databaseUrl = pathToFileURL(join(directory, 'data.sqlite')).href;
  const db = await openDatabase(databaseUrl);
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  t.after(async () => {
    try {
      await app?.close();
    } finally {
      db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  app = await createApp({
    db,
    config: makeTestConfig({ databaseUrl }),
    now: () => new Date(stamp),
  });
  await app.ready();
  async function resource(
    classId: string,
    subjectId: string | null = null,
    state: 'ready' | 'deleting' | 'trashed' = 'ready',
  ) {
    const id = randomUUID(),
      key = `resources/${randomUUID()}.pdf`;
    // Metadata fixtures only: this suite verifies access manifests, not file storage or downloads.
    await db.execute({
      sql: 'INSERT INTO resources(id,class_id,subject_id,title,filename,mime_type,size_bytes,storage_key,storage_state,created_by,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: [
        id,
        classId,
        subjectId,
        'Fictional manifest fixture',
        'example.pdf',
        'application/pdf',
        40,
        key,
        state === 'deleting' ? 'deleting' : 'ready',
        DEMO_USERS.master.id,
        stamp,
        stamp,
        state === 'trashed' ? stamp : null,
      ],
    });
    return { id, key };
  }
  const settings = (await db.execute('SELECT features_json FROM site_settings WHERE id=1'))
    .rows[0]!;
  const features = JSON.parse(String(settings.features_json)) as Record<string, boolean>;
  async function setFeatures(values: Record<string, boolean>) {
    Object.assign(features, values);
    await db.execute({
      sql: 'UPDATE site_settings SET features_json=? WHERE id=1',
      args: [JSON.stringify(features)],
    });
  }
  return { app, db, resource, setFeatures };
}

test('offline manifests use a real read transaction, match class and parent visibility, and expose no private storage keys', async (t) => {
  const { app, db, resource, setFeatures } = await manifestApp(t);
  const student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin'),
    master = await demoToken(app, 'master');
  const general = await resource(DEMO_CLASS_ID),
    nested = await resource(DEMO_CLASS_ID, DEMO_SUBJECT_IDS.os);
  const other = await resource(DEMO_OTHER_CLASS_ID),
    trashed = await resource(DEMO_CLASS_ID, null, 'trashed'),
    deleting = await resource(DEMO_CLASS_ID, null, 'deleting');
  assert.equal((await app.inject({ method: 'GET', url: manifestUrl })).statusCode, 401);
  const response = await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) });
  expectSuccess(response);
  const visible = response.json();
  assert.equal(visible.userId, DEMO_USERS.student.id);
  assert.equal(visible.generatedAt, stamp);
  assert.deepEqual(visible.classIds, [DEMO_CLASS_ID]);
  assert.deepEqual(
    visible.classes.map((value: { id: string }) => value.id),
    [DEMO_CLASS_ID],
  );
  assert.deepEqual(visible.subjectIds.sort(), [DEMO_SUBJECT_IDS.os, DEMO_SUBJECT_IDS.db].sort());
  assert.deepEqual(visible.resourceIds.sort(), [general.id, nested.id].sort());
  assert.deepEqual(
    visible.announcementIds.sort(),
    [noticeIds.global, noticeIds.ownClass, noticeIds.subject].sort(),
  );
  assert.deepEqual(
    Object.keys(visible.resources[0]).sort(),
    ['id', 'classId', 'updatedAt', 'filename', 'title', 'mimeType', 'sizeBytes'].sort(),
  );
  assert.ok(!response.body.includes(DEMO_USERS.otherAdmin.email));
  for (const fixture of [general, nested, other, trashed, deleting])
    assert.ok(!response.body.includes(fixture.key));
  assert.ok(!response.body.includes('storage_key'));
  assert.ok(!response.body.includes('join_code'));
  const owner = await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(master) });
  expectSuccess(owner);
  assert.deepEqual(owner.json().classIds.sort(), [DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID].sort());
  assert.ok(owner.json().resourceIds.includes(other.id));
  assert.ok(owner.json().announcementIds.includes(noticeIds.otherClass));
  assert.ok(!owner.json().resourceIds.includes(trashed.id));
  assert.ok(!owner.json().resourceIds.includes(deleting.id));

  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}`,
      headers: bearer(admin),
    }),
  );
  const parentTrashed = (
    await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) })
  ).json();
  assert.deepEqual(parentTrashed.resourceIds, [general.id]);
  assert.ok(!parentTrashed.subjectIds.includes(DEMO_SUBJECT_IDS.os));
  assert.ok(!parentTrashed.announcementIds.includes(noticeIds.subject));
  assert.ok(parentTrashed.announcementIds.includes(noticeIds.ownClass));
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/restore`,
      headers: bearer(admin),
    }),
  );
  const restored = (
    await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) })
  ).json();
  assert.ok(restored.resourceIds.includes(nested.id));
  assert.ok(restored.announcementIds.includes(noticeIds.subject));

  await setFeatures({ subjects: false });
  const noSubjects = (
    await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) })
  ).json();
  assert.deepEqual(noSubjects.subjectIds, []);
  assert.deepEqual(noSubjects.resourceIds, [general.id]);
  assert.ok(!noSubjects.announcementIds.includes(noticeIds.subject));
  await setFeatures({ resources: false, announcements: false });
  const paused = (
    await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) })
  ).json();
  assert.deepEqual(paused.resources, []);
  assert.deepEqual(paused.resourceIds, []);
  assert.deepEqual(paused.announcementIds, []);
  assert.deepEqual(paused.classIds, [DEMO_CLASS_ID]);
  assert.equal(paused.features.timetable, true);
  assert.equal(paused.features.deadlines, true);
  await db.execute('UPDATE site_settings SET maintenance_enabled=1 WHERE id=1');
  expectSuccess(await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) }));
});

test('offline manifests withdraw archived and revoked class scopes and reject a suspended account on its existing token', async (t) => {
  const { app, db, resource } = await manifestApp(t);
  const student = await demoToken(app, 'student'),
    master = await demoToken(app, 'master');
  await resource(DEMO_CLASS_ID, DEMO_SUBJECT_IDS.os);
  await db.execute({
    sql: "UPDATE classes SET status='archived' WHERE id=?",
    args: [DEMO_CLASS_ID],
  });
  const archived = await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) });
  expectSuccess(archived);
  assert.deepEqual(archived.json().classIds, []);
  assert.deepEqual(archived.json().subjectIds, []);
  assert.deepEqual(archived.json().resourceIds, []);
  assert.deepEqual(archived.json().announcementIds, [noticeIds.global]);
  const owner = (
    await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(master) })
  ).json();
  assert.deepEqual(owner.classIds, [DEMO_OTHER_CLASS_ID]);

  await db.execute({ sql: "UPDATE classes SET status='active' WHERE id=?", args: [DEMO_CLASS_ID] });
  for (const status of ['pending', 'removed']) {
    await db.execute({
      sql: 'UPDATE memberships SET status=? WHERE class_id=? AND user_id=?',
      args: [status, DEMO_CLASS_ID, DEMO_USERS.student.id],
    });
    const revoked = await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) });
    expectSuccess(revoked);
    assert.deepEqual(revoked.json().classIds, []);
    assert.deepEqual(revoked.json().subjectIds, []);
    assert.deepEqual(revoked.json().resourceIds, []);
    assert.deepEqual(revoked.json().announcementIds, [noticeIds.global]);
    expectForbidden(
      await app.inject({
        method: 'GET',
        url: `/api/classes/${DEMO_CLASS_ID}/timetable`,
        headers: bearer(student),
      }),
    );
  }
  await db.execute({
    sql: "UPDATE users SET status='suspended' WHERE id=?",
    args: [DEMO_USERS.student.id],
  });
  expectForbidden(await app.inject({ method: 'GET', url: manifestUrl, headers: bearer(student) }));
});
