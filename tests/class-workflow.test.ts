import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import {
  bearer,
  createTestApp,
  demoToken,
  expectForbidden,
  expectSuccess,
  type TestApp,
} from './helpers.js';

const requestedClass = {
  name: '6F Pilot Class',
  program: 'BS Computer Science',
  semester: 6,
  section: '6F',
  description: 'A new class must be approved by the application owner.',
};

async function submitClassRequest(app: TestApp, token: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/class-requests',
    headers: bearer(token),
    payload: requestedClass,
  });
  expectSuccess(response);
  const body = response.json<{ request: { id: string; status: string } }>();
  assert.equal(body.request.status, 'pending');
  assert.ok(body.request.id);
  return body.request.id;
}

test('class creation and joining require separate owner and representative approvals', async (t) => {
  const app = await createTestApp(t);
  const requester = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  const existingCr = await demoToken(app, 'cr');
  const otherStudent = await demoToken(app, 'gr');
  const requestId = await submitClassRequest(app, requester);

  for (const unauthorized of [requester, existingCr]) {
    const selfApproval = await app.inject({
      method: 'POST',
      url: `/api/admin/class-requests/${requestId}/decision`,
      headers: { ...bearer(unauthorized), 'x-role': 'master' },
      payload: { decision: 'approve' },
    });
    expectForbidden(selfApproval);
  }

  const approval = await app.inject({
    method: 'POST',
    url: `/api/admin/class-requests/${requestId}/decision`,
    headers: bearer(master),
    payload: { decision: 'approve', note: 'Pilot approved for this integration test.' },
  });
  expectSuccess(approval);
  const approved = approval.json<{ requestId: string; status: string; classId: string }>();
  assert.equal(approved.requestId, requestId);
  assert.equal(approved.status, 'approved');
  assert.ok(approved.classId);
  assert.notEqual(approved.classId, DEMO_CLASS_ID);

  const requesterClass = await app.inject({
    method: 'GET',
    url: `/api/classes/${approved.classId}`,
    headers: bearer(requester),
  });
  expectSuccess(requesterClass);

  const invite = await app.inject({
    method: 'POST',
    url: `/api/classes/${approved.classId}/invite`,
    headers: bearer(requester),
  });
  expectSuccess(invite);
  const { code } = invite.json<{ code: string }>();
  assert.ok(code);

  const beforeJoin = await app.inject({
    method: 'GET',
    url: `/api/classes/${approved.classId}`,
    headers: bearer(existingCr),
  });
  expectForbidden(beforeJoin);

  const join = await app.inject({
    method: 'POST',
    url: '/api/join',
    headers: bearer(existingCr),
    payload: { code },
  });
  expectSuccess(join);
  const pending = join.json<{
    membership: { id: string; classId: string; status: string };
  }>().membership;
  assert.equal(pending.classId, approved.classId);
  assert.equal(pending.status, 'pending');
  const pendingHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(existingCr),
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
    url: `/api/classes/${approved.classId}`,
    headers: bearer(existingCr),
  });
  expectForbidden(whilePending);

  const pendingSelfApproval = await app.inject({
    method: 'POST',
    url: `/api/classes/${approved.classId}/memberships/${pending.id}/decision`,
    headers: bearer(existingCr),
    payload: { decision: 'approve' },
  });
  expectForbidden(pendingSelfApproval);

  // The membership identifier cannot be reused with a class the actor does
  // administer. The URL's class and the membership's class must agree.
  const membershipMovedToOwnClass = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/memberships/${pending.id}/decision`,
    headers: bearer(existingCr),
    payload: { decision: 'approve' },
  });
  expectForbidden(membershipMovedToOwnClass);

  const representativeView = await app.inject({
    method: 'GET',
    url: `/api/classes/${approved.classId}`,
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
    url: `/api/classes/${approved.classId}/memberships/${secondMembershipId}/decision`,
    headers: bearer(requester),
    payload: { decision: 'approve' },
  });
  expectSuccess(secondApproval);
  const ordinaryMemberWithPendingPeer = await app.inject({
    method: 'GET',
    url: `/api/classes/${approved.classId}`,
    headers: bearer(otherStudent),
  });
  expectSuccess(ordinaryMemberWithPendingPeer);
  assert.deepEqual(
    ordinaryMemberWithPendingPeer.json<{ pendingMembers: unknown[] }>().pendingMembers,
    [],
  );
  assert.ok(!ordinaryMemberWithPendingPeer.body.includes(DEMO_USERS.cr.email));

  const membershipApproval = await app.inject({
    method: 'POST',
    url: `/api/classes/${approved.classId}/memberships/${pending.id}/decision`,
    headers: bearer(requester),
    payload: { decision: 'approve' },
  });
  expectSuccess(membershipApproval);
  assert.equal(membershipApproval.json<{ status: string }>().status, 'active');
  const approvedHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(existingCr),
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
    url: `/api/classes/${approved.classId}`,
    headers: bearer(existingCr),
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

  // Being a CR in 5D grants no editing role in the new class.
  const memberWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${approved.classId}`,
    headers: bearer(existingCr),
    payload: { ...requestedClass, name: 'Unauthorized class rename' },
  });
  expectForbidden(memberWrite);

  const representativeWrite = await app.inject({
    method: 'PATCH',
    url: `/api/classes/${approved.classId}`,
    headers: bearer(requester),
    payload: { ...requestedClass, name: 'Approved representative rename' },
  });
  expectSuccess(representativeWrite);

  const removeJoinedMember = await app.inject({
    method: 'DELETE',
    url: `/api/classes/${approved.classId}/members/${DEMO_USERS.cr.id}`,
    headers: bearer(requester),
  });
  expectSuccess(removeJoinedMember);
  const removedHistory = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: bearer(existingCr),
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
    'A master-approved class creator must not acquire a fictional join request.',
  );
});

test('rejecting a class request does not grant its requester CR powers', async (t) => {
  const app = await createTestApp(t);
  const requester = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  const requestId = await submitClassRequest(app, requester);

  const rejected = await app.inject({
    method: 'POST',
    url: `/api/admin/class-requests/${requestId}/decision`,
    headers: bearer(master),
    payload: { decision: 'reject', note: 'Duplicate class request.' },
  });
  expectSuccess(rejected);
  assert.equal(rejected.json<{ status: string }>().status, 'rejected');
  assert.equal(rejected.json<{ classId?: string | null }>().classId ?? null, null);

  const stillAStudent = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/invite`,
    headers: bearer(requester),
  });
  expectForbidden(stillAStudent);
});
