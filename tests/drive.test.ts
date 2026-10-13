import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { makeTestConfig } from '../server/config.js';
import { first, migrate, openDatabase } from '../server/db.js';
import { driveMigration } from '../server/drive-migration.js';
import { DRIVE_SCOPE, loadDriveConfig } from '../server/drive-config.js';
import {
  createDriveService,
  createHybridStorage,
  decryptDriveSecret,
  encryptDriveSecret,
  registerDriveRoutes,
  validateDriveSessionUrl,
} from '../server/drive.js';
import { ApiError } from '../server/errors.js';
import { createPrivateStorage } from '../server/storage.js';
import type { CurrentUser } from '../server/auth.js';

const date = '2026-10-12T10:00:00.000Z';
const env = {
  GOOGLE_DRIVE_CLIENT_ID: '1234-test.apps.googleusercontent.com',
  GOOGLE_DRIVE_CLIENT_SECRET: 'unit-test-only-secret',
  GOOGLE_DRIVE_REDIRECT_URI: 'http://localhost:3001/oauth/google-drive/callback',
  DRIVE_RETURN_URL: 'http://localhost:5173/account',
  DRIVE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64'),
};

function provider() {
  let generated = 0,
    exchanges = 0,
    refreshes = 0,
    uploads = 0,
    googleSub = 'google_owner_one',
    googleEmail = 'storage-owner@gmail.com';
  let failUpload = false,
    badSession = false,
    invalidGrant = false,
    denyDownload = false;
  const files = new Map<string, { metadata: Record<string, unknown>; bytes: Buffer }>();
  const sessions = new Map<string, { id: string; mimeType: string }>();
  let lastVerifier = '';
  let deferred401: { started: () => void; response: Promise<Response> } | null = null;
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)),
      method = init?.method || 'GET';
    assert.equal(init?.redirect, 'manual', 'provider redirects are never automatically followed');
    assert.equal(url.protocol, 'https:');
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get('client_secret'), env.GOOGLE_DRIVE_CLIENT_SECRET);
      if (params.get('grant_type') === 'authorization_code') {
        exchanges++;
        lastVerifier = params.get('code_verifier') || '';
      } else {
        refreshes++;
        if (invalidGrant) return json({ error: 'invalid_grant' }, 400);
      }
      return json({
        access_token: `test-access-${googleSub}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: `openid email ${DRIVE_SCOPE}`,
        ...(params.get('grant_type') === 'authorization_code'
          ? { refresh_token: `test-refresh-${googleSub}` }
          : {}),
      });
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke')
      return new Response(null, { status: 200 });
    const authorization = new Headers(init?.headers).get('authorization');
    assert.match(authorization || '', /^Bearer test-access-/);
    if (url.hostname === 'openidconnect.googleapis.com' && url.pathname === '/v1/userinfo')
      return json({ sub: googleSub, email: googleEmail, email_verified: true });
    assert.equal(
      url.hostname,
      'www.googleapis.com',
      'only fixed provider hosts can receive tokens/files',
    );
    if (deferred401) {
      const pending = deferred401;
      deferred401 = null;
      pending.started();
      return pending.response;
    }
    if (url.pathname.endsWith('/generateIds')) return json({ ids: [`drive_file_${++generated}`] });
    if (url.pathname === '/upload/drive/v3/files') {
      if (method === 'POST') {
        const metadata = JSON.parse(String(init?.body));
        assert.equal(
          metadata.mimeType.startsWith('application/vnd.google-apps'),
          false,
          'original binary is preserved without Docs conversion',
        );
        assert.equal(metadata.parents, undefined, 'no shared folder or public ACL is requested');
        assert.equal(metadata.permissions, undefined);
        assert.equal(url.searchParams.get('keepRevisionForever'), 'true');
        assert.equal(url.searchParams.get('ignoreDefaultVisibility'), 'true');
        sessions.set(metadata.id, metadata);
        return new Response(null, {
          status: 200,
          headers: {
            location: badSession
              ? 'https://attacker.example/upload'
              : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${metadata.id}`,
          },
        });
      }
      const session = sessions.get(url.searchParams.get('upload_id') || '');
      if (method === 'DELETE') {
        sessions.delete(url.searchParams.get('upload_id') || '');
        return new Response(null, { status: 204 });
      }
      assert.equal(method, 'PUT');
      uploads++;
      if (failUpload) return json({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } }, 403);
      assert.ok(session);
      assert.ok(init?.body instanceof Readable, 'upload remains a stream from the private spool');
      const chunks: Buffer[] = [];
      for await (const chunk of init.body as unknown as Readable) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks),
        metadata = {
          id: session.id,
          size: String(bytes.length),
          mimeType: session.mimeType,
          sha256Checksum: createHash('sha256').update(bytes).digest('hex'),
          headRevisionId: `revision_${session.id}`,
          trashed: false,
          capabilities: { canDownload: true },
        };
      files.set(session.id, { metadata, bytes });
      return json(metadata);
    }
    const matches = url.pathname.match(
      /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)(?:\/revisions\/([A-Za-z0-9_-]+))?$/,
    );
    assert.ok(matches, `unexpected provider URL: ${url.pathname}`);
    const file = files.get(matches[1]!);
    if (method === 'DELETE') {
      files.delete(matches[1]!);
      return new Response(null, { status: file ? 204 : 404 });
    }
    if (!file) return json({ error: { code: 404 } }, 404);
    if (matches[2]) {
      assert.equal(matches[2], file.metadata.headRevisionId);
      return new Response(new Uint8Array(file.bytes), { status: 200 });
    }
    return json({ ...file.metadata, capabilities: { canDownload: !denyDownload } });
  };
  return {
    fetch: fake as typeof fetch,
    files,
    get exchanges() {
      return exchanges;
    },
    get refreshes() {
      return refreshes;
    },
    get uploads() {
      return uploads;
    },
    get lastVerifier() {
      return lastVerifier;
    },
    account(sub: string, email: string) {
      googleSub = sub;
      googleEmail = email;
    },
    failUploads() {
      failUpload = true;
    },
    evilSession() {
      badSession = true;
    },
    expireConsent() {
      invalidGrant = true;
    },
    forbidDownloads() {
      denyDownload = true;
    },
    deferNextUnauthorized() {
      let signalStart!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStart = resolve;
      });
      const response = new Promise<Response>((resolve) => {
        release = () => resolve(json({ error: { code: 401 } }, 401));
      });
      deferred401 = { started: signalStart, response };
      return { started, release };
    },
  };
}

