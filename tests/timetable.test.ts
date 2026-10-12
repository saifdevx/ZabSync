import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import {
  addCalendarDays,
  isCalendarDate,
  karachiDate,
  localDateTimeISO,
  mondayFor,
  resolveSchedule,
} from '../server/schedule.js';
import { DEMO_TIMETABLE_IDS, seedTimetableDemo } from '../server/timetable.js';
import {
  bearer,
  createTestApp,
  demoToken,
  expectClientRejection,
  expectForbidden,
  expectSuccess,
  type TestApp,
} from './helpers.js';

const fixedNow = new Date('2026-10-11T19:30:00.000Z'); // Monday00:30 in Karachi, still Sunday in UTC.
const monday = '2026-10-12';
const weekly = {
  title: 'Networks practice',
  weekday: 4,
  startTime: '13:00',
  endTime: '14:00',
  teacher: 'Example teacher',
  room: 'Example room',
  notes: 'Fictional test schedule.',
};
const deadlineForm = {
  kind: 'assignment',
  title: 'Test assignment',
  description: 'A test deadline, not a real submission.',
  dueDate: monday,
  dueTime: '09:00',
};
const tableUrl = `/api/classes/${DEMO_CLASS_ID}/timetable`;
const exceptionsUrl = `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`;
const deadlinesUrl = `/api/classes/${DEMO_CLASS_ID}/deadlines`;

async function planningApp(t: TestContext) {
  return createTestApp(t, { now: () => fixedNow });
}
async function controlledApp(t: TestContext) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.planning-'));
  const databaseUrl = pathToFileURL(join(directory, 'data.sqlite')).href;
  const db = await openDatabase(databaseUrl);
  const app = await createApp({ db, config: makeTestConfig({ databaseUrl }), now: () => fixedNow });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { app, db };
}
async function createEntry(app: TestApp, token: string, values: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: tableUrl,
    headers: bearer(token),
    payload: { ...weekly, ...values },
  });
  expectSuccess(response);
  return response.json().entry;
}
async function createDeadline(app: TestApp, token: string, values: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: deadlinesUrl,
    headers: bearer(token),
    payload: { ...deadlineForm, ...values },
  });
  expectSuccess(response);
  return response.json().deadline;
}
async function createException(app: TestApp, token: string, values: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: exceptionsUrl,
    headers: bearer(token),
    payload: values,
  });
  expectSuccess(response);
  return response.json().exception;
}

test('calendar and shared resolver use Karachi local dates independently of server timezone', () => {
  assert.equal(karachiDate(fixedNow), monday);
  assert.equal(mondayFor('2026-10-18'), monday);
  assert.equal(localDateTimeISO(monday, '00:15'), '2026-10-11T19:15:00.000Z');
  assert.equal(localDateTimeISO(monday, '09:00'), '2026-10-12T04:00:00.000Z');
  assert.equal(isCalendarDate('2028-02-29'), true);
  for (const invalid of [
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-04-31',
    '26-10-12',
    '2026-1-2',
    '2026-10-12T00:00:00Z',
  ])
    assert.equal(isCalendarDate(invalid), false, invalid);
  assert.equal(addCalendarDays('2028-02-28', 1), '2028-02-29');
});

