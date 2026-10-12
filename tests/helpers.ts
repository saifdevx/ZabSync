import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';

export type TestApp = Awaited<ReturnType<typeof createApp>>;
export type TestAppOptions = Omit<
  NonNullable<Parameters<typeof createApp>[0]>,
  'db' | 'databaseUrl'
>;

/**
 * Use the real HTTP application and an isolated on-disk database. All fixtures
 * disappear after the test, including when an assertion fails.
 */
export async function createTestApp(
  t: TestContext,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const directory = await mkdtemp(join(fileURLToPath(new URL('.', import.meta.url)), '.database-'));

  let app: TestApp | undefined;
  t.after(async () => {
    try {
      await app?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  app = await createApp({
    config: makeTestConfig(),
    seedDemo: true,
    ...options,
    databaseUrl: pathToFileURL(join(directory, 'campus.sqlite')).href,
  });
  await app.ready();
  return app;
}

export async function demoToken(
  app: TestApp,
  persona: 'student' | 'admin' | 'master',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    payload: { persona },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json<{ token: string }>();
  assert.equal(typeof body.token, 'string');
  assert.ok(body.token.length > 0, 'Demo login must return an opaque bearer token.');
  return body.token;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function expectClientRejection(
  response: { statusCode: number; body: string },
  description: string,
): void {
  assert.ok(
    response.statusCode >= 400 && response.statusCode < 500,
    `${description}: expected a client rejection, received ${response.statusCode}: ${response.body}`,
  );
}

export function expectSuccess(response: { statusCode: number; body: string }): void {
  assert.ok(
    response.statusCode >= 200 && response.statusCode < 300,
    `Expected success, received ${response.statusCode}: ${response.body}`,
  );
}

export function expectForbidden(response: { statusCode: number; body: string }): void {
  assert.ok(
    response.statusCode === 403 || response.statusCode === 404,
    `Expected access to be forbidden or hidden, received ${response.statusCode}: ${response.body}`,
  );
}
