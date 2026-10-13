import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const validClassUpdate = {
  name: '5D Admin Handover',
  program: 'BS Computer Science',
  semester: 5,
  section: 'D',
  description: 'Editing rights must follow the current class role.',
};
const roleUrl = (userId: string) => `/api/admin/classes/${DEMO_CLASS_ID}/members/${userId}/role`;

test('only the owner can assign multiple class admins and an existing session immediately follows demotion', async (t) => {
  const app = await createTestApp(t);
  const originalAdmin = await demoToken(app, 'admin');
  const replacement = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  for (const token of [originalAdmin, replacement]) {
    expectForbidden(
      await app.inject({
        method: 'PATCH',
        url: roleUrl(DEMO_USERS.student.id),
        headers: { ...bearer(token), 'x-role': 'master' },
        payload: { role: 'admin' },
      }),
    );
    expectForbidden(
      await app.inject({
        method: 'POST',
        url: `/api/admin/classes/${DEMO_OTHER_CLASS_ID}/members`,
        headers: bearer(token),
        payload: { userId: DEMO_USERS.student.id },
      }),
    );
  }
  const appointment = await app.inject({
    method: 'PATCH',
    url: roleUrl(DEMO_USERS.student.id),
    headers: bearer(master),
    payload: { role: 'admin' },
  });
  expectSuccess(appointment);
  const roster = (
    await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(master),
    })
  ).json().members as { userId: string; role: string }[];
  assert.equal(
    roster.filter((member) => member.role === 'admin').length,
    3,
    'Appointing an admin must preserve both existing admins.',
  );
  assert.equal(roster.find((member) => member.userId === DEMO_USERS.admin.id)?.role, 'admin');
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(replacement),
      payload: validClassUpdate,
    }),
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(replacement) })).json()
      .canCreateClass,
    false,
  );

  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: roleUrl(DEMO_USERS.admin.id),
      headers: bearer(master),
      payload: { role: 'student' },
    }),
  );
  for (const method of ['PATCH', 'POST'] as const) {
    expectForbidden(
      await app.inject({
        method,
        url:
          method === 'POST'
            ? `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`
            : `/api/classes/${DEMO_CLASS_ID}`,
        headers: bearer(originalAdmin),
        ...(method === 'PATCH' ? { payload: validClassUpdate } : {}),
      }),
    );
  }
  const demotedProfile = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(originalAdmin),
  });
  expectSuccess(demotedProfile);
  assert.equal(demotedProfile.json().canCreateClass, false);
  assert.equal(demotedProfile.json().user.role, 'student');
  assert.equal(demotedProfile.json().classes[0].role, 'student');
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: bearer(originalAdmin),
      payload: validClassUpdate,
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
      headers: bearer(replacement),
    }),
  );
  expectForbidden(
    await app.inject({ method: 'GET', url: '/api/admin/overview', headers: bearer(replacement) }),
  );
  expectForbidden(
    await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_OTHER_CLASS_ID}`,
      headers: bearer(replacement),
    }),
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: roleUrl(DEMO_USERS.student.id),
        headers: bearer(master),
        payload: { role: 'master' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: roleUrl(DEMO_USERS.student.id),
        headers: bearer(master),
        payload: { role: 'cr' },
      })
    ).statusCode,
    400,
  );
});

test('the owner can recover a class without an admin while class admins cannot remove peer admins', async (t) => {
  const app = await createTestApp(t);
  const master = await demoToken(app, 'master');
  const admin = await demoToken(app, 'admin');
  const student = await demoToken(app, 'student');
  expectForbidden(
    await app.inject({
      method: 'DELETE',
      url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.legacyGr.id}`,
      headers: bearer(admin),
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.legacyGr.id}`,
      headers: bearer(master),
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: roleUrl(DEMO_USERS.admin.id),
      headers: bearer(master),
      payload: { role: 'student' },
    }),
  );
  const noAdmins = (
    await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(master),
    })
  ).json().members as { role: string }[];
  assert.equal(noAdmins.filter((member) => member.role === 'admin').length, 0);
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: roleUrl(DEMO_USERS.student.id),
      headers: bearer(master),
      payload: { role: 'admin' },
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
      headers: bearer(student),
    }),
  );

  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.admin.id}`,
      headers: bearer(student),
    }),
  );
  expectForbidden(
    await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(admin),
    }),
  );
  const restored = await app.inject({
    method: 'POST',
    url: `/api/admin/classes/${DEMO_CLASS_ID}/members`,
    headers: bearer(master),
    payload: { userId: DEMO_USERS.admin.id },
  });
  expectSuccess(restored);
  assert.equal(
    restored.json().membership.role,
    'student',
    'Restoring a member must not revive a removed admin grant.',
  );
  assert.equal(restored.json().membership.status, 'active');
  expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(admin),
    }),
  );
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: `/api/subjects/${DEMO_SUBJECT_IDS.os}/invite`,
      headers: bearer(admin),
    }),
  );
  const repeated = await app.inject({
    method: 'POST',
    url: `/api/admin/classes/${DEMO_CLASS_ID}/members`,
    headers: bearer(master),
    payload: { userId: DEMO_USERS.admin.id },
  });
  assert.deepEqual(repeated.json().membership, restored.json().membership);
});