test('fresh demo planning is clearly fictional, uses the Karachi seed week, and does not shift on restart', async (t) => {
  const { app, db } = await controlledApp(t),
    student = await demoToken(app, 'student');
  const timetable = await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) });
  expectSuccess(timetable);
  assert.deepEqual(
    timetable
      .json()
      .entries.map((entry: { title: string; weekday: number }) => [entry.title, entry.weekday]),
    [
      ['Demo: Operating Systems', 1],
      ['Demo: Database Lab', 3],
    ],
  );
  const extra = timetable
    .json()
    .exceptions.find((entry: { id: string }) => entry.id === DEMO_TIMETABLE_IDS.extra);
  assert.equal(extra.date, '2026-10-16');
  assert.match(extra.notes, /fictional/i);
  const deadlines = await app.inject({
    method: 'GET',
    url: deadlinesUrl,
    headers: bearer(student),
  });
  expectSuccess(deadlines);
  assert.deepEqual(
    deadlines
      .json()
      .deadlines.map((item: { kind: string; dueDate: string }) => [item.kind, item.dueDate]),
    [
      ['quiz', '2026-10-14'],
      ['assignment', '2026-10-17'],
    ],
  );
  for (const deadline of deadlines.json().deadlines) {
    assert.match(deadline.title, /^Demo:/);
    assert.match(deadline.description, /fictional/i);
  }
  await seedTimetableDemo(db, new Date('2026-11-16T00:00:00.000Z'));
  const unchanged = await app.inject({
    method: 'GET',
    url: deadlinesUrl,
    headers: bearer(student),
  });
  assert.deepEqual(unchanged.json().deadlines, deadlines.json().deadlines);
});

