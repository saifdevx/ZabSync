import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const validClassUpdate = {
  name: '5D Representative Handover',
  program: 'BS Computer Science',
  semester: 5,
  section: 'D',
  description: 'Editing rights must follow the current class role.',
};

test('only the master can replace representatives and existing sessions immediately use their new class roles', async (t) => {
  const app = await createTestApp(t);
  const originalCr = await demoToken(app, 'cr');
  const replacement = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  const appointment = { userId: DEMO_USERS.student.id, role: 'cr' };

  const originalPermission = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(originalCr),
    payload: validClassUpdate,
  });
  expectSuccess(originalPermission);

  for (const unauthorized of [originalCr, replacement]) {
    const selfAppointment = await app.inject({
      method: 'POST',
      url: `/api/admin/classes/${DEMO_CLASS_ID}/representatives`,
      headers: { ...bearer(unauthorized), 'x-role': 'master' },
      payload: appointment,
    });
    expectForbidden(selfAppointment);
  }

  const handover = await app.inject({
    method: 'POST',
    url: `/api/admin/classes/${DEMO_CLASS_ID}/representatives`,
    headers: bearer(master),
    payload: appointment,
  });
  expectSuccess(handover);

  const afterHandover = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(master),
  });
  expectSuccess(afterHandover);
  const roster = afterHandover.json<{ members: { userId: string; role: string }[] }>().members;
  assert.deepEqual(
    roster.filter((member) => member.role === 'cr').map((member) => member.userId),
    [DEMO_USERS.student.id],
  );
  assert.equal(roster.find((member) => member.userId === DEMO_USERS.cr.id)?.role, 'student');

  // No fresh login or changed bearer token: cached client roles must not decide
  // whether the server accepts either person's next request.
  const formerCrWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(originalCr),
    payload: validClassUpdate,
  });
  expectForbidden(formerCrWrite);
  const formerCrInvite = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/invite`,
    headers: bearer(originalCr),
  });
  expectForbidden(formerCrInvite);

  const newCrWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(replacement),
    payload: validClassUpdate,
  });
  expectSuccess(newCrWrite);
  const newCrInvite = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/invite`,
    headers: bearer(replacement),
  });
  expectSuccess(newCrInvite);
});

test('the master cannot demote or remove the only CR, and removing an ordinary member revokes access', async (t) => {
  const app = await createTestApp(t);
  const master = await demoToken(app, 'master');
  const student = await demoToken(app, 'student');

  const demoteOnlyCr = await app.inject({
    method: 'POST',
    url: `/api/admin/classes/${DEMO_CLASS_ID}/representatives`,
    headers: bearer(master),
    payload: { userId: DEMO_USERS.cr.id, role: 'student' },
  });
  assert.equal(demoteOnlyCr.statusCode, 409, demoteOnlyCr.body);
  const removeOnlyCr = await app.inject({
    method: 'DELETE',
    url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.cr.id}`,
    headers: bearer(master),
  });
  assert.equal(removeOnlyCr.statusCode, 409, removeOnlyCr.body);

  const preservedRoster = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(master),
  });
  expectSuccess(preservedRoster);
  const representatives = preservedRoster
    .json<{ members: { userId: string; role: string }[] }>()
    .members.filter((member) => member.role === 'cr');
  assert.equal(representatives.length, 1);
  assert.equal(representatives[0]!.userId, DEMO_USERS.cr.id);

  const ordinaryMemberBefore = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(student),
  });
  expectSuccess(ordinaryMemberBefore);
  const removeOrdinaryMember = await app.inject({
    method: 'DELETE',
    url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.student.id}`,
    headers: bearer(master),
  });
  expectSuccess(removeOrdinaryMember);
  const ordinaryMemberAfter = await app.inject({
    method: 'GET',
    url: `/api/classes/${DEMO_CLASS_ID}`,
    headers: bearer(student),
  });
  expectForbidden(ordinaryMemberAfter);
});