async function fixture(t: TestContext, overrides: NodeJS.ProcessEnv = {}) {
  const root = await mkdtemp(join(process.cwd(), 'tests', '.drive-'));
  const db = await openDatabase(`file:${join(root, 'campus.db')}`);
  await migrate(db);
  // Allows this module's focused tests to run while app wiring is being integrated in parallel.
  if (!(await first(db, "SELECT name FROM sqlite_master WHERE name='drive_connections'")))
    for (const sql of driveMigration) await db.execute(sql);
  const actors: Record<'student' | 'owner' | 'other', CurrentUser> = {} as Record<
    'student' | 'owner' | 'other',
    CurrentUser
  >;
  for (const [id, role] of [
    ['student', 'student'],
    ['owner', 'master'],
    ['other', 'student'],
  ] as const) {
    await db.execute({
      sql: "INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at) VALUES (?,?,?,?,'active','firebase',?,?)",
      args: [id, `${id}@szabist-isb.pk`, id, role, date, date],
    });
    actors[id] = {
      id,
      email: `${id}@szabist-isb.pk`,
      displayName: id,
      role,
      status: 'active',
      username: null,
      rollNumber: null,
      avatarVersion: null,
    };
  }
  const appConfig = makeTestConfig({ authMode: 'firebase' }),
    config = loadDriveConfig(appConfig, { ...env, ...overrides }),
    google = provider();
  let clock = new Date(date);
  const drive = createDriveService({
    db,
    config,
    appConfig,
    now: () => clock,
    fetchForTests: google.fetch,
  });
  const base = createPrivateStorage({ driver: 'local', localDirectory: join(root, 'objects') }),
    hybrid = createHybridStorage(base, drive);
  t.after(async () => {
    await hybrid.close?.();
    db.close();
    await rm(root, { recursive: true, force: true });
  });
  async function connect(who: 'student' | 'owner' | 'other' = 'student') {
    const start = await drive.begin(actors[who]),
      url = new URL(start.authorizationUrl);
    await drive.callback(
      { state: url.searchParams.get('state'), code: 'provider-code' },
      `zabsync_drive_binding=${start.browserBinding}`,
    );
    return start;
  }
  async function file(name = 'notes.pdf') {
    const path = join(root, name),
      content = Buffer.from('%PDF-1.4\nA verified class handout.\n%%EOF');
    await writeFile(path, content);
    return { path, content, key: `resources/${randomUUID()}.pdf` };
  }
  return {
    root,
    db,
    appConfig,
    config,
    google,
    drive,
    base,
    hybrid,
    actors,
    connect,
    file,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

test('Drive configuration rejects partial credentials, wrong routes, demo cloud access and unsafe destinations', () => {
  const app = makeTestConfig({ authMode: 'firebase' });
  assert.equal(loadDriveConfig(app, {}).resourceDestination, 'base');
  assert.equal(loadDriveConfig(app, env).resourceDestination, 'drive');
  assert.equal(
    loadDriveConfig(app, { ...env, RESOURCE_STORAGE: 'base' }).resourceDestination,
    'base',
  );
  assert.throws(() => loadDriveConfig(app, { RESOURCE_STORAGE: 'drive' }), /requires/);
  assert.throws(() => loadDriveConfig(makeTestConfig(), env), /demo/);
  assert.throws(
    () => loadDriveConfig(app, { GOOGLE_DRIVE_CLIENT_ID: env.GOOGLE_DRIVE_CLIENT_ID }),
    /requires/,
  );
  assert.throws(
    () => loadDriveConfig(app, { ...env, DRIVE_TOKEN_ENCRYPTION_KEY: 'wrong' }),
    /32 random bytes/,
  );
  assert.throws(
    () => loadDriveConfig(app, { ...env, DRIVE_RETURN_URL: 'https://attacker.example/account' }),
    /ALLOWED_ORIGINS/,
  );
  assert.throws(
    () =>
      loadDriveConfig(app, {
        ...env,
        GOOGLE_DRIVE_REDIRECT_URI: 'https://attacker.example/oauth/google-drive/callback',
      }),
    /same host/,
  );
  for (const url of [
    'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com.evil.test/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=x',
    'https://user:pass@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
  ])
    assert.throws(() => validateDriveSessionUrl(url), /invalid upload session/);
});

test('Drive refresh secrets are randomized, encrypted and bound to their user/purpose', () => {
  const key = randomBytes(32),
    a = encryptDriveSecret('private-refresh-token', key, 'refresh:alice'),
    b = encryptDriveSecret('private-refresh-token', key, 'refresh:alice');
  assert.notEqual(a, b);
  assert.equal(a.includes('private-refresh-token'), false);
  assert.equal(decryptDriveSecret(a, key, 'refresh:alice'), 'private-refresh-token');
  assert.throws(() => decryptDriveSecret(a, key, 'refresh:bob'), /cannot be read/);
  assert.throws(() => decryptDriveSecret(a, randomBytes(32), 'refresh:alice'), /cannot be read/);
  const parts = a.split('.');
  parts[3] = Buffer.alloc(25).toString('base64url');
  assert.throws(() => decryptDriveSecret(parts.join('.'), key, 'refresh:alice'), /cannot be read/);
});

test('OAuth requires one-use browser-bound state and PKCE; status never exposes credentials', async (t) => {
  const f = await fixture(t),
    start = await f.drive.begin(f.actors.student),
    url = new URL(start.authorizationUrl),
    state = url.searchParams.get('state');
  assert.deepEqual(url.searchParams.get('scope')?.split(' '), ['openid', 'email', DRIVE_SCOPE]);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  await assert.rejects(
    f.drive.callback({ state, code: 'provider-code' }, 'zabsync_drive_binding=wrong'),
    /expired|different browser/,
  );
  assert.equal(f.google.exchanges, 0);
  await f.drive.callback(
    { state, code: 'provider-code' },
    `zabsync_drive_binding=${start.browserBinding}`,
  );
  assert.equal(
    createHash('sha256').update(f.google.lastVerifier).digest('base64url'),
    url.searchParams.get('code_challenge'),
  );
  await assert.rejects(
    f.drive.callback(
      { state, code: 'provider-code' },
      `zabsync_drive_binding=${start.browserBinding}`,
    ),
    /expired/,
  );
  assert.equal(f.google.exchanges, 1);
  const row = await first(f.db, 'SELECT * FROM drive_connections WHERE user_id=?', ['student']);
  assert.ok(String(row?.refresh_token_cipher).startsWith('v1.'));
  assert.equal(JSON.stringify(row).includes('test-refresh-'), false);
  const status = await f.drive.status('student');
  assert.equal(status.connected, true);
  assert.equal(status.email, 'storage-owner@gmail.com');
  assert.equal(JSON.stringify(status).includes('test-access'), false);
  assert.equal(
    Object.keys(status).some((k) => /token|cipher|clientId|secret/i.test(k)),
    false,
  );
});

test('expired OAuth, suspended accounts, and disconnect during consent cannot attach a Drive', async (t) => {
  const f = await fixture(t);
  let start = await f.drive.begin(f.actors.student),
    state = new URL(start.authorizationUrl).searchParams.get('state');
  f.advance(11 * 60_000);
  await assert.rejects(
    f.drive.callback(
      { state, code: 'provider-code' },
      `zabsync_drive_binding=${start.browserBinding}`,
    ),
    /expired/,
  );
  start = await f.drive.begin(f.actors.student);
  state = new URL(start.authorizationUrl).searchParams.get('state');
  await f.drive.disconnect(f.actors.student);
  await assert.rejects(
    f.drive.callback(
      { state, code: 'provider-code' },
      `zabsync_drive_binding=${start.browserBinding}`,
    ),
    /expired/,
  );
  await f.db.execute("UPDATE users SET status='suspended' WHERE id='student'");
  await assert.rejects(f.drive.begin(f.actors.student), /eligible/);
  assert.equal(f.google.exchanges, 0);
});

test('hybrid storage routes documents to uploader Drive, avatars and legacy keys to base, with private revision downloads', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const file = await f.file();
  await f.hybrid.putFile(file.key, file.path, 'application/pdf', {
    userId: 'student',
    filename: 'Lecture notes.pdf',
  });
  assert.equal(f.google.uploads, 1);
  await assert.rejects(f.base.open(file.key), /unavailable/);
  const opened = await f.hybrid.open(file.key),
    chunks: Buffer[] = [];
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), file.content);
  assert.equal(opened.contentType, 'application/pdf');
  assert.equal(
    f.google.refreshes,
    1,
    'short-lived access token is reused only behind current connection checks',
  );
  const avatarKey = `avatars/${randomUUID()}.webp`;
  await f.hybrid.putFile(avatarKey, file.path, 'image/webp');
  const legacy = `resources/${randomUUID()}.pdf`;
  await f.base.putFile(legacy, file.path, 'application/pdf');
  assert.equal((await f.hybrid.open(legacy)).size, file.content.length);
  const usage = await f.drive.usage();
  assert.equal(usage.driveFiles, 1);
  assert.equal(usage.baseUsedBytes, file.content.length);
  await f.hybrid.delete(file.key);
  assert.equal(f.google.files.size, 0);
  assert.equal((await f.drive.status('student')).ownedFiles, 0);
  await f.hybrid.delete(avatarKey);
  assert.equal((await f.drive.usage()).baseUsedBytes, 0);
});