test('weekly timetable CRUD is class-admin scoped, versioned, and enriched with active subject names', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin'),
    student = await demoToken(app, 'student'),
    master = await demoToken(app, 'master');
  expectForbidden(
    await app.inject({ method: 'POST', url: tableUrl, headers: bearer(student), payload: weekly }),
  );
  expectForbidden(
    await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_OTHER_CLASS_ID}/timetable`,
      headers: bearer(admin),
    }),
  );
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: `/api/classes/${DEMO_OTHER_CLASS_ID}/timetable`,
      headers: bearer(admin),
      payload: weekly,
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/classes/${DEMO_OTHER_CLASS_ID}/timetable`,
      headers: bearer(master),
      payload: weekly,
    }),
  );
  const entry = await createEntry(app, admin, { subjectId: DEMO_SUBJECT_IDS.os });
  assert.equal(entry.version, 1);
  assert.equal(entry.subjectName, 'OS Lab');
  const studentView = await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) });
  expectSuccess(studentView);
  assert.equal(studentView.json().timezone, 'Asia/Karachi');
  assert.equal(studentView.json().weekStart, monday);
  assert.equal(studentView.json().weekEnd, '2026-10-18');
  assert.equal(studentView.json().canManage, false);
  assert.ok(studentView.json().entries.some((value: { id: string }) => value.id === entry.id));
  const changed = await app.inject({
    method: 'PATCH',
    url: `/api/timetable/${entry.id}`,
    headers: bearer(admin),
    payload: { ...weekly, subjectId: DEMO_SUBJECT_IDS.os, room: 'New room', version: 1 },
  });
  expectSuccess(changed);
  assert.equal(changed.json().entry.version, 2);
  assert.equal(changed.json().entry.room, 'New room');
  const stale = await app.inject({
    method: 'DELETE',
    url: `/api/timetable/${entry.id}?version=1`,
    headers: bearer(admin),
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'record_changed');
  expectForbidden(
    await app.inject({
      method: 'DELETE',
      url: `/api/timetable/${entry.id}?version=2`,
      headers: bearer(student),
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/timetable/${entry.id}?version=2`,
      headers: bearer(admin),
    }),
  );
  const after = await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) });
  assert.ok(!after.json().entries.some((value: { id: string }) => value.id === entry.id));
});

test('invalid clock values, impossible dates, subject mismatch and duplicate entries are rejected', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin');
  for (const values of [
    { weekday: 0 },
    { weekday: 8 },
    { startTime: '9:00' },
    { startTime: '24:00' },
    { endTime: '13:00' },
    { startTime: '23:00', endTime: '01:00' },
    { endTime: '14:60' },
  ]) {
    expectClientRejection(
      await app.inject({
        method: 'POST',
        url: tableUrl,
        headers: bearer(admin),
        payload: { ...weekly, ...values },
      }),
      JSON.stringify(values),
    );
  }
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: tableUrl,
      headers: bearer(admin),
      payload: { ...weekly, subjectId: DEMO_SUBJECT_IDS.other },
    }),
  );
  await createEntry(app, admin);
  const duplicate = await app.inject({
    method: 'POST',
    url: tableUrl,
    headers: bearer(admin),
    payload: { ...weekly, title: weekly.title.toUpperCase() },
  });
  assert.equal(duplicate.statusCode, 409);
  for (const dueDate of ['2026-02-29', '2026-04-31'])
    expectClientRejection(
      await app.inject({
        method: 'POST',
        url: deadlinesUrl,
        headers: bearer(admin),
        payload: { ...deadlineForm, dueDate },
      }),
      dueDate,
    );
  expectClientRejection(
    await app.inject({ method: 'GET', url: `${tableUrl}?week=2026-02-30`, headers: bearer(admin) }),
    'Impossible week date',
  );
  expectClientRejection(
    await app.inject({
      method: 'GET',
      url: `${exceptionsUrl}?from=2026-10-12`,
      headers: bearer(admin),
    }),
    'A range needs both bounds',
  );
  expectClientRejection(
    await app.inject({
      method: 'GET',
      url: `${exceptionsUrl}?from=2026-10-12&to=2028-10-12`,
      headers: bearer(admin),
    }),
    'Unbounded date range',
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: deadlinesUrl,
      headers: bearer(admin),
      payload: { ...deadlineForm, dueDate: '2028-02-29' },
    }),
  );
});

test('dated cancellation, extra class and cross-week reschedule preserve the recurring template', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin'),
    student = await demoToken(app, 'student');
  const moved = await createException(app, admin, {
    kind: 'rescheduled',
    entryId: DEMO_TIMETABLE_IDS.monday,
    originalDate: monday,
    date: '2026-10-20',
    startTime: '15:00',
    endTime: '16:30',
    room: 'Replacement room',
    notes: 'Fictional one-date change.',
  });
  assert.equal(moved.title, 'Demo: Operating Systems');
  const cancelled = await createException(app, admin, {
    kind: 'cancelled',
    entryId: DEMO_TIMETABLE_IDS.wednesday,
    originalDate: '2026-10-14',
    notes: 'Fictional cancellation.',
  });
  assert.equal(cancelled.date, '2026-10-14');
  const extra = await createException(app, admin, {
    kind: 'extra',
    date: '2026-10-18',
    title: 'Sunday revision',
    startTime: '12:00',
    endTime: '13:00',
  });
  const thisWeek = (
    await app.inject({ method: 'GET', url: `${tableUrl}?week=${monday}`, headers: bearer(student) })
  ).json();
  const mondayMarker = thisWeek.sessions.find(
    (session: { entryId: string; date: string }) =>
      session.entryId === DEMO_TIMETABLE_IDS.monday && session.date === monday,
  );
  assert.equal(mondayMarker.cancelled, true);
  assert.equal(mondayMarker.movedToDate, '2026-10-20');
  assert.equal(
    thisWeek.sessions.filter(
      (session: { exceptionId: string; cancelled: boolean }) =>
        session.exceptionId === moved.id && !session.cancelled,
    ).length,
    0,
  );
  assert.ok(
    thisWeek.sessions.some(
      (session: { exceptionId: string; source: string }) =>
        session.exceptionId === extra.id && session.source === 'extra',
    ),
  );
  const nextWeek = (
    await app.inject({
      method: 'GET',
      url: `${tableUrl}?week=2026-10-19`,
      headers: bearer(student),
    })
  ).json();
  assert.ok(
    nextWeek.sessions.some(
      (session: { entryId: string; date: string; source: string }) =>
        session.entryId === DEMO_TIMETABLE_IDS.monday &&
        session.date === '2026-10-19' &&
        session.source === 'weekly',
    ),
  );
  const replacement = nextWeek.sessions.find(
    (session: { exceptionId: string }) => session.exceptionId === moved.id,
  );
  assert.equal(replacement.source, 'rescheduled');
  assert.equal(replacement.startAt, '2026-10-20T10:00:00.000Z');
  assert.equal(replacement.room, 'Replacement room');
  assert.ok(
    !nextWeek.sessions.some((session: { exceptionId: string }) => session.exceptionId === extra.id),
  );
  assert.equal(
    nextWeek.entries.find((entry: { id: string }) => entry.id === DEMO_TIMETABLE_IDS.monday)
      .weekday,
    1,
  );
  const duplicate = await app.inject({
    method: 'POST',
    url: exceptionsUrl,
    headers: bearer(admin),
    payload: { kind: 'cancelled', entryId: DEMO_TIMETABLE_IDS.monday, originalDate: monday },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'occurrence_already_changed');
  const wrongDay = await app.inject({
    method: 'POST',
    url: exceptionsUrl,
    headers: bearer(admin),
    payload: { kind: 'cancelled', entryId: DEMO_TIMETABLE_IDS.monday, originalDate: '2026-10-13' },
  });
  assert.equal(wrongDay.statusCode, 400);
});

test('exception versions protect edits, deleting an override restores a weekly occurrence, and weekday changes are explicit', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin');
  const entry = await createEntry(app, admin);
  const exception = await createException(app, admin, {
    kind: 'cancelled',
    entryId: entry.id,
    originalDate: '2026-10-15',
  });
  const blocked = await app.inject({
    method: 'PATCH',
    url: `/api/timetable/${entry.id}`,
    headers: bearer(admin),
    payload: { ...weekly, weekday: 5, version: 1 },
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error.code, 'dated_changes_exist');
  const changed = await app.inject({
    method: 'PATCH',
    url: `/api/schedule-exceptions/${exception.id}`,
    headers: bearer(admin),
    payload: {
      kind: 'rescheduled',
      entryId: entry.id,
      originalDate: '2026-10-15',
      date: '2026-10-16',
      startTime: '10:00',
      endTime: '11:00',
      version: 1,
    },
  });
  expectSuccess(changed);
  assert.equal(changed.json().exception.version, 2);
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/schedule-exceptions/${exception.id}?version=1`,
        headers: bearer(admin),
      })
    ).statusCode,
    409,
  );
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/schedule-exceptions/${exception.id}?version=2`,
      headers: bearer(admin),
    }),
  );
  const restored = (
    await app.inject({ method: 'GET', url: tableUrl, headers: bearer(admin) })
  ).json();
  assert.equal(
    restored.sessions.find((session: { entryId: string }) => session.entryId === entry.id).source,
    'weekly',
  );
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/timetable/${entry.id}`,
      headers: bearer(admin),
      payload: { ...weekly, weekday: 5, version: 1 },
    }),
  );
});

