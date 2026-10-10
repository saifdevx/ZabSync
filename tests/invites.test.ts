import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_OTHER_CLASS_ID } from '../server/demo.js';
import {
  bearer,
  createTestApp,
  demoToken,
  expectClientRejection,
  expectForbidden,
  expectSuccess,
  type TestApp,
} from './helpers.js';

async function rotateInvite(app: TestApp, masterToken: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_OTHER_CLASS_ID}/invite`,
    headers: bearer(masterToken),
  });
  expectSuccess(response);
  const invite = response.json<{ code: string; expiresAt: string }>();
  assert.ok(invite.code);
  assert.ok(Number.isFinite(Date.parse(invite.expiresAt)));
  return invite;
}

test('rotating a class invitation invalidates its old code immediately', async (t) => {
  const app = await createTestApp(t);
  const master = await demoToken(app, 'master');
  const student = await demoToken(app, 'student');
  const previous = await rotateInvite(app, master);
  const current = await rotateInvite(app, master);
  assert.notEqual(current.code, previous.code);

  const oldCode = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(student),
    payload: { code: previous.code },
  });
  expectClientRejection(oldCode, 'A rotated invitation must not create a membership.');

  const afterOldCode = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_OTHER_CLASS_ID}`,
    headers: bearer(student),
  });
  expectForbidden(afterOldCode);

  const currentCode = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(student),
    payload: { code: current.code },
  });
  expectSuccess(currentCode);
  const membership = currentCode.json<{
    membership: { id: string; classId: string; status: string };
  }>().membership;
  assert.equal(membership.classId, DEMO_OTHER_CLASS_ID);
  assert.equal(membership.status, 'pending');

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_OTHER_CLASS_ID}/memberships/${membership.id}/decision`,
    headers: bearer(master),
    payload: { decision: 'reject' },
  });
  expectSuccess(rejected);
  const ownHistory = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(student) });
  expectSuccess(ownHistory);
  assert.equal(
    ownHistory
      .json<{ pendingMemberships: { id: string; status: string }[] }>()
      .pendingMemberships.find((request) => request.id === membership.id)?.status,
    'rejected',
  );
});

test('an expired invite stays invalid even when the student has a fresh valid session', async (t) => {
  let currentTime = Date.parse('2026-10-10T05:00:00.000Z');
  const app = await createTestApp(t, { now: () => new Date(currentTime) });
  const originalMasterSession = await demoToken(app, 'master');
  const expiredInvite = await rotateInvite(app, originalMasterSession);

  currentTime = Date.parse(expiredInvite.expiresAt) + 1;
  const student = await demoToken(app, 'student');
  const freshMasterSession = await demoToken(app, 'master');

  const expiredCode = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(student),
    payload: { code: expiredInvite.code },
  });
  expectClientRejection(expiredCode, 'An expired invitation must not create a membership.');
  assert.notEqual(
    expiredCode.statusCode,
    401,
    'This must reject the invite, not the fresh session.',
  );

  const afterExpiredCode = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_OTHER_CLASS_ID}`,
    headers: bearer(student),
  });
  expectForbidden(afterExpiredCode);

  const freshInvite = await rotateInvite(app, freshMasterSession);
  const currentCode = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(student),
    payload: { code: freshInvite.code },
  });
  expectSuccess(currentCode);
  assert.equal(currentCode.json<{ membership: { status: string } }>().membership.status, 'pending');
});
