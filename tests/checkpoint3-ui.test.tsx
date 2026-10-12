import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { renderApplication } from './ui-harness.js';

// One combined journey keeps the actual role transition, timetable and personal
// completion state across real account switches rather than resetting fixtures.
test(
  'rendered owner directory manages real enrollment and class roles, then admins plan a week students can read and complete',
  { timeout: 60_000 },
  async (t) => {
    const db = await openDatabase('file::memory:');
    const app = await createApp({ db, config: makeTestConfig(), seedDemo: true });
    app.addHook('onClose', async () => {
      db.close();
    });
    await app.ready();
    // Seed a numeric mailbox for this fictional local account to exercise the
    // university roll-number display. All memberships/roles below use rendered UI.
    await db.execute({
      sql: 'UPDATE users SET email=?,username=? WHERE id=?',
      args: ['2412339@szabist-isb.pk', 'areeba_5d', DEMO_USERS.student.id],
    });
    const ui = await renderApplication(t, { app });
    const { screen, fireEvent, waitFor, within, mainNavigation, switchRole, lastCall, calls } = ui;
    fireEvent.click(await screen.findByRole('button', { name: /^Master Admin/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: 'Your campus. Your control.',
    });
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Owner dashboard' }));
    await screen.findByRole('heading', { level: 1, name: 'Your campus. Your control.' });
    await screen.findByRole('heading', { name: 'Find a section' });
    fireEvent.click(screen.getByRole('button', { name: /Semester 6/ }));
    await screen.findByRole('heading', { name: 'Sections & classes' });
    fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
    const create = await screen.findByRole('dialog', { name: 'Create a class space' });
    assert.equal((within(create).getByLabelText('Semester') as HTMLInputElement).value, '6');
    for (const [label, value] of [
      ['Class name', '6H UI Campus'],
      ['Program', 'BS Computer Science'],
      ['Semester', '6'],
      ['Section', 'H'],
    ]) {
      fireEvent.change(within(create).getByLabelText(label!), { target: { value } });
    }
    fireEvent.click(within(create).getByRole('button', { name: 'Create class' }));
    await screen.findByText('Class created. Manage this section from the owner console.');
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const created = lastCall('POST', '/api/classes');
    assert.equal(created?.status, 201);
    const classId = String(created.response?.class.id);
    assert.ok(classId && classId !== 'undefined');
    assert.equal(created.response?.class.role, null);
    assert.equal(created.response?.class.memberCount, 0);
    assert.equal(
      (
        await db.execute({
          sql: 'SELECT COUNT(*) AS n FROM memberships WHERE class_id=? AND user_id=?',
          args: [classId, DEMO_USERS.master.id],
        })
      ).rows[0].n,
      0,
    );
    // The directory should reflect a class created from this same dashboard.
    await screen.findByRole('heading', { level: 1, name: '6H UI Campus' });
    assert.equal(ui.currentPath(), `/admin/classes/${classId}?view=people`);
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Owner dashboard' }));
    await waitFor(() =>
      assert.ok(
        within(screen.getByRole('button', { name: /Semester 6/ })).getByText(/1 sections?/),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Semester 6/ }));
    await screen.findByRole('heading', { name: 'Sections & classes' });
    const section = await screen.findByRole('link', { name: /6H UI Campus/ });
    assert.ok(within(section).getByText(`Class ID: ${classId}`));
    fireEvent.click(section);
    await screen.findByRole('heading', { level: 1, name: '6H UI Campus' });
    await screen.findByRole('heading', { name: 'Your class community' });
    fireEvent.click(screen.getByRole('button', { name: 'Enroll a student' }));
    const enroll = await screen.findByRole('dialog', { name: 'Enroll a registered student' });
    assert.equal(
      within(enroll).queryByRole('button', { name: `Enroll ${DEMO_USERS.master.displayName}` }),
      null,
    );
    fireEvent.change(within(enroll).getByLabelText('Filter students to enroll'), {
      target: { value: '2412339' },
    });
    fireEvent.click(await within(enroll).findByRole('button', { name: 'Enroll Areeba Khan' }));
    await screen.findByText('Student enrolled. You can now assign their class role.');
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const membership = lastCall('POST', `/api/admin/classes/${classId}/members`);
    assert.equal(membership?.status, 200);
    assert.equal(membership.payload?.userId, DEMO_USERS.student.id);
    assert.equal(membership.response?.membership.role, 'student');
    const memberRow = (await screen.findByText('Areeba Khan')).closest('.person-row');
    assert.ok(memberRow);
    assert.ok(within(memberRow).getByText('2412339@szabist-isb.pk'));
    assert.ok(within(memberRow).getByText('Roll number: 2412339'));
    assert.ok(within(memberRow).getByText(`ID: ${DEMO_USERS.student.id}`));
    assert.ok(within(memberRow).getByText('Student'));
    fireEvent.click(within(memberRow).getByRole('button', { name: 'Change role for Areeba Khan' }));
    const grant = await screen.findByRole('dialog', { name: 'Assign a class role' });
    fireEvent.change(within(grant).getByLabelText('Class role'), { target: { value: 'admin' } });
    fireEvent.click(within(grant).getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    assert.equal(
      lastCall('PATCH', `/api/admin/classes/${classId}/members/${DEMO_USERS.student.id}/role`)
        ?.response?.role,
      'admin',
    );
    const promoted = (await screen.findByText('Areeba Khan')).closest('.person-row')!;
    assert.ok(within(promoted).getByText('Class Admin'));
    await switchRole('student', 'Areeba');
    assert.ok(screen.getByRole('button', { name: 'Create class' }));
    assert.ok(screen.queryByRole('link', { name: 'Owner dashboard' }) === null);

    // Remove the grant using the same owner controls; no fresh student identity is created.
    await switchRole('master', 'ZabSync');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Owner dashboard' }));
    await screen.findByRole('heading', { name: 'Find a section' });
    fireEvent.click(screen.getByRole('button', { name: /Semester 6/ }));
    fireEvent.click(await screen.findByRole('link', { name: /6H UI Campus/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change role for Areeba Khan' }));
    const demote = await screen.findByRole('dialog', { name: 'Assign a class role' });
    fireEvent.change(within(demote).getByLabelText('Class role'), { target: { value: 'student' } });
    fireEvent.click(within(demote).getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    assert.equal(
      lastCall('PATCH', `/api/admin/classes/${classId}/members/${DEMO_USERS.student.id}/role`)
        ?.response?.role,
      'student',
    );

    await switchRole('admin', 'Hamza');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Timetable' }));
    await screen.findByRole('heading', { level: 1, name: 'Timetable' });
    assert.equal((screen.getByLabelText('Your class') as HTMLSelectElement).value, DEMO_CLASS_ID);
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly class' }));
    const weekly = await screen.findByRole('dialog', { name: 'Add weekly class' });
    fireEvent.change(within(weekly).getByLabelText('Title'), {
      target: { value: 'UI Database Workshop' },
    });
    fireEvent.change(within(weekly).getByLabelText('Day'), { target: { value: '1' } });
    fireEvent.change(within(weekly).getByLabelText('Start time'), { target: { value: '15:15' } });
    fireEvent.change(within(weekly).getByLabelText('End time'), { target: { value: '16:30' } });
    fireEvent.change(within(weekly).getByLabelText('Teacher'), {
      target: { value: 'Professor UI Name' },
    });
    fireEvent.change(within(weekly).getByLabelText('Room'), { target: { value: 'Lab C' } });
    fireEvent.change(within(weekly).getByLabelText('Notes'), {
      target: { value: 'Bring database notes.' },
    });
    fireEvent.click(within(weekly).getByRole('button', { name: 'Add to class' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const entryCall = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/timetable`);
    assert.equal(entryCall?.status, 201);
    assert.equal(entryCall.payload?.weekday, 1);
    assert.equal(entryCall.payload?.teacher, 'Professor UI Name');
    assert.equal(entryCall.payload?.startTime, '15:15');
    const entryId = String(entryCall.response?.entry.id);
    assert.ok(entryId && entryId !== 'undefined');
    const weeklySession = (
      await screen.findByRole('heading', { name: 'UI Database Workshop' })
    ).closest('article');
    assert.ok(weeklySession);
    assert.ok(within(weeklySession).getByText('Professor UI Name'));
    assert.ok(within(weeklySession).getByText('3:15 pm'));
    assert.ok(within(weeklySession).getByText('4:30 pm'));
    fireEvent.click(screen.getByRole('button', { name: 'Manage weekly template & changes' }));
    assert.ok(screen.getByText(/Monday · 15:15–16:30 · Professor UI Name/));
    fireEvent.click(screen.getByRole('button', { name: 'Edit weekly UI Database Workshop' }));
    const editWeekly = await screen.findByRole('dialog', { name: 'Edit weekly class' });
    assert.equal(
      (within(editWeekly).getByLabelText('Teacher') as HTMLInputElement).value,
      'Professor UI Name',
    );
    fireEvent.change(within(editWeekly).getByLabelText('Room'), { target: { value: 'Lab D' } });
    fireEvent.click(within(editWeekly).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    assert.equal(lastCall('PATCH', `/api/timetable/${entryId}`)?.response?.entry.room, 'Lab D');
    const timetableRead = [...calls]
      .reverse()
      .find(
        (call) =>
          call.method === 'GET' && call.url.startsWith(`/api/classes/${DEMO_CLASS_ID}/timetable?`),
      );
    const monday = String(timetableRead?.response?.weekStart);
    assert.match(monday, /^\d{4}-\d{2}-\d{2}$/);
    const next = new Date(`${monday}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const tuesday = next.toISOString().slice(0, 10);
    fireEvent.click(screen.getByRole('button', { name: 'One-time change' }));
    const change = await screen.findByRole('dialog', { name: 'Add schedule change' });
    fireEvent.change(within(change).getByLabelText('Change type'), {
      target: { value: 'rescheduled' },
    });
    fireEvent.change(within(change).getByLabelText('Weekly class'), { target: { value: entryId } });
    fireEvent.change(within(change).getByLabelText('Original class date'), {
      target: { value: monday },
    });
    fireEvent.change(within(change).getByLabelText('New date'), { target: { value: tuesday } });
    fireEvent.change(within(change).getByLabelText('Start time'), { target: { value: '15:45' } });
    fireEvent.change(within(change).getByLabelText('End time'), { target: { value: '17:00' } });
    assert.equal(
      (within(change).getByLabelText('Teacher') as HTMLInputElement).value,
      'Professor UI Name',
    );
    assert.equal((within(change).getByLabelText('Room') as HTMLInputElement).value, 'Lab D');
    fireEvent.change(within(change).getByLabelText('Teacher'), { target: { value: '' } });
    fireEvent.change(within(change).getByLabelText('Room'), { target: { value: '' } });
    fireEvent.change(within(change).getByLabelText('Notes'), {
      target: { value: 'This occurrence moves to Tuesday only.' },
    });
    fireEvent.click(within(change).getByRole('button', { name: 'Add to class' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const rescheduled = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`);
    assert.equal(rescheduled?.status, 201);
    assert.equal(rescheduled.payload?.entryId, entryId);
    assert.equal(rescheduled.payload?.originalDate, monday);
    assert.equal(rescheduled.payload?.date, tuesday);
    assert.equal(rescheduled.payload?.teacher, '');
    assert.equal(rescheduled.payload?.room, '');
    assert.equal(rescheduled.response?.exception.teacher, '');
    assert.equal(rescheduled.response?.exception.room, '');
    const movedSession = (
      await within(screen.getByRole('region', { name: 'Tuesday' })).findByRole('heading', {
        name: 'UI Database Workshop',
      })
    ).closest('article');
    assert.ok(movedSession);
    assert.ok(within(movedSession).getByText('Rescheduled'));
    assert.ok(within(movedSession).queryByText('Professor UI Name') === null);
    assert.ok(within(movedSession).queryByText('Lab D') === null);
    assert.ok(within(movedSession).getByText('3:45 pm'));
    assert.ok(
      screen.getByText(/Monday · 15:15–16:30 · Professor UI Name/),
      'The weekly template must remain unchanged after a one-time move.',
    );

    fireEvent.click(mainNavigation().getByRole('link', { name: 'Deadlines' }));
    await screen.findByRole('heading', { level: 1, name: 'Deadlines' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add deadline' }));
    const deadline = await screen.findByRole('dialog', { name: 'Add deadline' });
    fireEvent.change(within(deadline).getByLabelText('Type'), { target: { value: 'quiz' } });
    fireEvent.change(within(deadline).getByLabelText('Title'), {
      target: { value: 'UI Transactions Quiz' },
    });
    fireEvent.change(within(deadline).getByLabelText('Due date'), { target: { value: tuesday } });
    fireEvent.change(within(deadline).getByLabelText('Due time'), { target: { value: '18:00' } });
    fireEvent.change(within(deadline).getByLabelText('Details'), {
      target: { value: 'Revise joins and transaction isolation.' },
    });
    fireEvent.click(within(deadline).getByRole('button', { name: 'Add to class' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    await screen.findByRole('heading', { name: 'UI Transactions Quiz' });
    const deadlineCall = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/deadlines`);
    assert.equal(deadlineCall?.status, 201);
    assert.equal(deadlineCall.payload?.kind, 'quiz');
    assert.equal(deadlineCall.payload?.dueDate, tuesday);
    const deadlineId = String(deadlineCall.response?.deadline.id);
    assert.ok(deadlineId && deadlineId !== 'undefined');

    await switchRole('student', 'Areeba');
    assert.ok(screen.queryByRole('button', { name: 'Create class' }) === null);
    assert.ok(screen.queryByRole('link', { name: 'Owner dashboard' }) === null);
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Timetable' }));
    await screen.findByRole('heading', { level: 1, name: 'Timetable' });
    const originalSession = (
      await within(screen.getByRole('region', { name: 'Monday' })).findByRole('heading', {
        name: 'UI Database Workshop',
      })
    ).closest('article');
    assert.ok(originalSession);
    assert.ok(within(originalSession).getByText('Moved'));
    const destinationLabel = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${tuesday}T12:00:00Z`));
    fireEvent.click(within(originalSession).getByRole('button', { name: destinationLabel }));
    const readOnly = (
      await within(screen.getByRole('region', { name: 'Tuesday' })).findByRole('heading', {
        name: 'UI Database Workshop',
      })
    ).closest('article');
    assert.ok(readOnly);
    assert.ok(within(readOnly).getByText('Rescheduled'));
    assert.ok(within(readOnly).getByText('3:45 pm'));
    assert.ok(within(readOnly).queryByText('Professor UI Name') === null);
    assert.ok(within(readOnly).queryByText('Lab D') === null);
    for (const name of ['Weekly class', 'One-time change', 'Manage weekly template & changes']) {
      assert.ok(screen.queryByRole('button', { name }) === null);
    }
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Deadlines' }));
    await screen.findByRole('heading', { level: 1, name: 'Deadlines' });
    const studentDeadline = (
      await screen.findByRole('heading', { name: 'UI Transactions Quiz' })
    ).closest('article');
    assert.ok(studentDeadline);
    assert.ok(within(studentDeadline).getByText('Revise joins and transaction isolation.'));
    assert.ok(screen.queryByRole('button', { name: 'Add deadline' }) === null);
    assert.ok(screen.queryByRole('button', { name: /^Edit deadline|^Remove deadline/ }) === null);
    fireEvent.click(
      within(studentDeadline).getByRole('button', { name: 'Mark complete: UI Transactions Quiz' }),
    );
    await screen.findByRole('button', { name: 'Mark incomplete: UI Transactions Quiz' });
    const completion = lastCall('PATCH', `/api/deadlines/${deadlineId}/completion`);
    assert.equal(completion?.status, 200);
    assert.equal(completion.payload?.completed, true);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Deadline status' })).getByRole('button', {
        name: 'Completed',
      }),
    );
    await screen.findByRole('heading', { name: 'UI Transactions Quiz' });
    assert.ok(screen.getByRole('button', { name: 'Mark incomplete: UI Transactions Quiz' }));
    await switchRole('admin', 'Hamza');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Deadlines' }));
    await screen.findByRole('heading', { level: 1, name: 'Deadlines' });
    await screen.findByRole('button', { name: 'Mark complete: UI Transactions Quiz' });
    assert.equal(
      screen.queryByRole('button', { name: 'Mark incomplete: UI Transactions Quiz' }),
      null,
      'Completion belongs only to the student who marked it.',
    );
    ui.assertNoApiErrors();
  },
);