test('real overlaps are flagged while touching sessions and cancelled occurrences do not conflict', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin');
  const first = await createEntry(app, admin);
  const second = await createEntry(app, admin, {
    title: 'Parallel lab',
    startTime: '13:30',
    endTime: '14:30',
  });
  const adjacent = await createEntry(app, admin, {
    title: 'After the lab',
    startTime: '14:30',
    endTime: '15:30',
  });
  let view = (await app.inject({ method: 'GET', url: tableUrl, headers: bearer(admin) })).json();
  assert.equal(
    view.sessions.find((session: { entryId: string }) => session.entryId === first.id).conflict,
    true,
  );
  assert.equal(
    view.sessions.find((session: { entryId: string }) => session.entryId === second.id).conflict,
    true,
  );
  assert.equal(
    view.sessions.find((session: { entryId: string }) => session.entryId === adjacent.id).conflict,
    false,
  );
  await createException(app, admin, {
    kind: 'cancelled',
    entryId: first.id,
    originalDate: '2026-10-15',
  });
  view = (await app.inject({ method: 'GET', url: tableUrl, headers: bearer(admin) })).json();
  assert.equal(
    view.sessions.find((session: { entryId: string }) => session.entryId === first.id).conflict,
    false,
  );
  assert.equal(
    view.sessions.find((session: { entryId: string }) => session.entryId === second.id).conflict,
    false,
  );
});

