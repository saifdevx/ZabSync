import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { makeTestConfig } from '../server/config.js';
import { first, openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const base = `/api/subjects/${DEMO_SUBJECT_IDS.os}/chat`;
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.chat-'));
  const databaseUrl = pathToFileURL(join(directory, 'db.sqlite')).href,
    db = await openDatabase(databaseUrl);
  let instant = new Date('2026-10-12T06:00:00.000Z');
  const app = await createApp({ db, config: makeTestConfig({ databaseUrl }), now: () => instant });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin'),
    master = await demoToken(app, 'master');
  const post = (
    token: string,
    body: Record<string, unknown> = {
      body: 'Which lectures are in the quiz?',
      clientKey: randomUUID(),
    },
  ) =>
    app.inject({ method: 'POST', url: `${base}/messages`, headers: bearer(token), payload: body });
  const open = async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `${base}/settings`,
      headers: bearer(admin),
      payload: { mode: 'members', version: 0 },
    });
    expectSuccess(r);
  };
  return {
    app,
    db,
    student,
    admin,
    master,
    post,
    open,
    advance: (ms: number) => {
      instant = new Date(instant.getTime() + ms);
    },
    now: () => instant,
  };
}

test('subject chat defaults to admin posting and never allows members to select their own powers', async (t) => {
  const f = await fixture(t);
  const initial = await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) });
  expectSuccess(initial);
  assert.equal(initial.json().settings.mode, 'admins');
  assert.equal(initial.json().settings.canPost, false);
  expectForbidden(await f.post(f.student));
  expectForbidden(
    await f.app.inject({
      method: 'PATCH',
      url: `${base}/settings`,
      headers: bearer(f.student),
      payload: { mode: 'members', version: 0 },
    }),
  );
  expectForbidden(
    await f.app.inject({
      method: 'GET',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.other}/chat`,
      headers: bearer(f.student),
    }),
  );
  expectSuccess(await f.post(f.admin));
  await f.open();
  expectSuccess(await f.post(f.student));
  await f.db.execute({
    sql: "UPDATE subject_enrollments SET status='removed' WHERE subject_id=? AND user_id=?",
    args: [DEMO_SUBJECT_IDS.os, DEMO_USERS.student.id],
  });
  expectForbidden(await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) }));
  expectForbidden(await f.post(f.student));
  expectSuccess(await f.app.inject({ method: 'GET', url: base, headers: bearer(f.master) }));
});

test('chat sends are idempotent and edits/deletes are scoped, versioned, and redact removed text', async (t) => {
  const f = await fixture(t);
  await f.open();
  const form = { body: 'Question with a stable retry key', clientKey: randomUUID() },
    created = await f.post(f.student, form);
  assert.equal(created.statusCode, 201);
  const repeat = await f.post(f.student, form);
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json().id, created.json().id);
  assert.equal((await f.post(f.student, { ...form, body: 'A different payload' })).statusCode, 409);
  const path = `${base}/messages/${created.json().id}`;
  expectForbidden(
    await f.app.inject({
      method: 'PATCH',
      url: path,
      headers: bearer(f.admin),
      payload: { body: 'Rewritten by another person', version: 1 },
    }),
  );
  expectSuccess(
    await f.app.inject({
      method: 'PATCH',
      url: path,
      headers: bearer(f.student),
      payload: { body: 'My clarified question', version: 1 },
    }),
  );
  assert.equal(
    (
      await f.app.inject({
        method: 'PATCH',
        url: path,
        headers: bearer(f.student),
        payload: { body: 'Outdated edit', version: 1 },
      })
    ).statusCode,
    409,
  );
  expectSuccess(
    await f.app.inject({
      method: 'DELETE',
      url: path,
      headers: bearer(f.admin),
      payload: { version: 2 },
    }),
  );
  const row = await first(f.db, 'SELECT * FROM subject_chat_messages WHERE id=?', [
    created.json().id,
  ]);
  assert.equal(row?.body, '');
  assert.equal(row?.deleted_by, DEMO_USERS.admin.id);
  const list = (
    await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) })
  ).json();
  assert.equal(list.messages[0].deleted, true);
  assert.equal(list.messages[0].body, '');
});

test('resource references stay within the enrolled subject and message payloads are bounded', async (t) => {
  const f = await fixture(t);
  await f.open();
  const resourceId = randomUUID();
  await f.db.execute({
    sql: `INSERT INTO resources(id,class_id,subject_id,title,filename,mime_type,size_bytes,storage_key,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      resourceId,
      DEMO_CLASS_ID,
      DEMO_SUBJECT_IDS.db,
      'Other subject notes',
      'notes.pdf',
      'application/pdf',
      100,
      `test/${resourceId}`,
      DEMO_USERS.admin.id,
      f.now().toISOString(),
      f.now().toISOString(),
    ],
  });
  expectForbidden(
    await f.post(f.student, {
      body: 'Cross subject resource',
      clientKey: randomUUID(),
      resourceId,
    }),
  );
  await f.db.execute({
    sql: 'UPDATE resources SET subject_id=? WHERE id=?',
    args: [DEMO_SUBJECT_IDS.os, resourceId],
  });
  expectSuccess(
    await f.post(f.student, {
      body: 'Question about this resource',
      clientKey: randomUUID(),
      resourceId,
    }),
  );
  let list = (await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) })).json();
  assert.equal(list.messages[0].resourceId, resourceId);
  await f.db.execute({
    sql: 'UPDATE resources SET deleted_at=? WHERE id=?',
    args: [f.now().toISOString(), resourceId],
  });
  list = (await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) })).json();
  assert.equal(list.messages[0].resourceId, null);
  assert.equal(list.messages[0].resourceUnavailable, true);
  for (const body of ['', 'x'.repeat(2001), 'bad\u0000text'])
    assert.equal((await f.post(f.student, { body, clientKey: randomUUID() })).statusCode, 400);
  assert.equal(
    (
      await f.post(f.student, {
        body: 'hello',
        clientKey: randomUUID(),
        userId: DEMO_USERS.master.id,
      })
    ).statusCode,
    400,
  );
});

