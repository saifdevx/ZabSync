import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const validClassUpdate = {
  name: '5D Security Test',
  program: 'BS Computer Science',
  semester: 5,
  section: '5D',
  description: 'An authorized class admin may update these class details.',
};

test('protected routes require a real bearer session and reject identity/role headers', async (t) => {
  const app = await createTestApp(t);

  for (const headers of [
    {},
    {
      'x-role': 'master',
      'x-user-role': 'master',
      'x-user-id': DEMO_USERS.master.id,
      'x-user-email': DEMO_USERS.master.email,
      'x-admin': 'true',
      'x-master-admin': 'true',
    },
    { authorization: 'Bearer not-a-valid-session' },
  ]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers,
    });
    assert.equal(response.statusCode, 401, response.body);
  }

  const student = await demoToken(app, 'student');
  const ownClass = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(student),
  });
  expectSuccess(ownClass);

  const spoofedWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: {
      ...bearer(student),
      'x-role': 'master',
      'x-user-role': 'admin',
      'x-user-id': DEMO_USERS.master.id,
      'x-admin': 'true',
    },
    payload: validClassUpdate,
  });
  expectForbidden(spoofedWrite);

  // The same payload succeeds for an authorized class admin. A validation
  // failure therefore cannot masquerade as a successful access-control check.
  const admin = await demoToken(app, 'admin');
  const allowedWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(admin),
    payload: validClassUpdate,
  });
  expectSuccess(allowedWrite);
});

test('a student cannot read another class or use class admin/owner endpoints', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');

  const classRead = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_OTHER_CLASS_ID}`,
    headers: bearer(student),
  });
  expectForbidden(classRead);

  const rotate = await app.inject({
    method: 'POST',
    url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
    headers: bearer(student),
  });
  expectForbidden(rotate);

  const masterPanel = await app.inject({
    method: 'GET',
    url: '/api/admin/overview',
    headers: bearer(student),
  });
  expectForbidden(masterPanel);

  const master = await demoToken(app, 'master');
  const permittedMasterPanel = await app.inject({
    method: 'GET',
    url: '/api/admin/overview',
    headers: bearer(master),
  });
  expectSuccess(permittedMasterPanel);

  const admin = await demoToken(app, 'admin');
  const adminInvite = await app.inject({
    method: 'POST',
    url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
    headers: bearer(admin),
  });
  expectSuccess(adminInvite);
  assert.ok(adminInvite.json<{ code: string }>().code);
});

test('Class admin permissions are scoped to approved class membership', async (t) => {
  const app = await createTestApp(t);

  for (const persona of ['admin'] as const) {
    const token = await demoToken(app, persona);
    const allowed = await app.inject({
      method: 'PATCH',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(token),
      payload: { ...validClassUpdate, name: `${persona.toUpperCase()} authorized edit` },
    });
    expectSuccess(allowed);

    const otherClass = await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_OTHER_CLASS_ID}`,
      headers: bearer(token),
    });
    expectForbidden(otherClass);

    const crossClassWrite = await app.inject({
      method: 'PATCH',
      url: `/api/classes/${DEMO_OTHER_CLASS_ID}`,
      headers: bearer(token),
      payload: validClassUpdate,
    });
    expectForbidden(crossClassWrite);

    const crossClassInvite = await app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.other}/invite`,
      headers: bearer(token),
    });
    expectForbidden(crossClassInvite);
  }
});

test('students can see a minimal roster without member emails, pending requests or invitations', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');
  const admin = await demoToken(app, 'admin');

  const studentView = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(student),
  });
  expectSuccess(studentView);
  const studentBody = studentView.json<{
    members: {
      userId: string;
      displayName: string;
      role: string;
      status: string;
      email?: string;
    }[];
    pendingMembers: unknown[];
    invite: unknown;
  }>();
  assert.ok(studentBody.members.length > 0, 'Approved students should see the class roster.');
  for (const member of studentBody.members) {
    assert.ok(member.userId);
    assert.ok(member.displayName);
    assert.ok(member.role);
    assert.ok(member.status);
    assert.ok(!Object.hasOwn(member, 'email'), 'A student roster entry must omit its email field.');
  }
  assert.deepEqual(studentBody.pendingMembers, []);
  assert.equal(studentBody.invite, null);

  const adminView = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(admin),
  });
  expectSuccess(adminView);
  const adminBody = adminView.json<{ members: unknown[] }>();
  assert.ok(adminBody.members.length > 0, 'The class admin should have a useful member directory.');
});