test('Drive failures never silently spend base storage; untrusted session locations never receive tokens or files', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const file = await f.file();
  f.google.failUploads();
  await assert.rejects(
    f.hybrid.putFile(file.key, file.path, 'application/pdf', { userId: 'student' }),
    /no space/,
  );
  await assert.rejects(f.base.open(file.key), /unavailable/);
  assert.equal((await f.drive.usage()).baseUsedBytes, 0);
  const f2 = await fixture(t);
  await f2.connect();
  const file2 = await f2.file();
  f2.google.evilSession();
  await assert.rejects(
    f2.hybrid.putFile(file2.key, file2.path, 'application/pdf', { userId: 'student' }),
    /invalid upload session/,
  );
  assert.equal(f2.google.uploads, 0);
  assert.equal((await f2.drive.usage()).baseUsedBytes, 0);
});

test('Drive changes, disabled downloads, revocation, and account switching fail without leaking a public URL', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const file = await f.file();
  await f.hybrid.putFile(file.key, file.path, 'application/pdf', { userId: 'student' });
  const stored = [...f.google.files.values()][0]!;
  stored.metadata.sha256Checksum = 'a'.repeat(64);
  await assert.rejects(f.hybrid.open(file.key), /changed directly/);
  stored.metadata.sha256Checksum = createHash('sha256').update(file.content).digest('hex');
  f.google.account('another_google_owner', 'other-storage@gmail.com');
  await assert.rejects(f.connect(), /same Google account/);
  f.google.account('google_owner_one', 'storage-owner@gmail.com');
  f.google.forbidDownloads();
  await assert.rejects(f.hybrid.open(file.key), /downloads are disabled/);
  const disconnected = await f.drive.disconnect(f.actors.student);
  assert.equal(disconnected.retainedFiles, 1);
  assert.equal(disconnected.providerRevoked, true);
  assert.equal(f.google.files.size, 1, 'disconnect retains original user-owned Drive files');
  assert.equal(
    (
      await first(
        f.db,
        "SELECT refresh_token_cipher FROM drive_connections WHERE user_id='student'",
      )
    )?.refresh_token_cipher,
    null,
  );
  await assert.rejects(f.hybrid.open(file.key), /Connect or reconnect/);
});

