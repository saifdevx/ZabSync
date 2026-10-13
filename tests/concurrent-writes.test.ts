import assert from 'node:assert/strict';
import test from 'node:test';
import { bearer, createTestApp, demoToken, expectSuccess } from './helpers.js';

test('simultaneous duplicate class creation attempts produce one class and one conflict without a database error', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'master');
  const fields = {
    name: 'Concurrent 6F',
    program: 'BS Computer Science',
    semester: 6,
    section: 'F',
    description: 'Two submissions for the same class.',
  };
  const responses = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/classes',
        headers: bearer(student),
        payload: fields,
      }),
    ),
  );

  assert.deepEqual(
    responses.map((response) => response.statusCode).sort((a, b) => a - b),
    [201, 409],
    responses.map((response) => `${response.statusCode}: ${response.body}`).join('\n'),
  );
  const profile = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(student) });
  expectSuccess(profile);
  assert.deepEqual(profile.json().classes, [], 'Owner-created sections do not enroll the owner.');
  const directory = await app.inject({
    method: 'GET',
    url: '/api/admin/overview',
    headers: bearer(student),
  });
  expectSuccess(directory);
  assert.equal(
    directory.json().classes.filter((c: { name: string }) => c.name === fields.name).length,
    1,
  );
});