test('deadlines convert Karachi timestamps, protect optimistic edits, and isolate per-student completion by version', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin'),
    student = await demoToken(app, 'student');
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: deadlinesUrl,
      headers: bearer(student),
      payload: deadlineForm,
    }),
  );
  const deadline = await createDeadline(app, admin);
  assert.equal(deadline.dueAt, '2026-10-12T04:00:00.000Z');
  assert.equal(deadline.completed, false);
  const completed = await app.inject({
    method: 'PATCH',
    url: `/api/deadlines/${deadline.id}/completion`,
    headers: bearer(student),
    payload: { completed: true, version: 1 },
  });
  expectSuccess(completed);
  assert.equal(completed.json().deadline.completed, true);
  const adminView = (
    await app.inject({ method: 'GET', url: deadlinesUrl, headers: bearer(admin) })
  ).json();
  assert.equal(
    adminView.deadlines.find((value: { id: string }) => value.id === deadline.id).completed,
    false,
  );
  const studentCompleted = (
    await app.inject({
      method: 'GET',
      url: `${deadlinesUrl}?completed=true`,
      headers: bearer(student),
    })
  ).json();
  assert.equal(studentCompleted.pagination.total, 1);
  assert.equal(studentCompleted.deadlines[0].id, deadline.id);
  const changed = await app.inject({
    method: 'PATCH',
    url: `/api/deadlines/${deadline.id}`,
    headers: bearer(admin),
    payload: { ...deadlineForm, dueTime: '10:00', version: 1 },
  });
  expectSuccess(changed);
  assert.equal(changed.json().deadline.version, 2);
  const reset = (
    await app.inject({
      method: 'GET',
      url: `${deadlinesUrl}?completed=true`,
      headers: bearer(student),
    })
  ).json();
  assert.equal(reset.pagination.total, 0);
  const staleCompletion = await app.inject({
    method: 'PATCH',
    url: `/api/deadlines/${deadline.id}/completion`,
    headers: bearer(student),
    payload: { completed: true, version: 1 },
  });
  assert.equal(staleCompletion.statusCode, 409);
  const spoofedOtherUser = await app.inject({
    method: 'PATCH',
    url: `/api/deadlines/${deadline.id}/completion`,
    headers: bearer(student),
    payload: { completed: true, userId: DEMO_USERS.admin.id },
  });
  assert.equal(spoofedOtherUser.statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/deadlines/${deadline.id}?version=1`,
        headers: bearer(admin),
      })
    ).statusCode,
    409,
  );
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/deadlines/${deadline.id}?version=2`,
      headers: bearer(admin),
    }),
  );
  expectForbidden(
    await app.inject({
      method: 'PATCH',
      url: `/api/deadlines/${deadline.id}/completion`,
      headers: bearer(student),
      payload: { completed: true },
    }),
  );
});