test('expired Drive grant becomes reconnect state and explicit base destination does not require a Drive', async (t) => {
  const f = await fixture(t);
  await f.connect();
  f.google.expireConsent();
  const file = await f.file();
  await assert.rejects(
    f.hybrid.putFile(file.key, file.path, 'application/pdf', { userId: 'student' }),
    /reconnect/,
  );
  assert.equal((await f.drive.status('student')).status, 'reconnect');
  const f2 = await fixture(t, { RESOURCE_STORAGE: 'base' });
  const file2 = await f2.file();
  await f2.hybrid.putFile(file2.key, file2.path, 'application/pdf', { userId: 'student' });
  assert.equal(f2.google.exchanges, 0);
  assert.equal(f2.google.uploads, 0);
  assert.equal((await f2.drive.usage()).baseUsedBytes, file2.content.length);
});

test('durable base reservations prevent concurrent uploads from exceeding the shared budget', async (t) => {
  const f = await fixture(t, { RESOURCE_STORAGE: 'base', BASE_STORAGE_LIMIT_MIB: '1' });
  const file = await f.file('large.pdf');
  await writeFile(file.path, Buffer.alloc(700_000, 1));
  const keys = [`resources/${randomUUID()}.pdf`, `resources/${randomUUID()}.pdf`];
  const results = await Promise.allSettled(
    keys.map((key) => f.hybrid.putFile(key, file.path, 'application/pdf')),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await f.drive.usage()).baseUsedBytes, 700_000);
  const orphan = await f.drive.cleanupOrphans(f.base);
  assert.equal(orphan.removed, 0, 'fresh in-progress objects are not cleanup candidates');
  f.advance(61 * 60_000);
  assert.equal((await f.drive.cleanupOrphans(f.base)).removed, 1);
  assert.equal((await f.drive.usage()).baseUsedBytes, 0);
});

