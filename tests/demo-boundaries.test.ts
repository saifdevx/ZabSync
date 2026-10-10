import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTestConfig } from '../server/config.js';
import { createTestApp, expectSuccess } from './helpers.js';

test('demo login rejects nonlocal peers even when forwarded headers claim localhost', async (t) => {
  const app = await createTestApp(t);
  const response = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    remoteAddress: '192.0.2.25',
    headers: { host: 'localhost:3001', 'x-forwarded-for': '127.0.0.1' },
    payload: { persona: 'master' },
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json<{ error: { code: string } }>().error.code, 'demo_local_only');

  const loopbackLogin = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    remoteAddress: '127.0.0.1',
    headers: { host: 'localhost:3001' },
    payload: { persona: 'master' },
  });
  expectSuccess(loopbackLogin);
});

test('demo login requires an exact loopback Host and an allowed browser Origin', async (t) => {
  const app = await createTestApp(t);
  for (const host of ['evil.example', 'localhost.evil.example']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/demo/session',
      headers: { host },
      payload: { persona: 'master' },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'invalid_host');
  }

  const crossOrigin = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    headers: { host: 'localhost:3001', origin: 'https://evil.example' },
    payload: { persona: 'master' },
  });
  assert.equal(crossOrigin.statusCode, 403, crossOrigin.body);
  assert.equal(crossOrigin.json<{ error: { code: string } }>().error.code, 'origin_not_allowed');

  const allowedOrigin = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
    payload: { persona: 'master' },
  });
  expectSuccess(allowedOrigin);
});

test('demo cannot start on a public interface or with a public allowed origin', async (t) => {
  await assert.rejects(
    () => createTestApp(t, { config: makeTestConfig({ host: '0.0.0.0' }) }),
    /localhost|loopback/i,
  );
  await assert.rejects(
    () =>
      createTestApp(t, { config: makeTestConfig({ allowedOrigins: ['https://campus.example'] }) }),
    /loopback/i,
  );
});
