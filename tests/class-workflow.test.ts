import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const requestedClass = {
  name: '6F Pilot Class',
  program: 'BS Computer Science',
  semester: 6,
  section: '6F',
  description: 'A class admin or owner can create a class directly.',
};

test('direct class creation keeps joining approval separate and class admin rights scoped', async (t) => {
  const app = await createTestApp(t);
  const requester = await demoToken(app, 'master');
  const existingAdmin = await demoToken(app, 'admin');
  const otherStudent = await demoToken(app, 'student');
  const creation = await app.inject({
    method: 'POST',
    url: '/api/classes',
    headers: bearer(requester),
    payload: requestedClass,
  });
  assert.equal(creation.statusCode, 201, creation.body);
  const classroom = creation.json<{
    class: { id: string; role: string | null; memberCount: number };
  }>().class;
  assert.equal(classroom.role, null, 'Owner creation must not create a class membership.');
  assert.equal(classroom.memberCount, 0);
  assert.notEqual(classroom.id, DEMO_CLASS_ID);

  const requesterClass = await app.inject({
    method: 'GET',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(requester),
  });
  expectSuccess(requesterClass);
  assert.equal(requesterClass.json().myRole, 'master');
  assert.deepEqual(
    (await app.inject({ method: 'GET', url: '/api/me', headers: bearer(requester) })).json()
      .classes,
    [],
    'The fresh demo owner also stays outside student enrollment.',
  );

  const invite = await app.inject({
    method: 'POST',
    url: `/api/classes/${classroom.id}/invite`,
    headers: bearer(requester),
  });
  expectSuccess(invite);
  const { code } = invite.json<{ code: string }>();
  assert.ok(code);

  const beforeJoin = await app.inject({
    method: 'GET',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(existingAdmin),
  });
  expectForbidden(beforeJoin);

  const join = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(existingAdmin),
    payload: { code },
  });
  expectSuccess(join);
  const pending = join.json<{
    membership: { id: string; classId: string; status: string };
  }>().membership;
  assert.equal(pending.classId, classroom.id);
  assert.equal(pending.status, 'pending');
  const pendingHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(existingAdmin),
  });
  expectSuccess(pendingHistory);
  const ownRequests = pendingHistory.json<{
    pendingMemberships: { id: string; status: string }[];
  }>().pendingMemberships;
  assert.equal(ownRequests.length, 1, 'Seeded memberships must not appear as join requests.');
  assert.equal(ownRequests[0]!.id, pending.id);
  assert.equal(ownRequests[0]!.status, 'pending');

  const whilePending = await app.inject({
    method: 'GET',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(existingAdmin),
  });
  expectForbidden(whilePending);

  const pendingSelfApproval = await app.inject({
    method: 'POST',
    url: `/api/classes/${classroom.id}/memberships/${pending.id}/decision`,
    headers: bearer(existingAdmin),
    payload: { decision: 'approve' },
  });
  expectForbidden(pendingSelfApproval);

  // The membership identifier cannot be reused with a class the actor does
  // administer. The URL's class and the membership's class must agree.
  const membershipMovedToOwnClass = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/memberships/${pending.id}/decision`,
    headers: bearer(existingAdmin),
    payload: { decision: 'approve' },
  });
  expectForbidden(membershipMovedToOwnClass);

  const representativeView = await app.inject({
    method: 'GET',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(requester),
  });
  expectSuccess(representativeView);
  const pendingMembers = representativeView.json<{ pendingMembers: { id: string }[] }>()
    .pendingMembers;
  assert.ok(pendingMembers.some((membership) => membership.id === pending.id));

  // Leave one real membership pending while a different ordinary member opens
  // the class, so an empty pending directory cannot make this privacy test pass.
  const secondJoin = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(otherStudent),
    payload: { code },
  });
  expectSuccess(secondJoin);
  const secondMembershipId = secondJoin.json<{ membership: { id: string } }>().membership.id;
  const secondApproval = await app.inject({
    method: 'POST',
    url: `/api/classes/${classroom.id}/memberships/${secondMembershipId}/decision`,
    headers: bearer(requester),
    payload: { decision: 'approve' },
  });
  expectSuccess(secondApproval);
  const ordinaryMemberWithPendingPeer = await app.inject({
    method: 'GET',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(otherStudent),
  });
  expectSuccess(ordinaryMemberWithPendingPeer);
  assert.deepEqual(
    ordinaryMemberWithPendingPeer.json<{ pendingMembers: unknown[] }>().pendingMembers,
    [],
  );
  assert.ok(!ordinaryMemberWithPendingPeer.body.includes(DEMO_USERS.admin.email));

  const membershipApproval = await app.inject({
    method: 'POST',
    url: `/api/classes/${classroom.id}/memberships/${pending.id}/decision`,
    headers: bearer(requester),
    payload: { decision: 'approve' },
  });
  expectSuccess(membershipApproval);
  assert.equal(membershipApproval.json<{ status: string }>().status, 'active');
  const approvedHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(existingAdmin),
  });
  expectSuccess(approvedHistory);
  assert.equal(
    approvedHistory
      .json<{ pendingMemberships: { id: string; status: string }[] }>()
      .pendingMemberships.find((membership) => membership.id === pending.id)?.status,
    'approved',
  );

  const memberView = await app.inject({
    method: 'GET',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(existingAdmin),
  });
  expectSuccess(memberView);
  const studentView = memberView.json<{
    members: Record<string, unknown>[];
    pendingMembers: unknown[];
    invite: unknown;
  }>();
  assert.ok(studentView.members.length > 0);
  assert.ok(studentView.members.every((member) => !Object.hasOwn(member, 'email')));
  assert.deepEqual(studentView.pendingMembers, []);
  assert.equal(studentView.invite, null);

  // Being an admin in 5D grants no editing role in the new class.
  const memberWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(existingAdmin),
    payload: { ...requestedClass, name: 'Unauthorized class rename' },
  });
  expectForbidden(memberWrite);

  const representativeWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${classroom.id}`,
    headers: bearer(requester),
    payload: { ...requestedClass, name: 'Authorized admin rename' },
  });
  expectSuccess(representativeWrite);

  const removeJoinedMember = await app.inject({
    method: 'DELETE',
    url: `/api/classes/${classroom.id}/members/${DEMO_USERS.admin.id}`,
    headers: bearer(requester),
  });
  expectSuccess(removeJoinedMember);
  const removedHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(existingAdmin),
  });
  expectSuccess(removedHistory);
  assert.equal(
    removedHistory
      .json<{ pendingMemberships: { id: string; status: string }[] }>()
      .pendingMemberships.find((membership) => membership.id === pending.id)?.status,
    'removed',
  );
  const requesterHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(requester),
  });
  expectSuccess(requesterHistory);
  assert.deepEqual(
    requesterHistory.json<{ pendingMemberships: unknown[] }>().pendingMemberships,
    [],
    'A direct class creator must not acquire a fictional join request.',
  );
});