test('Drive HTTP entry requires authenticated users and owner-only usage/cleanup; callback returns only a fixed status', async (t) => {
  const f = await fixture(t),
    app = Fastify();
  t.after(() => app.close());
  app.setErrorHandler((error, _request, reply) =>
    error instanceof ApiError
      ? reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })
      : reply.code(400).send({ error: { code: 'invalid_request' } }),
  );
  const authenticate = async (request: { headers: { authorization?: string } }) => {
    const role = request.headers.authorization?.replace('Bearer ', '') as keyof typeof f.actors;
    if (!f.actors[role]) throw new ApiError(401, 'sign_in_required', 'Sign in first.');
    return f.actors[role];
  };
  registerDriveRoutes(
    app,
    { db: f.db, config: f.appConfig, now: () => new Date(date), authenticate },
    f.drive,
    f.base,
  );
  await app.ready();
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/drive/connect', payload: {} })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/admin/storage/usage',
        headers: { authorization: 'Bearer student' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/storage/cleanup',
        headers: { authorization: 'Bearer student' },
        payload: { confirm: true },
      })
    ).statusCode,
    403,
  );
  const begin = await app.inject({
    method: 'POST',
    url: '/api/drive/connect',
    headers: { authorization: 'Bearer student' },
    payload: {},
  });
  assert.equal(begin.statusCode, 200);
  assert.match(String(begin.headers['set-cookie']), /HttpOnly; SameSite=Lax/);
  assert.equal(Object.keys(begin.json()).join(','), 'authorizationUrl');
  const state = new URL(begin.json().authorizationUrl).searchParams.get('state');
  const callback = await app.inject({
    method: 'GET',
    url: `/oauth/google-drive/callback?state=${state}&code=private-code`,
    headers: { cookie: String(begin.headers['set-cookie']).split(';')[0]! },
  });
  assert.equal(callback.statusCode, 303);
  assert.equal(callback.headers.location, 'http://localhost:5173/account?drive=connected');
  assert.equal(String(callback.headers.location).includes('private-code'), false);
  assert.equal(callback.headers['cache-control'], 'no-store');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/drive/disconnect',
        headers: { authorization: 'Bearer student' },
        payload: {},
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/admin/storage/usage',
        headers: { authorization: 'Bearer owner' },
      })
    ).statusCode,
    200,
  );
});

