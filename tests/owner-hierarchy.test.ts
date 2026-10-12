import assert from 'node:assert/strict';
import test from 'node:test';
import type { VerifiedIdentity } from '../server/auth.js';
import { makeTestConfig } from '../server/config.js';
import { bearer, createTestApp, expectForbidden, expectSuccess } from './helpers.js';

const identities: Record<string, VerifiedIdentity> = {
  owner: { uid: 'owner-uid', email: 'owner@szabist-isb.pk', email_verified: true, name: 'Owner' },
  student: {
    uid: 'immutable-student-uid',
    email: '2412339@szabist-isb.pk',
    email_verified: true,
    name: 'Areeba Student',
  },
  teacher: {
    uid: 'immutable-teacher-uid',
    email: 'lecturer.ahmed@szabist-isb.pk',
    email_verified: true,
    name: 'Ahmed Teacher',
  },
  observer: {
    uid: 'observer-uid',
    email: '2412340@szabist-isb.pk',
    email_verified: true,
    name: 'Unenrolled Student',
  },
};

test('only the owner can browse semester sections and complete rosters with stable identities and accurate active enrollment counts', async (t) => {
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase', masterAdminEmail: identities.owner!.email! }),
    seedDemo: false,
    verifyFirebaseToken: async (token) => {
      const identity = identities[token];
      if (!identity) throw new Error('Unverified token');
      return identity;
    },
  });
  for (const token of Object.keys(identities)) {
    expectSuccess(await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) }));
  }
  const classIds: Record<string, string> = {};
  for (const [key, semester, section] of [
    ['sixA', 6, 'A'],
    ['sixB', 6, 'B'],
    ['fiveC', 5, 'C'],
  ] as const) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: bearer('owner'),
      payload: {
        name: `${semester}${section}`,
        program: 'BS Computer Science',
        semester,
        section,
        description: '',
      },
    });
    expectSuccess(created);
    classIds[key] = created.json().class.id;
  }
  for (const [classKey, userKey] of [
    ['sixA', 'student'],
    ['sixA', 'teacher'],
    ['sixB', 'student'],
  ]) {
    expectSuccess(
      await app.inject({
        method: 'POST',
        url: `/api/admin/classes/${classIds[classKey!]}/members`,
        headers: bearer('owner'),
        payload: { userId: identities[userKey!]!.uid },
      }),
    );
  }
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/classes/${classIds.sixB}/members/${identities.student!.uid}/role`,
      headers: bearer('owner'),
      payload: { role: 'admin' },
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: bearer('student'),
      payload: { displayName: 'Updated Student Name', username: 'areeba_5d' },
    }),
  );

  for (const token of ['student', 'teacher', 'observer']) {
    for (const url of [
      '/api/admin/semesters',
      '/api/admin/semesters/6/classes',
      '/api/admin/overview',
    ]) {
      expectForbidden(
        await app.inject({ method: 'GET', url, headers: { ...bearer(token), 'x-role': 'master' } }),
      );
    }
  }
  const hierarchy = await app.inject({
    method: 'GET',
    url: '/api/admin/semesters',
    headers: bearer('owner'),
  });
  expectSuccess(hierarchy);
  assert.deepEqual(hierarchy.json(), {
    semesters: [
      { semester: 5, classCount: 1, memberCount: 0, studentCount: 0, adminCount: 0 },
      { semester: 6, classCount: 2, memberCount: 3, studentCount: 2, adminCount: 1 },
    ],
    totals: { classCount: 3, memberCount: 3, studentCount: 2, adminCount: 1 },
  });
  const sections = await app.inject({
    method: 'GET',
    url: '/api/admin/semesters/6/classes?limit=1&offset=1',
    headers: bearer('owner'),
  });
  expectSuccess(sections);
  assert.deepEqual(sections.json().pagination, { limit: 1, offset: 1, total: 2 });
  assert.equal(sections.json().classes[0].id, classIds.sixB);
  assert.equal(sections.json().classes[0].adminCount, 1);
  assert.equal(sections.json().classes[0].memberCount, 1);
  const ownerRoster = await app.inject({
    method: 'GET',
    url: `/api/classes/${classIds.sixA}`,
    headers: bearer('owner'),
  });
  expectSuccess(ownerRoster);
  const members = ownerRoster.json().members as {
    userId: string;
    displayName: string;
    username: string | null;
    email: string;
    rollNumber: string | null;
  }[];
  const student = members.find((member) => member.userId === identities.student!.uid)!;
  assert.equal(student.displayName, 'Updated Student Name');
  assert.equal(student.username, 'areeba_5d');
  assert.equal(student.rollNumber, '2412339');
  assert.equal(student.email, identities.student!.email);
  assert.equal(
    members.find((member) => member.userId === identities.teacher!.uid)?.rollNumber,
    null,
  );
  const pagedRoster = await app.inject({
    method: 'GET',
    url: `/api/classes/${classIds.sixA}?limit=1&offset=1`,
    headers: bearer('owner'),
  });
  assert.equal(pagedRoster.json().members.length, 1);
  assert.equal(pagedRoster.json().pagination.membersTotal, 2);
  const ordinaryRoster = await app.inject({
    method: 'GET',
    url: `/api/classes/${classIds.sixA}`,
    headers: bearer('student'),
  });
  assert.equal(
    ordinaryRoster.json().myRole,
    'student',
    'Being admin of another class must not disclose owner roster metadata here.',
  );
  for (const member of ordinaryRoster.json().members) {
    assert.equal(Object.hasOwn(member, 'email'), false);
    assert.equal(Object.hasOwn(member, 'rollNumber'), false);
  }

  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${identities.teacher!.uid}/status`,
      headers: bearer('owner'),
      payload: { status: 'suspended' },
    }),
  );
  const afterSuspension = (
    await app.inject({ method: 'GET', url: '/api/admin/semesters', headers: bearer('owner') })
  ).json();
  assert.deepEqual(afterSuspension.totals, {
    classCount: 3,
    memberCount: 2,
    studentCount: 1,
    adminCount: 1,
  });
  const overview = (
    await app.inject({ method: 'GET', url: '/api/admin/overview', headers: bearer('owner') })
  ).json();
  assert.deepEqual(overview.stats, {
    users: 4,
    classes: 3,
    activeUsers: 3,
    suspendedUsers: 1,
    semesters: 2,
    admins: 1,
    pendingMemberships: 0,
    legacyClassRequests: 0,
  });
  const manageable = (
    await app.inject({
      method: 'GET',
      url: `/api/classes/${classIds.sixA}`,
      headers: bearer('owner'),
    })
  ).json().members;
  assert.equal(
    manageable.find((member: { userId: string }) => member.userId === identities.teacher!.uid)
      .accountStatus,
    'suspended',
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/admin/semesters/13/classes',
        headers: bearer('owner'),
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/admin/semesters/6/classes?limit=101',
        headers: bearer('owner'),
      })
    ).statusCode,
    400,
  );
});