test('chat cursor handles equal timestamps, and persistent write limits cannot be bypassed with new request keys', async (t) => {
  const f = await fixture(t);
  await f.open();
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const response = await f.post(f.student, { body: `Message ${i}`, clientKey: randomUUID() });
    expectSuccess(response);
    ids.push(response.json().id);
  }
  assert.equal((await f.post(f.student)).statusCode, 429);
  const found: string[] = [];
  let before: string | null = null;
  do {
    const response = await f.app.inject({
      method: 'GET',
      url: `${base}?limit=5${before ? `&before=${before}` : ''}`,
      headers: bearer(f.student),
    });
    expectSuccess(response);
    const page = response.json();
    found.push(...page.messages.map((m: { id: string }) => m.id));
    before = page.nextCursor;
  } while (before);
  assert.deepEqual([...new Set(found)].sort(), ids.sort());
  assert.equal(found.length, 12);
  assert.equal(
    (
      await f.app.inject({
        method: 'GET',
        url: `${base}?before=not-a-cursor`,
        headers: bearer(f.student),
      })
    ).statusCode,
    400,
  );
  f.advance(60_000);
  expectSuccess(await f.post(f.student));
});

test('reports, timed mutes and moderation are private to class admins and enforced at write time', async (t) => {
  const f = await fixture(t);
  await f.open();
  const made = await f.post(f.admin),
    id = made.json().id;
  for (let i = 0; i < 2; i++)
    expectSuccess(
      await f.app.inject({
        method: 'POST',
        url: `${base}/messages/${id}/report`,
        headers: bearer(f.student),
        payload: { reason: 'Please check this message.' },
      }),
    );
  assert.equal((await first(f.db, 'SELECT COUNT(*) AS n FROM subject_chat_reports'))?.n, 1);
  expectForbidden(
    await f.app.inject({ method: 'GET', url: `${base}/reports`, headers: bearer(f.student) }),
  );
  assert.equal(
    (await f.app.inject({ method: 'GET', url: `${base}/reports`, headers: bearer(f.admin) })).json()
      .reports.length,
    1,
  );
  expectSuccess(
    await f.app.inject({
      method: 'POST',
      url: `${base}/mutes/${DEMO_USERS.student.id}`,
      headers: bearer(f.admin),
      payload: { minutes: 60, reason: 'Repeated off-topic messages' },
    }),
  );
  expectForbidden(await f.post(f.student));
  const settings = (
    await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) })
  ).json().settings;
  assert.equal(settings.canPost, false);
  assert.ok(settings.mutedUntil);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: `${base}/mutes/${DEMO_USERS.admin.id}`,
        headers: bearer(f.master),
        payload: { minutes: 60 },
      })
    ).statusCode,
    400,
  );
  f.advance(61 * 60_000);
  expectSuccess(await f.post(f.student));
  expectSuccess(
    await f.app.inject({
      method: 'POST',
      url: `${base}/messages/${id}/resolve-reports`,
      headers: bearer(f.admin),
    }),
  );
  assert.equal(
    (await f.app.inject({ method: 'GET', url: `${base}/reports`, headers: bearer(f.admin) })).json()
      .reports.length,
    0,
  );
});

test('chat respects owner feature controls and maintenance, including a stale page that attempts to post', async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.db.execute('UPDATE site_settings SET maintenance_enabled=1 WHERE id=1');
  assert.equal((await f.post(f.student)).statusCode, 503);
  expectSuccess(await f.post(f.master));
  await f.db.execute(
    "UPDATE site_settings SET maintenance_enabled=0,features_json=json_set(features_json,'$.chat',json('false')) WHERE id=1",
  );
  expectForbidden(await f.app.inject({ method: 'GET', url: base, headers: bearer(f.student) }));
  expectForbidden(await f.post(f.master));
});