test('Google transport injection cannot be activated outside explicit Firebase tests', async (t) => {
  const f = await fixture(t);
  assert.throws(
    () =>
      createDriveService({
        db: f.db,
        config: f.config,
        appConfig: makeTestConfig(),
        fetchForTests: f.google.fetch,
      }),
    /Firebase-mode tests/,
  );
  assert.throws(
    () =>
      createDriveService({
        db: f.db,
        config: f.config,
        appConfig: { ...f.appConfig, nodeEnv: 'production' },
        fetchForTests: f.google.fetch,
      }),
    /Firebase-mode tests/,
  );
});

test('a delayed unauthorized response cannot disable a newer successful Drive reconnect', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const file = await f.file();
  await f.hybrid.putFile(file.key, file.path, 'application/pdf', { userId: 'student' });
  const pending = f.google.deferNextUnauthorized(),
    reading = f.hybrid.open(file.key);
  const rejected = assert.rejects(reading, /reconnect/);
  await pending.started;
  await f.connect();
  pending.release();
  await rejected;
  assert.equal((await f.drive.status('student')).connected, true);
  const reopened = await f.hybrid.open(file.key),
    chunks: Buffer[] = [];
  for await (const chunk of reopened.stream) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), file.content);
});

test('the public OAuth callback keeps its own rate limit when ordinary web routes are allowlisted', async (t) => {
  const f = await fixture(t),
    app = Fastify();
  t.after(() => app.close());
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (request) => !request.url.startsWith('/api/'),
  });
  registerDriveRoutes(
    app,
    {
      db: f.db,
      config: f.appConfig,
      now: () => new Date(date),
      authenticate: async () => f.actors.student,
    },
    f.drive,
    f.base,
  );
  await app.ready();
  for (let index = 0; index < 20; index++)
    assert.equal((await app.inject('/oauth/google-drive/callback')).statusCode, 303);
  assert.equal((await app.inject('/oauth/google-drive/callback')).statusCode, 429);
  assert.equal(f.google.exchanges, 0, 'malformed callbacks never reach the token provider');
});