test('complete paginated exceptions and deadlines support an identical offline weekly resolution', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin'),
    student = await demoToken(app, 'student');
  const future = await createException(app, admin, {
    kind: 'extra',
    date: '2028-01-11',
    title: 'Far future demo session',
    startTime: '09:00',
    endTime: '10:00',
  });
  await createException(app, admin, {
    kind: 'rescheduled',
    entryId: DEMO_TIMETABLE_IDS.monday,
    originalDate: monday,
    date: '2026-10-21',
    startTime: '14:00',
    endTime: '15:00',
  });
  const currentList = (
    await app.inject({ method: 'GET', url: exceptionsUrl, headers: bearer(student) })
  ).json();
  assert.ok(!currentList.exceptions.some((value: { id: string }) => value.id === future.id));
  const all = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset++) {
    const page = await app.inject({
      method: 'GET',
      url: `${exceptionsUrl}?all=true&limit=1&offset=${offset}`,
      headers: bearer(student),
    });
    expectSuccess(page);
    total = page.json().pagination.total;
    all.push(...page.json().exceptions);
  }
  assert.equal(all.length, total);
  assert.ok(all.some((value) => value.id === future.id));
  const online = (
    await app.inject({
      method: 'GET',
      url: `${tableUrl}?week=2026-10-19`,
      headers: bearer(student),
    })
  ).json();
  assert.deepEqual(resolveSchedule(online.entries, all, '2026-10-19'), online.sessions);
  const longFuture = resolveSchedule(online.entries, all, '2028-01-10');
  assert.ok(longFuture.some((session) => session.exceptionId === future.id));
  await createDeadline(app, admin, { title: 'Far future deadline', dueDate: '2028-01-11' });
  const page1 = (
    await app.inject({ method: 'GET', url: `${deadlinesUrl}?limit=1`, headers: bearer(student) })
  ).json();
  const lastPage = (
    await app.inject({
      method: 'GET',
      url: `${deadlinesUrl}?limit=1&offset=${page1.pagination.total - 1}`,
      headers: bearer(student),
    })
  ).json();
  assert.equal(lastPage.deadlines[0].title, 'Far future deadline');
  expectClientRejection(
    await app.inject({
      method: 'GET',
      url: `${exceptionsUrl}?all=true&from=2026-10-12&to=2026-10-18`,
      headers: bearer(student),
    }),
    'All/date filters cannot mix',
  );
  expectClientRejection(
    await app.inject({ method: 'GET', url: `${deadlinesUrl}?limit=101`, headers: bearer(student) }),
    'Page limit is bounded',
  );
});

