import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

test('operational data and recovery actions are owner-only and expose no provider credentials', async (t) => {
  const app = await createTestApp(t);
  const student = bearer(await demoToken(app, 'student')),
    owner = bearer(await demoToken(app, 'master'));
  for (const path of ['/api/admin/operations', '/api/admin/storage/usage']) {
    expectForbidden(await app.inject({ url: path, headers: student }));
    const reply = await app.inject({ url: path, headers: owner });
    expectSuccess(reply);
    assert.doesNotMatch(
      reply.body,
      /privateKey|clientSecret|encryptionKey|databaseAuthToken|refresh_token/,
    );
  }
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: '/api/admin/operations/retry-reminders',
      headers: student,
      payload: { confirm: true },
    }),
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/operations/retry-reminders',
        headers: owner,
        payload: {},
      })
    ).statusCode,
    400,
  );
});
test('partial feature updates cannot re-enable a previously disabled new feature', async (t) => {
  const app = await createTestApp(t),
    headers = bearer(await demoToken(app, 'master'));
  let value = (await app.inject({ url: '/api/admin/settings', headers })).json().settings;
  let reply = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers,
    payload: { version: value.version, features: { chat: false, reminders: false } },
  });
  expectSuccess(reply);
  value = reply.json().settings;
  reply = await app.inject({
    method: 'PATCH',
    url: '/api/admin/settings',
    headers,
    payload: { version: value.version, features: { developer: false } },
  });
  expectSuccess(reply);
  value = reply.json().settings;
  assert.equal(value.features.chat, false);
  assert.equal(value.features.reminders, false);
  assert.equal(value.features.frontPage, true);
});
