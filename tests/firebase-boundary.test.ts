import assert from 'node:assert/strict';
import test from 'node:test';
import type { VerifiedIdentity } from '../server/auth.js';
import { makeTestConfig } from '../server/config.js';
import { bearer, createTestApp, expectForbidden, expectSuccess } from './helpers.js';

const owner: VerifiedIdentity = {
  uid: 'test-firebase-owner',
  email: 'owner@szabist-isb.pk',
  email_verified: true,
  name: 'Test Owner',
};
const student: VerifiedIdentity = {
  uid: 'test-firebase-student',
  email: '2412345@szabist-isb.pk',
  email_verified: true,
  name: 'Test Student',
};
const teacher: VerifiedIdentity = {
  uid: 'test-firebase-teacher',
  email: 'lecturer.ahmed@szabist-isb.pk',
  email_verified: true,
  name: 'Test Teacher',
};

test('Firebase mode invokes its verifier, rejects demo tokens, and never infers the first user is the owner', async (t) => {
  const verifiedTokens: string[] = [];
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase', masterAdminEmail: null }),
    seedDemo: false,
    verifyFirebaseToken: async (token) => {
      verifiedTokens.push(token);
      if (token !== 'provider-verified-teacher') throw new Error('Signature validation failed.');
      return teacher;
    },
  });

  const demoLogin = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    payload: { persona: 'master' },
  });
  assert.equal(demoLogin.statusCode, 404, demoLogin.body);

  const demoBearer = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer('demo_forged-master-token'),
  });
  assert.equal(demoBearer.statusCode, 401, demoBearer.body);
  assert.deepEqual(
    verifiedTokens,
    [],
    'A demo token must be refused before Firebase verification.',
  );

  const badSignature = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { ...bearer('not-a-valid-provider-token'), 'x-role': 'master' },
  });
  assert.equal(badSignature.statusCode, 401, badSignature.body);
  assert.deepEqual(verifiedTokens, ['not-a-valid-provider-token']);

  const accepted = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { ...bearer('provider-verified-teacher'), 'x-role': 'master' },
  });
  expectSuccess(accepted);
  const profile = accepted.json<{ user: { id: string; role: string }; classes: unknown[] }>();
  assert.equal(profile.user.id, teacher.uid);
  assert.equal(profile.user.role, 'student');
  assert.deepEqual(profile.classes, []);
  assert.deepEqual(verifiedTokens, ['not-a-valid-provider-token', 'provider-verified-teacher']);

  const noImplicitOwner = await app.inject({
    method: 'GET',
    url: '/api/admin/overview',
    headers: bearer('provider-verified-teacher'),
  });
  expectForbidden(noImplicitOwner);
});

test('the HTTP authentication boundary rejects ineligible verified-token claims before creating users', async (t) => {
  const identities: Record<string, VerifiedIdentity> = {
    'owner-token': owner,
    'unverified-token': { ...student, email_verified: false },
    'subdomain-token': { ...student, email: 'student@sub.szabist-isb.pk' },
    'suffix-token': { ...student, email: 'student@szabist-isb.pk.attacker.example' },
  };
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase', masterAdminEmail: owner.email! }),
    seedDemo: false,
    verifyFirebaseToken: async (token) => {
      const identity = identities[token];
      if (!identity) throw new Error('Unknown token.');
      return identity;
    },
  });

  for (const token of ['unverified-token', 'subdomain-token', 'suffix-token']) {
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) });
    assert.equal(response.statusCode, 403, response.body);
  }

  const overview = await app.inject({
    method: 'GET',
    url: '/api/admin/overview',
    headers: bearer('owner-token'),
  });
  expectSuccess(overview);
  const users = overview.json<{ users: { id: string }[] }>().users;
  assert.equal(users.length, 1, 'Rejected identities must not become application accounts.');
  assert.equal(users[0]!.id, owner.uid);
});

test('a verified teacher can sign in but only approved class membership permits class access', async (t) => {
  const identities: Record<string, VerifiedIdentity> = {
    'owner-token': owner,
    'student-token': student,
    'teacher-token': teacher,
  };
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase', masterAdminEmail: owner.email! }),
    seedDemo: false,
    verifyFirebaseToken: async (token) => {
      const identity = identities[token];
      if (!identity) throw new Error('Unknown token.');
      return identity;
    },
  });

  const classFields = {
    name: '5D Verified Identities',
    program: 'BS Computer Science',
    semester: 5,
    section: '5D',
    description: 'Membership is separate from control of a university email address.',
  };
  const request = await app.inject({
    method: 'POST',
    url: '/api/class-requests',
    headers: bearer('student-token'),
    payload: classFields,
  });
  expectSuccess(request);
  const requestId = request.json<{ request: { id: string } }>().request.id;

  const approval = await app.inject({
    method: 'POST',
    url: `/api/admin/class-requests/${requestId}/decision`,
    headers: bearer('owner-token'),
    payload: { decision: 'approve' },
  });
  expectSuccess(approval);
  const classId = approval.json<{ classId: string }>().classId;

  const teacherProfile = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer('teacher-token'),
  });
  expectSuccess(teacherProfile);
  const profile = teacherProfile.json<{
    user: { email: string; role: string };
    classes: unknown[];
  }>();
  assert.equal(profile.user.email, teacher.email);
  assert.equal(profile.user.role, 'student');
  assert.deepEqual(profile.classes, []);

  const noMembership = await app.inject({
    method: 'GET',
    url: `/api/classes/${classId}`,
    headers: bearer('teacher-token'),
  });
  expectForbidden(noMembership);

  const invitation = await app.inject({
    method: 'POST',
    url: `/api/classes/${classId}/invite`,
    headers: bearer('student-token'),
  });
  expectSuccess(invitation);
  const join = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer('teacher-token'),
    payload: { code: invitation.json<{ code: string }>().code },
  });
  expectSuccess(join);
  const membership = join.json<{ membership: { id: string; status: string } }>().membership;
  assert.equal(membership.status, 'pending');

  const pendingAccess = await app.inject({
    method: 'GET',
    url: `/api/classes/${classId}`,
    headers: bearer('teacher-token'),
  });
  expectForbidden(pendingAccess);

  const membershipApproval = await app.inject({
    method: 'POST',
    url: `/api/classes/${classId}/memberships/${membership.id}/decision`,
    headers: bearer('student-token'),
    payload: { decision: 'approve' },
  });
  expectSuccess(membershipApproval);

  const approvedAccess = await app.inject({
    method: 'GET',
    url: `/api/classes/${classId}`,
    headers: bearer('teacher-token'),
  });
  expectSuccess(approvedAccess);
  assert.equal(approvedAccess.json<{ myRole: string }>().myRole, 'student');

  const cannotEdit = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${classId}`,
    headers: bearer('teacher-token'),
    payload: { ...classFields, name: 'A teacher email does not grant CR privileges' },
  });
  expectForbidden(cannotEdit);
});