test('owner membership assignment requires an existing active account and never grants a global role', async (t) => {
  const app = await createTestApp(t);
  const master = await demoToken(app, 'master');
  const student = await demoToken(app, 'student');
  const addUrl = `/api/admin/classes/${DEMO_OTHER_CLASS_ID}/members`;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: addUrl,
        headers: bearer(master),
        payload: { userId: 'unregistered-uid' },
      })
    ).statusCode,
    404,
  );
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${DEMO_USERS.student.id}/status`,
      headers: bearer(master),
      payload: { status: 'suspended' },
    }),
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: addUrl,
        headers: bearer(master),
        payload: { userId: DEMO_USERS.student.id },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: roleUrl(DEMO_USERS.student.id),
        headers: bearer(master),
        payload: { role: 'admin' },
      })
    ).statusCode,
    404,
  );
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${DEMO_USERS.student.id}/status`,
      headers: bearer(master),
      payload: { status: 'active' },
    }),
  );
  const added = await app.inject({
    method: 'POST',
    url: addUrl,
    headers: bearer(master),
    payload: { userId: DEMO_USERS.student.id },
  });
  assert.equal(
    added.statusCode,
    409,
    'Adding someone to a second section requires an explicit owner transfer.',
  );
  const before = (
    await app.inject({
      method: 'GET',
      url: `/api/admin/users/${DEMO_USERS.student.id}/section`,
      headers: bearer(master),
    })
  ).json().section;
  const transfer = await app.inject({
    method: 'PUT',
    url: `/api/admin/users/${DEMO_USERS.student.id}/section`,
    headers: bearer(master),
    payload: {
      classId: DEMO_OTHER_CLASS_ID,
      version: before.version,
      reason: 'Confirmed transfer for test student',
    },
  });
  expectSuccess(transfer);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(student) })).json();
  assert.equal(me.user.role, 'student');
  assert.equal(me.canCreateClass, false);
  assert.equal(me.classes.length, 1);
  assert.equal(me.classes[0].id, DEMO_OTHER_CLASS_ID);
  assert.equal(me.classes[0].role, 'student');
  assert.deepEqual(
    me.pendingMemberships,
    [],
    'Owner-added membership is not a fictional join request.',
  );
});

test('an admin membership in an archived class cannot authorize creation or ongoing class edits', async (t) => {
  const db = await openDatabase('file::memory:');
  const app = await createApp({ db, config: makeTestConfig(), seedDemo: true });
  t.after(async () => {
    await app.close();
    db.close();
  });
  await app.ready();
  const admin = await demoToken(app, 'admin');
  const master = await demoToken(app, 'master');
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(admin) })).json()
      .canCreateClass,
    false,
  );
  await db.execute({
    sql: "UPDATE classes SET status='archived' WHERE id=?",
    args: [DEMO_CLASS_ID],
  });
  const inactive = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(admin) });
  assert.equal(inactive.json().canCreateClass, false);
  assert.deepEqual(inactive.json().classes, []);
  expectForbidden(
    await app.inject({
      method: 'POST',
      url: '/api/classes',
      headers: bearer(admin),
      payload: validClassUpdate,
    }),
  );
  expectForbidden(
    await app.inject({
      method: 'PATCH',
      url: `/api/classes/${DEMO_CLASS_ID}`,
      headers: bearer(admin),
      payload: validClassUpdate,
    }),
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(master) })).json()
      .canCreateClass,
    true,
  );
  const remaining = (
    await app.inject({ method: 'GET', url: '/api/admin/semesters', headers: bearer(master) })
  ).json();
  assert.equal(remaining.totals.classCount, 1);
  assert.equal(remaining.semesters[0].semester, 4);
});
