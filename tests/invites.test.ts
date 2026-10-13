import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { bearer, createTestApp, demoToken, expectSuccess } from './helpers.js';

test('subject invitation rotation and revocation invalidate old secrets without changing active enrollment', async (t) => {
  const app = await createTestApp(t),
    admin = await demoToken(app, 'admin'),
    student = await demoToken(app, 'student');
  const rotate = () =>
    app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
      headers: bearer(admin),
    });
  const first = await rotate(),
    second = await rotate();
  expectSuccess(first);
  expectSuccess(second);
  assert.notEqual(first.json().code, second.json().code);
  const join = (code: string) =>
    app.inject({
      method: 'POST',
      url: '/api/subjects/join',
      headers: bearer(student),
      payload: { code },
    });
  assert.equal((await join(first.json().code)).statusCode, 400);
  const current = await join(second.json().code);
  expectSuccess(current);
  assert.equal(current.json().membership.status, 'active');
  const codeRead = await app.inject({
    method: 'GET',
    url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
    headers: bearer(admin),
  });
  assert.ok(!codeRead.body.includes(second.json().code));
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
      headers: bearer(admin),
    }),
  );
  assert.equal((await join(second.json().code)).statusCode, 400);
  expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}`,
      headers: bearer(student),
    }),
  );
});

test('expired subject codes fail even with fresh authenticated sessions', async (t) => {
  let currentTime = Date.parse('2026-10-12T08:00:00Z');
  const app = await createTestApp(t, { now: () => new Date(currentTime) }),
    admin = await demoToken(app, 'admin');
  const invite = await app.inject({
    method: 'POST',
    url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
    headers: bearer(admin),
  });
  expectSuccess(invite);
  currentTime = Date.parse(invite.json().expiresAt) + 1;
  const student = await demoToken(app, 'student');
  const expired = await app.inject({
    method: 'POST',
    url: '/api/subjects/join',
    headers: bearer(student),
    payload: { code: invite.json().code },
  });
  assert.equal(expired.statusCode, 400, expired.body);
  assert.equal(expired.json().error.code, 'invalid_invite');
});
