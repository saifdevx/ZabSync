import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { hashSecret } from '../server/auth.js';
import { makeTestConfig } from '../server/config.js';
import { first, migrate, openDatabase, rows } from '../server/db.js';
import { getSettings } from '../server/site-settings.js';
import { bearer, expectSuccess } from './helpers.js';

test('checkpoint 2 data upgrades additively to multiple admins and a private empty developer profile', async (t) => {
  const db = await openDatabase('file::memory:');
  let app: FastifyInstance | undefined;
  t.after(async () => {
    await app?.close();
    db.close();
  });
  await db.executeMultiple(
    await readFile(new URL('./fixtures/checkpoint2-schema.sql', import.meta.url), 'utf8'),
  );
  const stamp = '2026-10-10T09:00:00.000Z';
  const classId = '10000000-0000-4000-8000-000000000091';
  const subjectId = '20000000-0000-4000-8000-000000000091';
  const resourceId = '30000000-0000-4000-8000-000000000091';
  const announcementId = '40000000-0000-4000-8000-000000000091';
  for (const [id, mailbox, role, status] of [
    ['owner', 'old.owner', 'master', 'active'],
    ['cr-user', '2412339', 'student', 'active'],
    ['gr-user', '2412340', 'student', 'active'],
    ['student-user', '2412341', 'student', 'active'],
    ['removed-user', 'lecturer.ahmed', 'student', 'suspended'],
  ]) {
    await db.execute({
      sql: 'INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at,username,avatar_key,avatar_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      args: [
        id!,
        `${mailbox}@szabist-isb.pk`,
        `Saved ${id} name`,
        role!,
        status!,
        'demo',
        stamp,
        stamp,
        id!.replaceAll('-', '_'),
        id === 'cr-user' ? 'avatars/50000000-0000-4000-8000-000000000091.webp' : null,
        id === 'cr-user' ? 'photo-v1' : null,
      ],
    });
  }
  await db.execute({
    sql: 'INSERT INTO classes(id,name,program,semester,section,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    args: [
      classId,
      'My customized 5D',
      'BS Computer Science',
      5,
      'D',
      'Original class description',
      'owner',
      stamp,
      stamp,
    ],
  });
  for (const [id, userId, role, status, requestedAt] of [
    ['old-cr-member', 'cr-user', 'cr', 'active', null],
    ['old-gr-member', 'gr-user', 'gr', 'active', stamp],
    ['old-student-member', 'student-user', 'student', 'active', stamp],
    ['old-removed-member', 'removed-user', 'student', 'removed', stamp],
  ]) {
    await db.execute({
      sql: 'INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by,requested_at) VALUES(?,?,?,?,?,?,?,?,?)',
      args: [
        id!,
        classId,
        userId!,
        role!,
        status!,
        stamp,
        '2026-10-10T09:20:00.000Z',
        'owner',
        requestedAt!,
      ],
    });
  }
  await db.execute({
    sql: "INSERT INTO class_requests(id,requester_id,name,program,semester,section,description,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)",
    args: [
      'legacy-pending-class',
      'student-user',
      '6F',
      'BS Computer Science',
      6,
      'F',
      'Historical pending request',
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO class_invites(id,class_id,code_hash,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)',
    args: [
      'existing-code',
      classId,
      hashSecret('ABCDEFGHJKLM'),
      '2026-10-17T09:00:00.000Z',
      'cr-user',
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO subjects(id,class_id,name,code,instructor,description,color,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    args: [
      subjectId,
      classId,
      'Original subject',
      'CS501',
      'Original teacher',
      'Original description',
      'teal',
      'cr-user',
      stamp,
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO resources(id,class_id,subject_id,title,description,filename,mime_type,size_bytes,storage_key,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    args: [
      resourceId,
      classId,
      subjectId,
      'Lecture before upgrade',
      'Keep all metadata',
      'lecture.pdf',
      'application/pdf',
      100,
      `resources/${resourceId}`,
      'gr-user',
      stamp,
      stamp,
    ],
  });
  await db.execute({
    sql: "INSERT INTO announcements(id,scope,class_id,subject_id,title,body,priority,pinned,created_by,created_at,updated_at) VALUES(?,'subject',?,?,?,?,'important',1,?,?,?)",
    args: [
      announcementId,
      classId,
      subjectId,
      'Original announcement',
      'Saved announcement details',
      'cr-user',
      stamp,
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO announcement_resources(announcement_id,resource_id) VALUES(?,?)',
    args: [announcementId, resourceId],
  });
  await db.execute({
    sql: "INSERT INTO bookmarks(user_id,kind,target_id,created_at) VALUES(?,'resource',?,?)",
    args: ['student-user', resourceId, stamp],
  });
  await db.execute({
    sql: 'INSERT INTO announcement_reads(user_id,announcement_id,read_at) VALUES(?,?,?)',
    args: ['student-user', announcementId, stamp],
  });
  await db.execute({
    sql: 'INSERT INTO audit_logs(id,actor_id,action,target_id,details_json,created_at) VALUES(?,?,?,?,?,?)',
    args: [
      'original-audit',
      'owner',
      'representative.assigned',
      'gr-user',
      JSON.stringify({ classId, role: 'gr' }),
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO site_settings(id,version,features_json,maintenance_enabled,maintenance_message,updated_at) VALUES(1,7,?,0,?,?)',
    args: [
      JSON.stringify({
        subjects: true,
        resources: false,
        announcements: true,
        tutor: true,
        profilePhotos: false,
      }),
      'My customized maintenance message',
      stamp,
    ],
  });
  await db.execute({
    sql: 'INSERT INTO tutor_profile(id,version,published,title,name,bio,subjects_json,contact_label,contact_url,booking_url,updated_at) VALUES(1,9,1,?,?,?,?,?,?,?,?)',
    args: [
      'Old tutoring promotion',
      'Previously supplied tutor',
      'Private legacy biography must not become developer advertising.',
      '["Databases"]',
      'Old contact',
      'https://example.org/old-contact',
      'https://example.org/old-booking',
      stamp,
    ],
  });
  await db.execute("INSERT INTO app_metadata(key,value) VALUES('identity_mode','demo')");
  for (const id of ['owner', 'cr-user', 'gr-user', 'student-user']) {
    await db.execute({
      sql: 'INSERT INTO demo_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',
      args: [hashSecret(`demo_preserved_${id}`), id, stamp, '2026-10-10T17:00:00.000Z'],
    });
  }
  const beforeMemberships = await rows(db, 'SELECT * FROM memberships ORDER BY id');
  const unchangedTables = [
    'users',
    'classes',
    'class_requests',
    'class_invites',
    'subjects',
    'resources',
    'announcements',
    'announcement_resources',
    'bookmarks',
    'announcement_reads',
    'audit_logs',
    'demo_sessions',
    'app_metadata',
    'tutor_profile',
  ];
  const before = await Promise.all(
    unchangedTables.map((table) => rows(db, `SELECT * FROM ${table} ORDER BY rowid`)),
  );

  await migrate(db);

  for (let index = 0; index < unchangedTables.length; index++) {
    assert.deepEqual(
      await rows(db, `SELECT * FROM ${unchangedTables[index]} ORDER BY rowid`),
      before[index],
      `${unchangedTables[index]} must be unchanged by migration.`,
    );
  }
  assert.deepEqual(
    await rows(db, 'SELECT * FROM memberships ORDER BY id'),
    beforeMemberships.map((row) => ({
      ...row,
      role: ['cr', 'gr'].includes(String(row.role)) ? 'admin' : row.role,
    })),
  );
  assert.equal(
    (
      await first(
        db,
        "SELECT COUNT(*) AS n FROM memberships WHERE class_id=? AND role='admin' AND status='active'",
        [classId],
      )
    )?.n,
    2,
  );
  assert.deepEqual(
    (await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')).map(
      (row) => row.version,
    ),
    [1, 2, 3, 4, 5, 6],
  );
  const settings = await getSettings(db);
  assert.equal(settings.version, 8);
  assert.deepEqual(settings.features, {
    subjects: true,
    resources: false,
    announcements: true,
    developer: true,
    profilePhotos: false,
    timetable: true,
    deadlines: true,
  });
  assert.equal(settings.maintenance.message, 'My customized maintenance message');
  assert.equal((await first(db, 'SELECT COUNT(*) AS n FROM timetable_entries'))?.n, 0);
  assert.equal((await first(db, 'SELECT COUNT(*) AS n FROM deadlines'))?.n, 0);
  assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
  assert.deepEqual(
    await rows(db, "SELECT name FROM sqlite_schema WHERE name IN ('one_class_cr','one_class_gr')"),
    [],
  );
  await assert.rejects(
    () => db.execute({ sql: "UPDATE memberships SET role='cr' WHERE id='old-cr-member'" }),
    /CHECK/,
  );

  app = await createApp({
    db,
    config: makeTestConfig(),
    seedDemo: false,
    now: () => new Date(stamp),
  });
  await app.ready();
  for (const id of ['cr-user', 'gr-user']) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: bearer(`demo_preserved_${id}`),
    });
    expectSuccess(response);
    assert.equal(response.json().canCreateClass, true);
    assert.equal(response.json().classes[0].role, 'admin');
    assert.equal(response.json().user.id, id);
    assert.equal(response.json().user.role, 'student');
  }
  const owner = bearer('demo_preserved_owner');
  const student = bearer('demo_preserved_student-user');
  const developer = await app.inject({ method: 'GET', url: '/api/developer', headers: student });
  assert.equal(developer.json().developer, null);
  const draft = (
    await app.inject({ method: 'GET', url: '/api/admin/developer', headers: owner })
  ).json().developer;
  assert.equal(draft.published, false);
  assert.equal(draft.bio, '');
  assert.equal(draft.name, '');
  assert.equal(draft.portfolioUrl, '');
  assert.deepEqual(draft.apps, []);
  const retiredApproval = await app.inject({
    method: 'POST',
    url: '/api/admin/class-requests/legacy-pending-class/decision',
    headers: owner,
    payload: { decision: 'approve' },
  });
  assert.equal(retiredApproval.statusCode, 410, retiredApproval.body);
  assert.equal(
    (await first(db, "SELECT status FROM class_requests WHERE id='legacy-pending-class'"))?.status,
    'pending',
  );
  const roleChange = await app.inject({
    method: 'PATCH',
    url: `/api/admin/classes/${classId}/members/gr-user/role`,
    headers: owner,
    payload: { role: 'student' },
  });
  expectSuccess(roleChange);
  const afterChange = await rows(db, 'SELECT * FROM memberships ORDER BY id');
  const settingsBeforeRepeat = await first(db, 'SELECT * FROM site_settings WHERE id=1');
  const developerBeforeRepeat = await first(db, 'SELECT * FROM developer_profile WHERE id=1');
  await migrate(db);
  assert.deepEqual(await rows(db, 'SELECT * FROM memberships ORDER BY id'), afterChange);
  assert.deepEqual(await first(db, 'SELECT * FROM site_settings WHERE id=1'), settingsBeforeRepeat);
  assert.deepEqual(
    await first(db, 'SELECT * FROM developer_profile WHERE id=1'),
    developerBeforeRepeat,
  );
  assert.deepEqual(await rows(db, 'PRAGMA foreign_key_check'), []);
});
