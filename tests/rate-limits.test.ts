import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { VerifiedIdentity } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';
import { bearer, createTestApp } from './helpers.js';

const firstStudent: VerifiedIdentity = { uid: 'rate-first-student', email: 'rate.first@szabist-isb.pk', email_verified: true, name: 'First Student' };
const secondStudent: VerifiedIdentity = { uid: 'rate-second-student', email: 'rate.second@szabist-isb.pk', email_verified: true, name: 'Second Student' };

test('classmates behind one IP have independent account quotas and token rotation cannot reset a user quota', async (t) => {
  let verifierCalls = 0;
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase' }),
    seedDemo: false,
    verifyFirebaseToken: async (token) => {
      verifierCalls++;
      if (token === 'first-token' || token === 'rotated-first-token') return firstStudent;
      if (token === 'second-token') return secondStudent;
      throw new Error('Unverified identity.');
    },
  });
  const submit = (token: string, forwardedIp = '203.0.113.1') => app.inject({
    method: 'POST', url: '/api/join', remoteAddress: '192.0.2.77',
    headers: { ...bearer(token), 'x-forwarded-for': forwardedIp, 'x-user-id': 'fake-limit-reset' },
    payload: { code: 'invalid-code' },
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await submit('first-token');
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error.code, 'invalid_invite');
  }
  const firstLimited = await submit('rotated-first-token', '203.0.113.200');
  assert.equal(firstLimited.statusCode, 429, firstLimited.body);
  assert.ok(Number(firstLimited.headers['retry-after']) > 0);
  assert.equal(verifierCalls, 11, 'Rate limiting and the handler must share one verification per request.');
  const otherStudent = await submit('second-token');
  assert.equal(otherStudent.statusCode, 400, otherStudent.body);
  assert.equal(otherStudent.json().error.code, 'invalid_invite', 'Another student on the same Wi-Fi must retain their own quota.');
  assert.equal(verifierCalls, 12);
});

test('failed and missing identities are counted by real peer IP while static assets avoid verification and API quotas', async (t) => {
  let verifierCalls = 0;
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase' }),
    seedDemo: false,
    staticRoot: fileURLToPath(new URL('../client/public/', import.meta.url)),
    verifyFirebaseToken: async (token) => {
      verifierCalls++;
      if (token === 'real-student') return firstStudent;
      throw new Error('Signature rejected.');
    },
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await app.inject({ method: 'POST', url: '/api/join', remoteAddress: '192.0.2.88',
      headers: { ...bearer(`invented-token-${attempt}`), 'x-forwarded-for': `198.51.100.${attempt + 1}` },
      payload: { code: 'invalid-code' } });
    assert.equal(response.statusCode, 401, response.body);
  }
  assert.equal(verifierCalls, 10, 'Rejected verification must not be repeated by the handler.');
  const limited = await app.inject({ method: 'POST', url: '/api/join', remoteAddress: '192.0.2.88',
    headers: { 'x-forwarded-for': '198.51.100.250', 'x-user-id': 'forged-master', 'x-role': 'master' }, payload: { code: 'invalid-code' } });
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(verifierCalls, 10, 'A missing bearer token is rejected locally.');

  const valid = await app.inject({ method: 'POST', url: '/api/join', remoteAddress: '192.0.2.88', headers: bearer('real-student'), payload: { code: 'invalid-code' } });
  assert.equal(valid.statusCode, 400, valid.body);
  assert.equal(valid.json().error.code, 'invalid_invite');
  assert.equal(verifierCalls, 11);
  const asset = await app.inject({ method: 'GET', url: '/branding/szabist-horizontal.png', remoteAddress: '192.0.2.88', headers: bearer('invented-static-token') });
  assert.equal(asset.statusCode, 200, asset.body);
  assert.equal(asset.headers['content-type'], 'image/png');
  assert.equal(asset.headers['x-ratelimit-limit'], undefined);
  assert.equal(verifierCalls, 11, 'Static assets must not incur Firebase verification.');
});

test('invalid storage configuration fails before creating an owned SQLite database', async (t) => {
  const directory = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.startup-test-'));
  const previousDriver = process.env.STORAGE_DRIVER;
  t.after(async () => {
    if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = previousDriver;
    await rm(directory, { recursive: true, force: true });
  });
  process.env.STORAGE_DRIVER = 'unsupported-driver';
  const databasePath = join(directory, 'should-not-exist', 'campus.sqlite');
  await assert.rejects(() => createApp({ config: makeTestConfig({ nodeEnv: 'development', databaseUrl: pathToFileURL(databasePath).href }) }), /STORAGE_DRIVER/);
  await assert.rejects(() => stat(databasePath), { code: 'ENOENT' });
});