test('deleted subjects, feature switches, maintenance and removed memberships remain authoritative for planning', async (t) => {
  const { app, db } = await controlledApp(t),
    admin = await demoToken(app, 'admin'),
    student = await demoToken(app, 'student'),
    master = await demoToken(app, 'master');
  const entry = await createEntry(app, admin, { subjectId: DEMO_SUBJECT_IDS.os });
  const deadline = await createDeadline(app, admin, { subjectId: DEMO_SUBJECT_IDS.os });
  const exception = await createException(app, admin, {
    kind: 'cancelled',
    entryId: entry.id,
    originalDate: '2026-10-15',
  });
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}`,
      headers: bearer(admin),
    }),
  );
  const hiddenEntries = (
    await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) })
  ).json();
  assert.ok(!hiddenEntries.entries.some((value: { id: string }) => value.id === entry.id));
  assert.ok(!hiddenEntries.exceptions.some((value: { id: string }) => value.id === exception.id));
  assert.ok(
    !(
      await app.inject({ method: 'GET', url: deadlinesUrl, headers: bearer(student) })
    ).body.includes(deadline.id),
  );
  expectForbidden(
    await app.inject({
      method: 'PATCH',
      url: `/api/deadlines/${deadline.id}/completion`,
      headers: bearer(student),
      payload: { completed: true },
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/restore`,
      headers: bearer(admin),
    }),
  );
  await db.execute('UPDATE site_settings SET maintenance_enabled=1 WHERE id=1');
  expectSuccess(await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) }));
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: tableUrl,
        headers: bearer(admin),
        payload: { ...weekly, title: 'Maintenance denied' },
      })
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/deadlines/${deadline.id}/completion`,
        headers: bearer(student),
        payload: { completed: true },
      })
    ).statusCode,
    503,
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: tableUrl,
      headers: bearer(master),
      payload: { ...weekly, title: 'Owner maintenance recovery' },
    }),
  );
  await db.execute('UPDATE site_settings SET maintenance_enabled=0 WHERE id=1');
  const settings = (await db.execute('SELECT features_json FROM site_settings WHERE id=1'))
    .rows[0]!;
  const flags = JSON.parse(String(settings.features_json));
  flags.subjects = false;
  await db.execute({
    sql: 'UPDATE site_settings SET features_json=? WHERE id=1',
    args: [JSON.stringify(flags)],
  });
  assert.ok(
    !(await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) })).body.includes(
      entry.id,
    ),
  );
  flags.timetable = false;
  flags.deadlines = false;
  await db.execute({
    sql: 'UPDATE site_settings SET features_json=? WHERE id=1',
    args: [JSON.stringify(flags)],
  });
  expectForbidden(await app.inject({ method: 'GET', url: tableUrl, headers: bearer(student) }));
  expectForbidden(await app.inject({ method: 'GET', url: deadlinesUrl, headers: bearer(student) }));
  flags.timetable = true;
  flags.deadlines = true;
  flags.subjects = true;
  await db.execute({
    sql: 'UPDATE site_settings SET features_json=? WHERE id=1',
    args: [JSON.stringify(flags)],
  });
  await db.execute({
    sql: "UPDATE memberships SET status='removed' WHERE class_id=? AND user_id=?",
    args: [DEMO_CLASS_ID, DEMO_USERS.student.id],
  });
  for (const url of [tableUrl, `${exceptionsUrl}?all=true`, deadlinesUrl])
    expectForbidden(await app.inject({ method: 'GET', url, headers: bearer(student) }));
  expectForbidden(
    await app.inject({
      method: 'PATCH',
      url: `/api/deadlines/${deadline.id}/completion`,
      headers: bearer(student),
      payload: { completed: true },
    }),
  );
});

test('deleting a weekly parent removes its exception from complete snapshots; role changes apply on existing sessions', async (t) => {
  const { app, db } = await controlledApp(t),
    admin = await demoToken(app, 'admin');
  const entry = await createEntry(app, admin);
  const exception = await createException(app, admin, {
    kind: 'rescheduled',
    entryId: entry.id,
    originalDate: '2026-10-15',
    date: '2026-10-16',
    startTime: '11:00',
    endTime: '12:00',
  });
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/timetable/${entry.id}?version=1`,
      headers: bearer(admin),
    }),
  );
  const list = (
    await app.inject({ method: 'GET', url: `${exceptionsUrl}?all=true`, headers: bearer(admin) })
  ).json();
  assert.ok(!list.exceptions.some((value: { id: string }) => value.id === exception.id));
  await db.execute({
    sql: "UPDATE memberships SET role='student' WHERE class_id=? AND user_id=?",
    args: [DEMO_CLASS_ID, DEMO_USERS.admin.id],
  });
  expectForbidden(
    await app.inject({ method: 'POST', url: tableUrl, headers: bearer(admin), payload: weekly }),
  );
  const read = await app.inject({ method: 'GET', url: tableUrl, headers: bearer(admin) });
  expectSuccess(read);
  assert.equal(read.json().canManage, false);
});

test('concurrent editors receive one successful version advance and one conflict', async (t) => {
  const app = await planningApp(t),
    admin = await demoToken(app, 'admin'),
    master = await demoToken(app, 'master');
  const entry = await createEntry(app, admin);
  const results = await Promise.all([
    app.inject({
      method: 'PATCH',
      url: `/api/timetable/${entry.id}`,
      headers: bearer(admin),
      payload: { ...weekly, room: 'Admin edit', version: 1 },
    }),
    app.inject({
      method: 'PATCH',
      url: `/api/timetable/${entry.id}`,
      headers: bearer(master),
      payload: { ...weekly, room: 'Owner edit', version: 1 },
    }),
  ]);
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [200, 409],
    results.map((result) => result.body).join('\n'),
  );
  const current = (await app.inject({ method: 'GET', url: tableUrl, headers: bearer(admin) }))
    .json()
    .entries.find((value: { id: string }) => value.id === entry.id);
  assert.equal(current.version, 2);
  assert.ok(['Admin edit', 'Owner edit'].includes(current.room));
});