test('only current class admins or the owner can create classes and retired approvals fail closed', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');
  const admin = await demoToken(app, 'admin');
  const master = await demoToken(app, 'master');
  const studentBefore = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(student),
  });
  assert.equal(studentBefore.json().canCreateClass, false);
  const blocked = await app.inject({
    method: 'POST',
    url: '/api/classes',
    headers: { ...bearer(student), 'x-role': 'admin' },
    payload: requestedClass,
  });
  assert.equal(blocked.statusCode, 403, blocked.body);
  for (const token of [student, admin, master]) {
    const retired = await app.inject({
      method: 'POST',
      url: '/api/class-requests',
      headers: bearer(token),
      payload: requestedClass,
    });
    assert.equal(retired.statusCode, 410, retired.body);
  }
  for (const url of [
    `/api/admin/class-requests/${DEMO_CLASS_ID}/decision`,
    `/api/admin/classes/${DEMO_CLASS_ID}/representatives`,
  ]) {
    expectForbidden(
      await app.inject({
        method: 'POST',
        url,
        headers: bearer(student),
        payload: { decision: 'approve' },
      }),
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: bearer(master),
          payload: { decision: 'approve' },
        })
      ).statusCode,
      410,
    );
  }
  const created = await app.inject({
    method: 'POST',
    url: '/api/classes',
    headers: bearer(admin),
    payload: requestedClass,
  });
  assert.equal(created.statusCode, 201, created.body);
  const classId = created.json().class.id;
  const detail = await app.inject({
    method: 'GET',
    url: `/api/classes/${classId}`,
    headers: bearer(admin),
  });
  assert.equal(detail.json().myRole, 'admin');
  assert.deepEqual(
    detail
      .json()
      .members.map((member: { userId: string; role: string }) => [member.userId, member.role]),
    [[DEMO_USERS.admin.id, 'admin']],
  );
  const adminProfile = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(admin) });
  assert.equal(adminProfile.json().canCreateClass, true);
  assert.equal(adminProfile.json().user.role, 'student');
  assert.deepEqual(adminProfile.json().classRequests, []);
  expectForbidden(
    await app.inject({ method: 'GET', url: '/api/admin/overview', headers: bearer(admin) }),
  );
  expectForbidden(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/classes/${classId}/members/${DEMO_USERS.admin.id}/role`,
      headers: bearer(admin),
      payload: { role: 'admin' },
    }),
  );
});
