import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { makeTestConfig } from '../server/config.js';
import { first, openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { loadReminderOptions, REMINDER_LEASE_MS, runReminderCycle } from '../server/reminders.js';
import { bearer, demoToken, expectForbidden, expectSuccess } from './helpers.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.reminders-')),
    databaseUrl = pathToFileURL(join(directory, 'db.sqlite')).href,
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
  const deadline = async (
    title = 'Test reminder',
    subjectId: string | null = DEMO_SUBJECT_IDS.os,
  ) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/classes/${DEMO_CLASS_ID}/deadlines`,
      headers: bearer(admin),
      payload: {
        kind: 'assignment',
        title,
        description: 'Fixture only',
        dueDate: '2026-10-12',
        dueTime: '12:30',
        subjectId,
      },
    });
    expectSuccess(response);
    return response.json().deadline.id as string;
  };
  const enable = (id: string, offsetMinutes = 60) =>
    app.inject({
      method: 'POST',
      url: `/api/deadlines/${id}/reminder`,
      headers: bearer(student),
      payload: { enabled: true, offsetMinutes },
    });
  const cycle = (extra: Omit<Parameters<typeof runReminderCycle>[1], 'now'> = {}) =>
    runReminderCycle(db, { now: () => instant, ...extra });
  return {
    app,
    db,
    databaseUrl,
    student,
    admin,
    master,
    deadline,
    enable,
    cycle,
    now: () => instant,
    advance: (ms: number) => {
      instant = new Date(instant.getTime() + ms);
    },
  };
}
async function addDevice(f: Awaited<ReturnType<typeof fixture>>) {
  const id = randomUUID(),
    installationId = 'c123456789012345678901';
  await f.db.execute({
    sql: 'INSERT INTO reminder_push_subscriptions(id,user_id,destination_hash,installation_id,device_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    args: [
      id,
      DEMO_USERS.student.id,
      createHash('sha256').update(installationId).digest('hex'),
      installationId,
      'Test browser',
      f.now().toISOString(),
      f.now().toISOString(),
    ],
  });
  return id;
}

test('deadline reminders are opt-in, durable, and deliver only one inbox item across repeated cycles', async (t) => {
  const f = await fixture(t),
    id = await f.deadline();
  assert.equal((await f.cycle()).inboxDelivered, 0);
  expectSuccess(await f.enable(id));
  assert.equal((await f.cycle()).inboxDelivered, 0);
  f.advance(31 * 60_000);
  assert.equal((await f.cycle()).inboxDelivered, 1);
  assert.equal((await f.cycle()).inboxDelivered, 0);
  const inbox = await f.app.inject({
    method: 'GET',
    url: '/api/reminders',
    headers: bearer(f.student),
  });
  expectSuccess(inbox);
  assert.equal(inbox.json().items.length, 1);
  assert.equal(inbox.json().items[0].deadlineId, id);
  const mark = await f.app.inject({
    method: 'PATCH',
    url: `/api/reminders/${inbox.json().items[0].id}/read`,
    headers: bearer(f.student),
    payload: { read: true },
  });
  expectSuccess(mark);
  assert.ok(
    (
      await f.app.inject({ method: 'GET', url: '/api/reminders', headers: bearer(f.student) })
    ).json().items[0].readAt,
  );
  const secondConnection = await openDatabase(f.databaseUrl);
  try {
    assert.equal((await runReminderCycle(secondConnection, { now: f.now })).inboxDelivered, 0);
  } finally {
    secondConnection.close();
  }
  // The idempotency guarantee lives in persisted unique rows, not a process-local timer/counter.
  assert.equal((await first(f.db, 'SELECT COUNT(*) AS n FROM reminder_inbox'))?.n, 1);
});

test('deadline revision changes cancel the old job and schedule against the current due time', async (t) => {
  const f = await fixture(t),
    id = await f.deadline();
  expectSuccess(await f.enable(id));
  await f.db.execute({
    sql: 'UPDATE deadlines SET version=version+1,due_time=?,due_at=? WHERE id=?',
    args: ['13:30', '2026-10-12T08:30:00.000Z', id],
  });
  f.advance(31 * 60_000);
  const firstCycle = await f.cycle();
  assert.equal(firstCycle.inboxDelivered, 0);
  assert.equal(firstCycle.cancelled, 1);
  f.advance(60 * 60_000);
  assert.equal((await f.cycle()).inboxDelivered, 1);
  const row = await first(f.db, 'SELECT deadline_version FROM reminder_inbox WHERE deadline_id=?', [
    id,
  ]);
  assert.equal(row?.deadline_version, 2);
});

test('completion, deletion and subject removal invalidate pending reminders and hide stale inbox contents', async (t) => {
  const f = await fixture(t),
    completeId = await f.deadline('Completed'),
    deleteId = await f.deadline('Deleted'),
    subjectId = await f.deadline('Subject revoked');
  for (const id of [completeId, deleteId, subjectId]) expectSuccess(await f.enable(id));
  expectSuccess(
    await f.app.inject({
      method: 'PATCH',
      url: `/api/deadlines/${completeId}/completion`,
      headers: bearer(f.student),
      payload: { completed: true, version: 1 },
    }),
  );
  await f.db.execute({
    sql: 'UPDATE deadlines SET deleted_at=? WHERE id=?',
    args: [f.now().toISOString(), deleteId],
  });
  await f.db.execute({
    sql: "UPDATE subject_enrollments SET status='removed' WHERE subject_id=? AND user_id=?",
    args: [DEMO_SUBJECT_IDS.os, DEMO_USERS.student.id],
  });
  f.advance(31 * 60_000);
  const result = await f.cycle();
  assert.equal(result.inboxDelivered, 0);
  assert.equal(result.cancelled, 3);
  expectForbidden(await f.enable(subjectId));
  assert.equal(
    (
      await f.app.inject({ method: 'GET', url: '/api/reminders', headers: bearer(f.student) })
    ).json().items.length,
    0,
  );
});

test('membership removal and account suspension also prevent class-wide reminders', async (t) => {
  const f = await fixture(t),
    id = await f.deadline('Class-wide notice', null);
  expectSuccess(await f.enable(id));
  await f.db.execute({
    sql: "UPDATE memberships SET status='removed' WHERE user_id=? AND class_id=?",
    args: [DEMO_USERS.student.id, DEMO_CLASS_ID],
  });
  f.advance(31 * 60_000);
  assert.equal((await f.cycle()).inboxDelivered, 0);
  assert.equal(
    (await first(f.db, 'SELECT status FROM reminder_jobs WHERE deadline_id=?', [id]))?.status,
    'cancelled',
  );
  await f.db.execute({
    sql: "UPDATE memberships SET status='active' WHERE user_id=? AND class_id=?",
    args: [DEMO_USERS.student.id, DEMO_CLASS_ID],
  });
  expectSuccess(await f.enable(id));
  await f.db.execute({
    sql: "UPDATE users SET status='suspended' WHERE id=?",
    args: [DEMO_USERS.student.id],
  });
  assert.equal((await f.cycle()).inboxDelivered, 0);
});

test('an unexpired lease is not stolen; an expired worker lease is recovered after restart', async (t) => {
  const f = await fixture(t),
    id = await f.deadline();
  expectSuccess(await f.enable(id));
  f.advance(31 * 60_000);
  await f.db.execute({
    sql: "UPDATE reminder_jobs SET status='leased',lease_token='old-process',lease_until=?,attempts=1 WHERE deadline_id=?",
    args: [new Date(f.now().getTime() + REMINDER_LEASE_MS).toISOString(), id],
  });
  assert.equal((await f.cycle()).inboxDelivered, 0);
  f.advance(REMINDER_LEASE_MS + 1);
  assert.equal((await f.cycle()).inboxDelivered, 1);
  assert.equal((await first(f.db, 'SELECT COUNT(*) AS n FROM reminder_inbox'))?.n, 1);
});

test('optional push retries transient failures, does not duplicate inbox records, and disables invalid devices', async (t) => {
  const f = await fixture(t),
    id = await f.deadline(),
    deviceId = await addDevice(f);
  expectSuccess(await f.enable(id));
  f.advance(31 * 60_000);
  let calls = 0;
  const pushSender = {
    send: async (_fid: string, notificationId: string) => {
      assert.match(notificationId, /^[0-9a-f-]{36}$/);
      calls++;
      if (calls === 1)
        throw Object.assign(new Error('Do not log this private provider message'), {
          code: 'messaging/server-unavailable',
        });
    },
  };
  let result = await f.cycle({ pushSender });
  assert.equal(result.inboxDelivered, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.pushSent, 0);
  result = await f.cycle({ pushSender });
  assert.equal(calls, 1);
  f.advance(61_000);
  result = await f.cycle({ pushSender });
  assert.equal(result.pushSent, 1);
  assert.equal(calls, 2);
  assert.equal((await first(f.db, 'SELECT COUNT(*) AS n FROM reminder_inbox'))?.n, 1);
  const second = await f.deadline('Invalid device example');
  expectSuccess(await f.enable(second));
  const invalid = {
    send: async () => {
      throw Object.assign(new Error('Invalid device'), {
        code: 'messaging/registration-token-not-registered',
      });
    },
  };
  result = await f.cycle({ pushSender: invalid });
  assert.equal(result.errors, 1);
  assert.ok(
    (
      await first(f.db, 'SELECT disabled_at FROM reminder_push_subscriptions WHERE id=?', [
        deviceId,
      ])
    )?.disabled_at,
  );
});

test('queued push is cancelled after completion or opt-out, and inbox details are account scoped', async (t) => {
  const f = await fixture(t),
    id = await f.deadline();
  await addDevice(f);
  expectSuccess(await f.enable(id));
  f.advance(31 * 60_000);
  const failed = {
    send: async () => {
      throw Object.assign(new Error('temporary'), { code: 'messaging/server-unavailable' });
    },
  };
  assert.equal((await f.cycle({ pushSender: failed })).inboxDelivered, 1);
  const mine = (
    await f.app.inject({ method: 'GET', url: '/api/reminders', headers: bearer(f.student) })
  ).json().items[0];
  expectForbidden(
    await f.app.inject({
      method: 'PATCH',
      url: `/api/reminders/${mine.id}/read`,
      headers: bearer(f.admin),
      payload: { read: true },
    }),
  );
  expectSuccess(
    await f.app.inject({
      method: 'POST',
      url: `/api/deadlines/${id}/reminder`,
      headers: bearer(f.student),
      payload: { enabled: false, offsetMinutes: 60 },
    }),
  );
  f.advance(61_000);
  let sends = 0;
  const result = await f.cycle({
    pushSender: {
      send: async () => {
        sends++;
      },
    },
  });
  assert.equal(sends, 0);
  assert.equal(result.cancelled, 1);
  assert.equal(
    (
      await f.app.inject({ method: 'GET', url: '/api/reminders', headers: bearer(f.student) })
    ).json().items.length,
    0,
  );
});

test('maintenance pauses job delivery without spending retries; provider setup is explicit and safe by default', async (t) => {
  const f = await fixture(t),
    id = await f.deadline();
  expectSuccess(await f.enable(id));
  f.advance(31 * 60_000);
  await f.db.execute('UPDATE site_settings SET maintenance_enabled=1 WHERE id=1');
  assert.equal((await f.cycle()).inboxDelivered, 0);
  assert.equal(
    (await first(f.db, 'SELECT attempts FROM reminder_jobs WHERE deadline_id=?', [id]))?.attempts,
    0,
  );
  await f.db.execute('UPDATE site_settings SET maintenance_enabled=0 WHERE id=1');
  assert.equal((await f.cycle()).inboxDelivered, 1);
  const config = await f.app.inject({
    method: 'GET',
    url: '/api/reminders/config',
    headers: bearer(f.student),
  });
  assert.equal(config.json().pushAvailable, false);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/reminders/push-subscriptions',
        headers: bearer(f.student),
        payload: { installationId: 'c123456789012345678901', deviceLabel: 'Test' },
      })
    ).statusCode,
    503,
  );
  assert.equal(loadReminderOptions({}, makeTestConfig()).pushEnabled, false);
  assert.throws(
    () => loadReminderOptions({ REMINDERS_PUSH_ENABLED: 'true' }, makeTestConfig()),
    /require Firebase/,
  );
  expectForbidden(
    await f.app.inject({
      method: 'POST',
      url: `/api/deadlines/${id}/reminder`,
      headers: bearer(f.master),
      payload: { enabled: true, offsetMinutes: 60 },
    }),
  );
});
