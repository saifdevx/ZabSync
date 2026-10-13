import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTestConfig } from '../server/config.js';
import { bearer, createTestApp, expectForbidden, expectSuccess } from './helpers.js';

async function setup(t: Parameters<typeof createTestApp>[0]) {
  const app = await createTestApp(t, {
    config: makeTestConfig({ authMode: 'firebase', masterAdminEmail: 'owner@szabist-isb.pk' }),
    seedDemo: false,
    verifyFirebaseToken: async (token) => ({
      uid: token,
      email: `${token}@szabist-isb.pk`,
      email_verified: true,
      name: token,
    }),
  });
  const call = (
    token: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as never }),
    });
  for (const token of ['owner', 'admin-a', 'admin-b', 'student', 'peer'])
    expectSuccess(await call(token, 'GET', '/me'));
  const classes: string[] = [],
    subjects: string[] = [],
    codes: string[] = [];
  for (const [index, section] of ['5D', '2B'].entries()) {
    const c = await call('owner', 'POST', '/classes', {
      name: section,
      program: 'BS Computer Science',
      semester: index ? 2 : 5,
      section: section.slice(1),
      description: '',
    });
    expectSuccess(c);
    const id = c.json().class.id;
    classes.push(id);
    assert.equal(c.json().class.memberCount, 0);
    const admin = index ? 'admin-b' : 'admin-a';
    expectSuccess(await call('owner', 'POST', `/admin/classes/${id}/members`, { userId: admin }));
    expectSuccess(
      await call('owner', 'PATCH', `/admin/classes/${id}/members/${admin}/role`, { role: 'admin' }),
    );
    const s = await call(admin, 'POST', `/classes/${id}/subjects`, {
      name: index ? 'Other section subject' : 'OS Lab',
      code: 'CS501',
    });
    expectSuccess(s);
    subjects.push(s.json().subject.id);
    const invite = await call(admin, 'POST', `/subjects/${subjects[index]}/invite`);
    expectSuccess(invite);
    codes.push(invite.json().code);
  }
  return { app, call, classes, subjects, codes };
}

