import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageAcademic, enrolledClasses } from '../client/src/permissions.js';
import type { MeResponse } from '../client/src/types.js';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectSuccess } from './helpers.js';

test('shared editor permissions fail closed for unknown roles and require the current classroom and owner context', async (t) => {
  const app = await createTestApp(t);
  const token = await demoToken(app, 'admin');
  const response = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(token) });
  expectSuccess(response);
  const admin = response.json<MeResponse>();
  const options = { offline: false, maintenance: false, ownerContext: false };
  assert.equal(canManageAcademic(admin, DEMO_CLASS_ID, options), true);
  assert.equal(canManageAcademic(admin, DEMO_OTHER_CLASS_ID, options), false);
  assert.equal(canManageAcademic(admin, undefined, options), false);
  assert.equal(canManageAcademic(admin, DEMO_CLASS_ID, { ...options, offline: true }), false);
  assert.equal(canManageAcademic(admin, DEMO_CLASS_ID, { ...options, maintenance: true }), false);
  for (const role of [undefined, null, '', 'master', 'cr', 'gr', 'pending']) {
    const unconfirmed = {
      ...admin,
      classes: admin.classes.map((entry) => ({ ...entry, role })),
    } as unknown as MeResponse;
    assert.equal(
      canManageAcademic(unconfirmed, DEMO_CLASS_ID, options),
      false,
      `Unknown membership role ${String(role)} must not expose an editor.`,
    );
    assert.deepEqual(enrolledClasses(unconfirmed), []);
  }
  for (const role of [undefined, null, '', 'admin']) {
    const unconfirmed = { ...admin, user: { ...admin.user, role } } as unknown as MeResponse;
    assert.equal(canManageAcademic(unconfirmed, DEMO_CLASS_ID, options), false);
    assert.deepEqual(enrolledClasses(unconfirmed), []);
  }
  assert.equal(canManageAcademic(null, DEMO_CLASS_ID, options), false);
  assert.equal(
    canManageAcademic(
      { ...admin, user: { ...admin.user, status: 'suspended' } },
      DEMO_CLASS_ID,
      options,
    ),
    false,
  );

  const ownerToken = await demoToken(app, 'master');
  const owner = (
    await app.inject({ method: 'GET', url: '/api/me', headers: bearer(ownerToken) })
  ).json<MeResponse>();
  assert.equal(
    canManageAcademic(owner, DEMO_OTHER_CLASS_ID, options),
    false,
    'An owner alias must redirect into the owner console before showing shared tools.',
  );
  assert.equal(
    canManageAcademic(owner, DEMO_OTHER_CLASS_ID, { ...options, ownerContext: true }),
    true,
  );
  assert.equal(
    canManageAcademic(owner, undefined, { ...options, ownerContext: true }),
    true,
    'Global notices are available inside the owner console.',
  );
  assert.equal(
    canManageAcademic(owner, DEMO_OTHER_CLASS_ID, {
      ...options,
      ownerContext: true,
      offline: true,
    }),
    false,
  );
});
