import assert from 'node:assert/strict';
import test from 'node:test';
import { bearer, createTestApp, demoToken, expectSuccess } from './helpers.js';

test('simultaneous duplicate class creation attempts produce one class and one conflict without a database error', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'admin');
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
  const classes = profile.json<{ classes: { name: string; role: string }[] }>().classes;
  assert.equal(
    classes.filter((classroom) => classroom.name === fields.name && classroom.role === 'admin')
      .length,
    1,
  );
});