test('one approved section contains separately enrolled subjects; students cannot create or publish academic content', async (t) => {
  const { call, classes, subjects, codes } = await setup(t),
    classA = classes[0]!,
    classB = classes[1]!,
    subjectA = subjects[0]!;
  for (const token of ['student', 'admin-a']) {
    assert.equal((await call(token, 'GET', '/me')).json().canCreateClass, false);
    expectForbidden(
      await call(token, 'POST', '/classes', {
        name: 'Unauthorized section',
        program: 'BS CS',
        semester: 7,
        section: 'C',
      }),
    );
  }
  expectForbidden(
    await call('student', 'POST', `/classes/${classA}/subjects`, { name: 'Unauthorized subject' }),
  );
  const joined = await call('student', 'POST', '/subjects/join', { code: codes[0] });
  expectSuccess(joined);
  assert.equal(joined.json().membership.status, 'pending');
  assert.equal((await call('student', 'GET', '/me')).json().classes.length, 0);
  expectForbidden(await call('student', 'GET', `/subjects/${subjectA}`));
  assert.equal(
    (await call('student', 'POST', '/subjects/join', { code: codes[1] })).statusCode,
    409,
  );
  const memberId = joined.json().membership.id;
  expectForbidden(
    await call('student', 'POST', `/classes/${classA}/memberships/${memberId}/decision`, {
      decision: 'approve',
    }),
  );
  expectForbidden(
    await call('admin-b', 'POST', `/classes/${classA}/memberships/${memberId}/decision`, {
      decision: 'approve',
    }),
  );
  expectSuccess(
    await call('admin-a', 'POST', `/classes/${classA}/memberships/${memberId}/decision`, {
      decision: 'approve',
    }),
  );
  const me = (await call('student', 'GET', '/me')).json();
  assert.deepEqual(
    me.classes.map((c: { id: string }) => c.id),
    [classA],
  );
  assert.equal(me.section.classId, classA);
  expectSuccess(await call('student', 'GET', `/subjects/${subjectA}`));
  assert.equal(
    (await call('student', 'POST', '/subjects/join', { code: codes[1] })).statusCode,
    409,
  );
  expectForbidden(await call('student', 'GET', `/classes/${classB}`));
  expectForbidden(
    await call('admin-a', 'PATCH', `/admin/classes/${classA}/members/student/role`, {
      role: 'admin',
    }),
  );
  for (const payload of [
    { scope: 'class', classId: classA, title: 'Unauthorized', body: 'No' },
    { scope: 'subject', classId: classA, subjectId: subjectA, title: 'Unauthorized', body: 'No' },
  ])
    expectForbidden(await call('student', 'POST', '/announcements', payload));
  const extra = await call('admin-a', 'POST', `/classes/${classA}/subjects`, {
    name: 'Database Systems',
  });
  expectSuccess(extra);
  const dbId = extra.json().subject.id;
  expectSuccess(
    await call('admin-a', 'POST', '/announcements', {
      scope: 'subject',
      classId: classA,
      subjectId: dbId,
      title: 'Private DB notice',
      body: 'Enrolled subject only.',
    }),
  );
  const deadline = await call('admin-a', 'POST', `/classes/${classA}/deadlines`, {
    subjectId: dbId,
    kind: 'quiz',
    title: 'Private DB quiz',
    dueDate: '2027-01-20',
    dueTime: '09:00',
  });
  expectSuccess(deadline);
  const notice = (await call('student', 'GET', `/announcements?classId=${classA}`)).json();
  assert.ok(!notice.announcements.some((a: { title: string }) => a.title === 'Private DB notice'));
  assert.equal(
    (await call('student', 'GET', `/classes/${classA}/subjects`)).json().subjects.length,
    1,
  );
  assert.equal(
    (await call('student', 'GET', `/classes/${classA}/deadlines`)).json().deadlines.length,
    0,
  );
  expectForbidden(
    await call('student', 'PATCH', `/deadlines/${deadline.json().deadline.id}/completion`, {
      version: 1,
      completed: true,
    }),
  );
  expectForbidden(await call('student', 'GET', `/subjects/${dbId}`));
  const invite = await call('admin-a', 'POST', `/subjects/${dbId}/invite`);
  expectSuccess(invite);
  const later = await call('student', 'POST', '/subjects/join', { code: invite.json().code });
  expectSuccess(later);
  assert.equal(later.json().membership.status, 'active');
  assert.equal(
    (await call('student', 'GET', `/classes/${classA}/subjects`)).json().subjects.length,
    2,
  );
  assert.equal(
    (await call('student', 'GET', `/classes/${classA}/deadlines?subjectId=${dbId}`)).json()
      .deadlines.length,
    1,
  );
  expectSuccess(await call('student', 'GET', `/subjects/${dbId}`));
  const snapshot = (await call('student', 'GET', '/offline/access')).json();
  assert.deepEqual(snapshot.classIds, [classA]);
  assert.equal(snapshot.subjectIds.length, 2);
  assert.ok(!snapshot.subjectIds.includes(subjects[1]));
  expectSuccess(
    await call('owner', 'PATCH', `/admin/classes/${classA}/members/student/role`, {
      role: 'admin',
    }),
  );
  assert.equal((await call('student', 'GET', '/me')).json().classes[0].role, 'admin');
  expectSuccess(
    await call('owner', 'PATCH', `/admin/classes/${classA}/members/student/role`, {
      role: 'student',
    }),
  );
  expectForbidden(await call('student', 'POST', `/subjects/${subjectA}/invite`));
});

