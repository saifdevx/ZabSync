import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import type { VerifiedIdentity } from '../server/auth.js';
import { makeTestConfig, type AppConfig } from '../server/config.js';
import { first, openDatabase, rows } from '../server/db.js';
import { applyOwnerTransfer, reviewOwnerTransfer } from '../server/owner-transfer.js';
import { bearer, expectSuccess } from './helpers.js';

const owner: VerifiedIdentity = {
  uid: 'pinned-private-owner-uid',
  email: 'private.owner@gmail.com',
  email_verified: true,
  name: 'Owner',
};
const student: VerifiedIdentity = {
  uid: 'separate-university-uid',
  email: '2412339@szabist-isb.pk',
  email_verified: true,
  name: 'University Account',
};
const previous: VerifiedIdentity = {
  uid: 'previous-university-owner-uid',
  email: 'previous@szabist-isb.pk',
  email_verified: true,
  name: 'Previous Owner',
};
const classForm = {
  name: '5D',
  program: 'BS Computer Science',
  semester: 5,
  section: 'D',
  description: 'A real class workspace.',
};
const stamp = '2026-10-11T09:00:00.000Z';

async function fixture(
  t: TestContext,
  identities: Record<string, VerifiedIdentity>,
  overrides: Partial<AppConfig> = {},
) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.owner-'));
  const databaseUrl = pathToFileURL(join(directory, 'campus.sqlite')).href;
  const config = makeTestConfig({
    authMode: 'firebase',
    databaseUrl,
    masterAdminEmail: owner.email!,
    masterAdminUid: owner.uid,
    ...overrides,
  });
  const db = await openDatabase(databaseUrl);
  const app = await createApp({
    config,
    db,
    seedDemo: false,
    verifyFirebaseToken: async (token) => {
      const identity = identities[token];
      if (!identity) throw new Error('Invalid provider signature');
      return identity;
    },
  });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { app, db, config };
}

test('only the one verified email and pinned UID can use the external owner exception; its configuration stays private', async (t) => {
  const identities = {
    owner,
    student,
    unverified: { ...owner, email_verified: false },
    wrongUid: { ...owner, uid: 'different-firebase-uid' },
    wrongEmail: { ...owner, email: 'another.person@gmail.com' },
    alias: { ...owner, email: 'private.owner+alias@gmail.com' },
    subdomain: { ...owner, email: 'private.owner@mail.gmail.com' },
    otherGmail: {
      uid: 'unrelated-gmail-uid',
      email: 'another.student@gmail.com',
      email_verified: true,
      name: 'Master Admin',
    },
  };
  const { app, db } = await fixture(t, identities);
  for (const token of [
    'unverified',
    'wrongUid',
    'wrongEmail',
    'alias',
    'subdomain',
    'otherGmail',
  ]) {
    const result = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { ...bearer(token), 'x-role': 'master' },
    });
    assert.equal(result.statusCode, 403, `${token}: ${result.body}`);
    assert.equal(
      result.json().error.code,
      token === 'unverified' ? 'email_not_verified' : 'university_email_required',
    );
  }
  assert.equal(
    (await first(db, 'SELECT COUNT(*) AS count FROM users'))?.count,
    0,
    'Rejected identities must not create accounts.',
  );
  const ownProfile = await app.inject({ method: 'GET', url: '/api/me', headers: bearer('owner') });
  expectSuccess(ownProfile);
  assert.equal(ownProfile.json().user.role, 'master');
  assert.equal(ownProfile.json().user.id, owner.uid);
  assert.equal(ownProfile.json().user.rollNumber, null);
  assert.deepEqual(ownProfile.json().classes, []);
  const universityProfile = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { ...bearer('student'), 'x-role': 'master' },
  });
  expectSuccess(universityProfile);
  assert.equal(universityProfile.json().user.role, 'student');
  assert.equal(universityProfile.json().canCreateClass, false);
  assert.equal(universityProfile.json().user.rollNumber, '2412339');
  const publicConfig = await app.inject({ method: 'GET', url: '/api/config' });
  expectSuccess(publicConfig);
  assert.equal(publicConfig.json().allowedEmailDomain, 'szabist-isb.pk');
  assert.equal(publicConfig.body.includes(owner.email!), false);
  assert.equal(publicConfig.body.includes(owner.uid), false);
  assert.equal(Object.hasOwn(publicConfig.json(), 'masterAdminEmail'), false);
  assert.equal(Object.hasOwn(publicConfig.json(), 'masterAdminUid'), false);
});

