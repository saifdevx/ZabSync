import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, first, rows } from '../server/db.js';
import { makeTestConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { createDemoSession } from '../server/auth.js';
import { bearer, expectForbidden, expectSuccess } from './helpers.js';

test('upgrade preserves legacy multi-section history, binds sole membership, and requires explicit owner resolution before content access', async (t) => {
  const db = await openDatabase('file::memory:');
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  t.after(async () => {
    await app?.close();
    db.close();
  });
  await db.executeMultiple(
    await readFile(new URL('./fixtures/checkpoint2-schema.sql', import.meta.url), 'utf8'),
  );
  const stamp = '2026-10-12T09:00:00.000Z',
    a = randomUUID(),
    b = randomUUID(),
    subjectA = randomUUID(),
    subjectB = randomUUID();
  for (const [id, role] of [
    ['owner', 'master'],
    ['legacy', 'student'],
    ['single', 'student'],
  ])
    await db.execute({
      sql: 'INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [id!, `${id}@szabist-isb.pk`, id!, role!, 'active', 'demo', stamp, stamp],
    });
  for (const [id, name] of [
    [a, '5D'],
    [b, '2B'],
  ])
    await db.execute({
      sql: 'INSERT INTO classes(id,name,program,semester,section,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [id!, name!, 'BS CS', 5, name!, 'owner', stamp, stamp],
    });
  for (const [userId, classId, role] of [
    ['legacy', a, 'cr'],
    ['legacy', b, 'student'],
    ['single', a, 'student'],
  ])
    await db.execute({
      sql: 'INSERT INTO memberships(id,user_id,class_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      args: [randomUUID(), userId!, classId!, role!, 'active', stamp, stamp],
    });
  for (const [id, classId] of [
    [subjectA, a],
    [subjectB, b],
  ])
    await db.execute({
      sql: 'INSERT INTO subjects(id,class_id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      args: [id!, classId!, 'Preserved subject', 'owner', stamp, stamp],
    });
  await db.execute({
    sql: 'INSERT INTO site_settings(id,version,features_json,maintenance_enabled,maintenance_message,updated_at) VALUES(1,1,?,0,?,?)',
    args: [
      JSON.stringify({
        subjects: true,
        resources: true,
        announcements: true,
        tutor: true,
        profilePhotos: true,
      }),
      'Planned maintenance',
      stamp,
    ],
  });
  const oldMemberships = await rows(
    db,
    'SELECT id,user_id,class_id,role,status FROM memberships ORDER BY id',
  );
  await migrate(db);
  await migrate(db);
  assert.equal((await rows(db, 'SELECT id FROM memberships')).length, oldMemberships.length);
  assert.equal(
    (await first(db, 'SELECT needs_resolution FROM student_sections WHERE user_id=?', ['legacy']))
      ?.needs_resolution,
    1,
  );
  assert.equal(
    (await first(db, 'SELECT class_id FROM student_sections WHERE user_id=?', ['legacy']))
      ?.class_id,
    null,
  );
  assert.equal(
    (await first(db, 'SELECT class_id FROM student_sections WHERE user_id=?', ['single']))
      ?.class_id,
    a,
  );
  assert.equal(
    (await rows(db, "SELECT * FROM subject_enrollments WHERE user_id='legacy' AND status='active'"))
      .length,
    2,
  );
  app = await createApp({
    db,
    config: makeTestConfig(),
    seedDemo: false,
    now: () => new Date(stamp),
  });
  await app.ready();
  const token = await createDemoSession(db, 'legacy', new Date(stamp)),
    owner = await createDemoSession(db, 'owner', new Date(stamp)),
    single = await createDemoSession(db, 'single', new Date(stamp));
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) });
  expectSuccess(me);
  assert.deepEqual(me.json().classes, []);
  assert.equal(me.json().section.needsResolution, true);
  for (const id of [a, b])
    expectForbidden(
      await app.inject({ method: 'GET', url: `/api/classes/${id}`, headers: bearer(token) }),
    );
  const access = await app.inject({
    method: 'GET',
    url: '/api/offline/access',
    headers: bearer(token),
  });
  expectSuccess(access);
  assert.deepEqual(access.json().classIds, []);
  expectSuccess(
    await app.inject({ method: 'GET', url: `/api/subjects/${subjectA}`, headers: bearer(single) }),
  );
  const resolved = await app.inject({
    method: 'PUT',
    url: '/api/admin/users/legacy/section',
    headers: bearer(owner),
    payload: { classId: a, version: 1, reason: 'Confirmed student belongs to 5D' },
  });
  expectSuccess(resolved);
  expectSuccess(
    await app.inject({ method: 'GET', url: `/api/subjects/${subjectA}`, headers: bearer(token) }),
  );
  expectForbidden(
    await app.inject({ method: 'GET', url: `/api/subjects/${subjectB}`, headers: bearer(token) }),
  );
  const history = await rows(
    db,
    "SELECT class_id,status,role FROM memberships WHERE user_id='legacy' ORDER BY class_id",
  );
  assert.ok(history.some((m) => m.class_id === a && m.status === 'active' && m.role === 'student'));
  assert.ok(history.some((m) => m.class_id === b && m.status === 'removed'));
  assert.equal((await rows(db, 'SELECT id FROM memberships')).length, oldMemberships.length);
  // SQL is the final guard even if a future endpoint forgets its early section check.
  await assert.rejects(
    db.execute({
      sql: "UPDATE memberships SET status='active' WHERE user_id='legacy' AND class_id=?",
      args: [b],
    }),
    /section_conflict/,
  );
});