test('concurrent different-section joins and owner transfers serialize; transfers revoke old subject access and never copy admin roles', async (t) => {
  const { call, classes, subjects, codes } = await setup(t);
  const requests = await Promise.all(
    codes.map((code) => call('student', 'POST', '/subjects/join', { code })),
  );
  assert.deepEqual(
    requests.map((r) => r.statusCode).sort(),
    [200, 409],
    requests.map((r) => r.body).join('\n'),
  );
  const approved = requests.find((r) => r.statusCode === 200)!.json().membership;
  expectSuccess(
    await call(
      'owner',
      'POST',
      `/classes/${approved.classId}/memberships/${approved.id}/decision`,
      { decision: 'approve' },
    ),
  );
  assert.equal((await call('student', 'GET', '/me')).json().classes.length, 1);
  expectSuccess(
    await call('owner', 'PATCH', `/admin/classes/${approved.classId}/members/student/role`, {
      role: 'admin',
    }),
  );
  const previous = (await call('owner', 'GET', '/admin/users/student/section')).json().section;
  const target = classes.find((id) => id !== approved.classId)!,
    targetSubject = subjects[classes.indexOf(target)]!;
  assert.equal(
    (await call('owner', 'POST', `/admin/classes/${target}/members`, { userId: 'student' }))
      .statusCode,
    409,
    'Owner enrollment must require a deliberate transfer.',
  );
  expectForbidden(
    await call('student', 'PUT', '/admin/users/student/section', {
      classId: target,
      version: previous.version,
      reason: 'Spoof transfer',
      subjectIds: [targetSubject],
    }),
  );
  const transfers = await Promise.all(
    [1, 2].map(() =>
      call('owner', 'PUT', '/admin/users/student/section', {
        classId: target,
        version: previous.version,
        reason: 'Confirmed section transfer',
        subjectIds: [targetSubject],
      }),
    ),
  );
  assert.deepEqual(
    transfers.map((r) => r.statusCode).sort(),
    [200, 409],
    transfers.map((r) => r.body).join('\n'),
  );
  const me = (await call('student', 'GET', '/me')).json();
  assert.deepEqual(
    me.classes.map((c: { id: string; role: string }) => [c.id, c.role]),
    [[target, 'student']],
  );
  expectForbidden(await call('student', 'GET', `/classes/${approved.classId}`));
  expectForbidden(await call('student', 'GET', `/subjects/${approved.subjectId}`));
  expectSuccess(await call('student', 'GET', `/subjects/${targetSubject}`));
  const snapshot = (await call('student', 'GET', '/offline/access')).json();
  assert.deepEqual(snapshot.classIds, [target]);
  assert.deepEqual(snapshot.subjectIds, [targetSubject]);
  const history = (await call('owner', 'GET', '/admin/users/student/section')).json().memberships;
  assert.ok(
    history.some(
      (m: { classId: string; status: string }) =>
        m.classId === approved.classId && m.status === 'removed',
    ),
  );
});

test('pending section requests can be cancelled or rejected and old class-code workflows cannot create memberships', async (t) => {
  const { call, classes, codes } = await setup(t);
  assert.equal((await call('student', 'POST', '/join', { code: codes[0] })).statusCode, 410);
  assert.equal((await call('owner', 'POST', `/classes/${classes[0]}/invite`)).statusCode, 410);
  const first = await call('student', 'POST', '/subjects/join', { code: codes[0] });
  expectSuccess(first);
  expectSuccess(await call('student', 'DELETE', '/me/section-request'));
  assert.equal((await call('student', 'GET', '/me')).json().section.pendingClassId, null);
  const second = await call('student', 'POST', '/subjects/join', { code: codes[1] });
  expectSuccess(second);
  const m = second.json().membership;
  expectSuccess(
    await call('admin-b', 'POST', `/classes/${m.classId}/memberships/${m.id}/decision`, {
      decision: 'reject',
    }),
  );
  assert.equal((await call('student', 'GET', '/me')).json().section.pendingClassId, null);
  const again = await call('student', 'POST', '/subjects/join', { code: codes[0] });
  expectSuccess(again);
});