test('owner classes stay outside enrolled lists; the separate university account acquires only its assigned class role', async (t) => {
  const { app, db } = await fixture(t, { owner, student });
  expectSuccess(await app.inject({ method: 'GET', url: '/api/me', headers: bearer('student') }));
  const created = await app.inject({
    method: 'POST',
    url: '/api/classes',
    headers: bearer('owner'),
    payload: classForm,
  });
  expectSuccess(created);
  const classId = created.json().class.id;
  assert.equal(created.json().class.role, null);
  assert.equal(created.json().class.memberCount, 0);
  assert.equal(
    (await first(db, 'SELECT COUNT(*) AS count FROM memberships WHERE class_id=?', [classId]))
      ?.count,
    0,
  );
  assert.deepEqual(
    (await app.inject({ method: 'GET', url: '/api/me', headers: bearer('owner') })).json().classes,
    [],
  );
  const enrolled = await app.inject({
    method: 'GET',
    url: '/api/classes',
    headers: bearer('owner'),
  });
  assert.deepEqual(enrolled.json(), {
    classes: [],
    pagination: { limit: 100, offset: 0, total: 0 },
  });
  const directory = await app.inject({
    method: 'GET',
    url: '/api/admin/semesters/5/classes',
    headers: bearer('owner'),
  });
  assert.equal(directory.json().classes[0].id, classId);
  assert.equal(directory.json().classes[0].memberCount, 0);
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/classes/${classId}`,
      headers: bearer('owner'),
      payload: { ...classForm, name: '5D Updated' },
    }),
  );
  const subject = await app.inject({
    method: 'POST',
    url: `/api/classes/${classId}/subjects`,
    headers: bearer('owner'),
    payload: { name: 'Owner test subject' },
  });
  expectSuccess(subject);
  const invite = await app.inject({
    method: 'POST',
    url: `/api/subjects/${subject.json().subject.id}/invite`,
    headers: bearer('owner'),
  });
  expectSuccess(invite);
  for (const request of [
    { url: '/api/subjects/join', payload: { code: invite.json().code } },
    { url: `/api/admin/classes/${classId}/members`, payload: { userId: owner.uid } },
  ]) {
    const denied = await app.inject({ method: 'POST', headers: bearer('owner'), ...request });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(denied.json().error.code, 'owner_membership_forbidden');
  }
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/admin/classes/${classId}/members`,
      headers: bearer('owner'),
      payload: { userId: student.uid },
    }),
  );
  const deniedCreation = await app.inject({
    method: 'POST',
    url: '/api/classes',
    headers: bearer('student'),
    payload: { ...classForm, name: '6A', semester: 6, section: 'A' },
  });
  assert.equal(deniedCreation.statusCode, 403, deniedCreation.body);
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/classes/${classId}/members/${student.uid}/role`,
      headers: bearer('owner'),
      payload: { role: 'admin' },
    }),
  );
  const sameToken = await app.inject({ method: 'GET', url: '/api/me', headers: bearer('student') });
  assert.equal(sameToken.json().user.role, 'student');
  assert.equal(sameToken.json().canCreateClass, false);
  const blockedAdminSection = await app.inject({
    method: 'POST',
    url: '/api/classes',
    headers: bearer('student'),
    payload: { ...classForm, name: '6A', semester: 6, section: 'A' },
  });
  assert.equal(blockedAdminSection.statusCode, 403);
  const adminCreated = await app.inject({
    method: 'POST',
    url: `/api/classes/${classId}/subjects`,
    headers: bearer('student'),
    payload: { name: 'Admin subject' },
  });
  expectSuccess(adminCreated);
  assert.equal(adminCreated.json().subject.classId, classId);
  const adminClasses = await app.inject({
    method: 'GET',
    url: '/api/classes?limit=1&offset=1',
    headers: bearer('student'),
  });
  assert.deepEqual(adminClasses.json().classes, []);
  assert.deepEqual(adminClasses.json().pagination, { limit: 1, offset: 1, total: 1 });
  assert.deepEqual(
    (await app.inject({ method: 'GET', url: '/api/classes', headers: bearer('owner') })).json()
      .classes,
    [],
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/classes?scope=all', headers: bearer('owner') }))
      .statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/admin/semesters', headers: bearer('student') }))
      .statusCode,
    403,
  );
});

test('changing configured owner cannot transfer a prior owner; preview is read-only and an explicit transfer preserves history', async (t) => {
  const { app, db, config } = await fixture(t, { owner, previous, student });
  await db.execute({
    sql: "INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at,username) VALUES (?,?,?,'master','active','firebase',?,?,'previous_profile')",
    args: [previous.uid, previous.email!, 'Preserved Previous Profile', stamp, stamp],
  });
  const legacyId = randomUUID(),
    membershipId = randomUUID();
  await db.execute({
    sql: 'INSERT INTO classes(id,name,program,semester,section,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    args: [legacyId, 'Legacy 5D', 'BSCS', 5, 'D', previous.uid, stamp, stamp],
  });
  await db.execute({
    sql: "INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,requested_at,reviewed_by) VALUES (?,?,?,'admin','active',?,?,?,?)",
    args: [membershipId, legacyId, previous.uid, stamp, stamp, stamp, previous.uid],
  });
  const oldProfile = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer('previous'),
  });
  expectSuccess(oldProfile);
  assert.equal(oldProfile.json().user.role, 'master');
  const legacyRoleWrite = await app.inject({
    method: 'PATCH',
    url: `/api/admin/classes/${legacyId}/members/${previous.uid}/role`,
    headers: bearer('previous'),
    payload: { role: 'student' },
  });
  assert.equal(legacyRoleWrite.statusCode, 403);
  assert.equal(legacyRoleWrite.json().error.code, 'owner_membership_forbidden');
  const blocked = await app.inject({ method: 'GET', url: '/api/me', headers: bearer('owner') });
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.equal(blocked.json().error.code, 'owner_transfer_required');
  assert.equal(await first(db, 'SELECT id FROM users WHERE id=?', [owner.uid]), undefined);
  const beforeUsers = await rows(db, 'SELECT * FROM users ORDER BY id');
  const beforeMemberships = await rows(db, 'SELECT * FROM memberships ORDER BY id');
  const beforeClasses = await rows(db, 'SELECT * FROM classes ORDER BY id');
  const beforeAudit = await rows(db, 'SELECT * FROM audit_logs ORDER BY id');
  const record = { ...owner, disabled: false };
  const preview = await reviewOwnerTransfer(db, config, previous.uid, record);
  assert.deepEqual(preview.previousOwner, { id: previous.uid, email: previous.email });
  assert.deepEqual(preview.nextOwner, { id: owner.uid, email: owner.email });
  assert.equal(preview.membershipsChanged, false);
  assert.deepEqual(await rows(db, 'SELECT * FROM users ORDER BY id'), beforeUsers);
  assert.deepEqual(await rows(db, 'SELECT * FROM audit_logs ORDER BY id'), beforeAudit);
  await assert.rejects(() => applyOwnerTransfer(db, config, 'wrong-current-owner', record), {
    code: 'owner_source_mismatch',
  });
  await assert.rejects(
    () => applyOwnerTransfer(db, config, previous.uid, { ...record, disabled: true }),
    { code: 'owner_target_disabled' },
  );
  await assert.rejects(
    () => applyOwnerTransfer(db, config, previous.uid, { ...record, email_verified: false }),
    { code: 'email_not_verified' },
  );
  await assert.rejects(
    () => applyOwnerTransfer(db, config, previous.uid, { ...record, uid: 'wrong-target-uid' }),
    { code: 'university_email_required' },
  );
  assert.deepEqual(await rows(db, 'SELECT * FROM users ORDER BY id'), beforeUsers);
  await db.execute(`CREATE TRIGGER reject_test_owner_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action='owner.transferred' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`);
  await assert.rejects(() => applyOwnerTransfer(db, config, previous.uid, record));
  assert.deepEqual(
    await rows(db, 'SELECT * FROM users ORDER BY id'),
    beforeUsers,
    'A failure after role updates must roll back both demotion and promotion.',
  );
  assert.deepEqual(await rows(db, 'SELECT * FROM audit_logs ORDER BY id'), beforeAudit);
  await db.execute('DROP TRIGGER reject_test_owner_audit');
  await applyOwnerTransfer(db, config, previous.uid, record, new Date(stamp));
  assert.deepEqual(await rows(db, 'SELECT * FROM memberships ORDER BY id'), beforeMemberships);
  assert.deepEqual(await rows(db, 'SELECT * FROM classes ORDER BY id'), beforeClasses);
  const previousAfter = await first(db, 'SELECT * FROM users WHERE id=?', [previous.uid]);
  assert.equal(previousAfter?.role, 'student');
  assert.equal(previousAfter?.username, 'previous_profile');
  assert.equal(previousAfter?.display_name, 'Preserved Previous Profile');
  assert.equal(
    (await first(db, "SELECT COUNT(*) AS count FROM users WHERE role='master'"))?.count,
    1,
  );
  const oldTokenAfter = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer('previous'),
  });
  assert.equal(oldTokenAfter.json().user.role, 'student');
  assert.equal(oldTokenAfter.json().classes[0].role, 'admin');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: bearer('previous') }))
      .statusCode,
    403,
  );
  const newOwner = await app.inject({ method: 'GET', url: '/api/me', headers: bearer('owner') });
  expectSuccess(newOwner);
  assert.equal(newOwner.json().user.role, 'master');
  assert.deepEqual(newOwner.json().classes, []);
  expectSuccess(
    await app.inject({ method: 'GET', url: '/api/admin/overview', headers: bearer('owner') }),
  );
  const audit = await first(db, "SELECT * FROM audit_logs WHERE action='owner.transferred'");
  assert.equal(audit?.actor_id, null);
  assert.equal(audit?.target_id, owner.uid);
  assert.deepEqual(JSON.parse(String(audit?.details_json)), {
    previousOwnerId: previous.uid,
    source: 'server-command',
    membershipsChanged: false,
  });
  await assert.rejects(() => applyOwnerTransfer(db, config, previous.uid, record), {
    code: 'owner_source_mismatch',
  });
});
