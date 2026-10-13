import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { hashSecret } from '../server/auth.js';
import { makeTestConfig } from '../server/config.js';
import { first, migrate, openDatabase, rows } from '../server/db.js';
import { bearer, expectSuccess } from './helpers.js';

test('a real checkpoint 1 schema upgrades without losing accounts, class permissions (mapped to admin), invitations or request history', async (t) => {
  const db = await openDatabase('file::memory:');
  let app: FastifyInstance | undefined;
  t.after(async () => {
    await app?.close();
    db.close();
  });
  // This frozen delivered schema is intentionally independent of today's migrationOne.
  // Otherwise changing the new implementation could silently alter the old test fixture.
  await db.executeMultiple(
    await readFile(new URL('./fixtures/checkpoint1-schema.sql', import.meta.url), 'utf8'),
  );
  const stamp = '2026-10-10T09:00:00.000Z';
  const classId = '10000000-0000-4000-8000-000000000099';
  const token = 'demo_frozen_checkpoint_one_session';
  const ownerToken = 'demo_frozen_checkpoint_one_owner_session';
  for (const [id, email, name, role, status] of [
    ['old-owner', 'checkpoint.owner@szabist-isb.pk', 'Preserved Owner Name', 'master', 'active'],
    [
      'old-representative',
      'checkpoint.rep@szabist-isb.pk',
      'My customized profile name',
      'student',
      'active',
    ],
    [
      'old-student',
      'checkpoint.student@szabist-isb.pk',
      'Preserved Student Name',
      'student',
      'suspended',
    ],
  ]) {
    await db.execute({
      sql: 'INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [id!, email!, name!, role!, status!, 'demo', stamp, stamp],
    });
  }
  await db.execute({
    sql: 'INSERT INTO classes(id,name,program,semester,section,description,created_by,created_at,updated_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    args: [
      classId,
      'My existing 5D class',
      'BS Computer Science',
      5,
      'D',
      'Class customization saved before the upgrade.',
      'old-owner',
      stamp,
      stamp,
      'active',
    ],
  });
  await db.execute({
    sql: 'INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by,requested_at) VALUES (?,?,?,?,?,?,?,?,?)',
    args: [
      'old-cr-membership',
      classId,
      'old-representative',
      'cr',
      'active',
      stamp,
      stamp,
      'old-owner',
      null,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by,requested_at) VALUES (?,?,?,?,?,?,?,?,?)',
    args: [
      'old-request-history',
      classId,
      'old-student',
      'student',
      'rejected',
      stamp,
      stamp,
      'old-representative',
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO class_requests(id,requester_id,name,program,semester,section,description,status,review_note,reviewed_by,class_id,created_at,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    args: [
      'old-class-request',
      'old-representative',
      'My existing 5D class',
      'BS Computer Science',
      5,
      'D',
      'Original request text',
      'approved',
      'Original approval note',
      'old-owner',
      classId,
      stamp,
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO class_invites(id,class_id,code_hash,expires_at,active,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
    args: [
      'old-invite',
      classId,
      hashSecret('ABCDEFGHJKLM'),
      '2026-10-17T09:00:00.000Z',
      1,
      'old-representative',
      stamp,
    ],
  });
  for (const [value, userId] of [
    [token, 'old-representative'],
    [ownerToken, 'old-owner'],
  ]) {
    await db.execute({
      sql: 'INSERT INTO demo_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',
      args: [hashSecret(value!), userId!, stamp, '2026-10-10T17:00:00.000Z'],
    });
  }
  await db.execute({
    sql: 'INSERT INTO audit_logs(id,actor_id,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)',
    args: [
      'old-audit-entry',
      'old-owner',
      'class_request.approved',
      'old-class-request',
      JSON.stringify({ classId }),
      stamp,
    ],
  });
  await db.execute("INSERT INTO app_metadata(key,value) VALUES ('identity_mode','demo')");
  const userColumns = 'id,email,display_name,role,status,identity_source,created_at,updated_at';
  const oldTables = [
    'classes',
    'class_requests',
    'class_invites',
    'demo_sessions',
    'audit_logs',
    'app_metadata',
  ];
  const beforeMemberships = await rows(db, 'SELECT * FROM memberships ORDER BY id');
  const beforeUsers = await rows(db, `SELECT ${userColumns} FROM users ORDER BY id`);
  const beforeRows = await Promise.all(
    oldTables.map((table) => rows(db, `SELECT * FROM ${table} ORDER BY rowid`)),
  );
  assert.deepEqual(
    (await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')).map(
      (row) => row.version,
    ),
    [1, 2],
  );

  await migrate(db);

  assert.deepEqual(await rows(db, `SELECT ${userColumns} FROM users ORDER BY id`), beforeUsers);
  assert.deepEqual(
    await rows(db, 'SELECT * FROM memberships ORDER BY id'),
    beforeMemberships.map((row) => ({
      ...row,
      role: row.role === 'cr' || row.role === 'gr' ? 'admin' : row.role,
    })),
  );
  for (let index = 0; index < oldTables.length; index++) {
    assert.deepEqual(
      await rows(db, `SELECT * FROM ${oldTables[index]} ORDER BY rowid`),
      beforeRows[index],
      `${oldTables[index]} must survive an upgrade exactly.`,
    );
  }
  assert.deepEqual(
    (await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')).map(
      (row) => row.version,
    ),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(
    (
      await first(db, 'SELECT username,avatar_key,avatar_version FROM users WHERE id=?', [
        'old-representative',
      ])
    )?.username,
    null,
  );
  assert.equal((await first(db, 'SELECT COUNT(*) AS n FROM subjects'))?.n, 0);
  assert.equal((await first(db, 'SELECT published FROM tutor_profile WHERE id=1'))?.published, 0);
  assert.equal(
    (await first(db, 'SELECT published FROM developer_profile WHERE id=1'))?.published,
    0,
  );
  assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);

  // Startup itself migrates again. The original authenticated session should remain valid.
  app = await createApp({
    db,
    config: makeTestConfig(),
    seedDemo: false,
    now: () => new Date(stamp),
  });
  await app.ready();
  const profile = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) });
  expectSuccess(profile);
  assert.equal(profile.json().user.displayName, 'My customized profile name');
  assert.equal(profile.json().user.id, 'old-representative');
  assert.equal(profile.json().classes[0].id, classId);
  assert.equal(profile.json().classes[0].role, 'admin');
  assert.equal(profile.json().canCreateClass, false);
  assert.equal(profile.json().classRequests[0].reviewNote, 'Original approval note');
  const photoColumns = profile.json().user;
  assert.equal(photoColumns.username, null);
  assert.equal(photoColumns.avatarVersion, null);
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: bearer(token),
      payload: { username: 'existing_student_5d' },
    }),
  );
  const control = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers: bearer(ownerToken),
    payload: { version: 2, features: { developer: false } },
  });
  expectSuccess(control);
  const settingsAfterEdit = await first(db, 'SELECT * FROM site_settings WHERE id=1');

  await migrate(db);

  assert.equal(
    (await first(db, 'SELECT username FROM users WHERE id=?', ['old-representative']))?.username,
    'existing_student_5d',
  );
  assert.deepEqual(await first(db, 'SELECT * FROM site_settings WHERE id=1'), settingsAfterEdit);
  assert.deepEqual(
    (await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')).map(
      (row) => row.version,
    ),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.equal(
    (
      await first(
        db,
        "SELECT COUNT(*) AS n FROM memberships WHERE class_id=? AND role='admin' AND status='active'",
        [classId],
      )
    )?.n,
    1,
  );
  assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});
