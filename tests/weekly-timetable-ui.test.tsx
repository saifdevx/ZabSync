import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CLASS_ID } from '../server/demo.js';
import { addCalendarDays } from '../server/schedule.js';
import { renderApplication } from './ui-harness.js';

test(
  'the full weekly board preserves recurring edits and dated moves, then opens all saved days read-only for a student',
  { timeout: 180_000 },
  async (t) => {
    const ui = await renderApplication(t);
    const { screen, fireEvent, waitFor, within, mainNavigation, switchRole, lastCall, calls, dom } =
      ui;
    const { act } = await import('@testing-library/react');
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const board = () => screen.getByRole('region', { name: 'Weekly timetable' });
    const day = (name: string) => within(board()).getByRole('region', { name });
    const closeAfterSave = async () =>
      waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
    const assertWholeWeek = () => {
      for (const name of weekdays) assert.ok(within(board()).getByRole('region', { name }));
      assert.ok(
        screen.queryByRole('group', { name: 'Choose timetable day' }) === null,
        'A student must not have to select a day to see its classes.',
      );
    };
    const assertNoSharedEdits = () => {
      for (const name of ['Weekly class', 'One-time change', 'Manage weekly template & changes'])
        assert.ok(within(board()).queryByRole('button', { name }) === null);
      assert.ok(within(board()).queryByRole('button', { name: /Add weekly class on/ }) === null);
      assert.ok(
        within(board()).queryByRole('button', {
          name: /Edit weekly|Remove weekly|Edit change|Remove change/,
        }) === null,
      );
    };

    fireEvent.click(await screen.findByRole('button', { name: /^Class Admin/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Hamza\.$/,
    });
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Timetable' }));
    await screen.findByRole('heading', { level: 1, name: 'Timetable' });
    await within(board()).findByRole('region', { name: 'Monday' });
    assertWholeWeek();
    assert.ok(within(day('Monday')).getByRole('heading', { name: 'Demo: Operating Systems' }));
    assert.ok(within(day('Wednesday')).getByRole('heading', { name: 'Demo: Database Lab' }));
    assert.ok(within(day('Sunday')).getByText('No classes scheduled.'));

    fireEvent.click(
      within(day('Thursday')).getByRole('button', { name: 'Add weekly class on Thursday' }),
    );
    const add = await screen.findByRole('dialog', { name: 'Add weekly class' });
    assert.equal((within(add).getByLabelText('Day') as HTMLSelectElement).value, '4');
    for (const [label, value] of [
      ['Title', 'UI Thursday Seminar'],
      ['Start time', '13:10'],
      ['End time', '14:20'],
      ['Teacher', 'Example Teacher'],
      ['Room', 'Example Room A'],
    ])
      fireEvent.change(within(add).getByLabelText(label!), { target: { value } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add to class' }));
    await closeAfterSave();
    const created = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/timetable`);
    assert.equal(created?.status, 201);
    assert.equal(created.payload?.weekday, 4);
    const entryId = String(created.response?.entry.id);
    assert.ok(entryId && entryId !== 'undefined');
    const thursdaySession = (
      await within(day('Thursday')).findByRole('heading', { name: 'UI Thursday Seminar' })
    ).closest('article')!;
    for (const text of [
      '1:10 pm',
      '2:20 pm',
      'Teacher',
      'Example Teacher',
      'Room',
      'Example Room A',
    ])
      assert.ok(within(thursdaySession).getByText(text));
    assertWholeWeek();

    fireEvent.click(
      within(board()).getByRole('button', { name: 'Manage weekly template & changes' }),
    );
    fireEvent.click(
      within(board()).getByRole('button', { name: 'Edit weekly UI Thursday Seminar' }),
    );
    const edit = await screen.findByRole('dialog', { name: 'Edit weekly class' });
    fireEvent.change(within(edit).getByLabelText('Room'), { target: { value: 'Example Room B' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save changes' }));
    await closeAfterSave();
    const patched = lastCall('PATCH', `/api/timetable/${entryId}`);
    assert.equal(patched?.payload?.version, 1);
    assert.equal(patched?.response?.entry.version, 2);
    assert.equal(patched?.response?.entry.room, 'Example Room B');
    await within(board()).findByRole('button', { name: 'One-time change' });

    const firstWeek = String(
      [...calls]
        .reverse()
        .find(
          (call) =>
            call.method === 'GET' &&
            call.url.startsWith(`/api/classes/${DEMO_CLASS_ID}/timetable?`),
        )?.response?.weekStart,
    );
    assert.match(firstWeek, /^\d{4}-\d{2}-\d{2}$/);
    const originalDate = addCalendarDays(firstWeek, 3);
    const replacementDate = addCalendarDays(firstWeek, 8);
    fireEvent.click(within(board()).getByRole('button', { name: 'One-time change' }));
    const move = await screen.findByRole('dialog', { name: 'Add schedule change' });
    fireEvent.change(within(move).getByLabelText('Change type'), {
      target: { value: 'rescheduled' },
    });
    fireEvent.change(within(move).getByLabelText('Weekly class'), { target: { value: entryId } });
    fireEvent.change(within(move).getByLabelText('Original class date'), {
      target: { value: originalDate },
    });
    fireEvent.change(within(move).getByLabelText('New date'), {
      target: { value: replacementDate },
    });
    fireEvent.change(within(move).getByLabelText('Start time'), { target: { value: '15:00' } });
    fireEvent.change(within(move).getByLabelText('End time'), { target: { value: '16:10' } });
    fireEvent.click(within(move).getByRole('button', { name: 'Add to class' }));
    await closeAfterSave();
    const moved = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/schedule-exceptions`);
    assert.equal(moved?.status, 201);
    const exceptionId = String(moved.response?.exception.id);
    await waitFor(() => assert.ok(within(day('Thursday')).getByText('Moved')));
    const originalSession = within(day('Thursday'))
      .getByRole('heading', { name: 'UI Thursday Seminar' })
      .closest('article')!;
    fireEvent.click(within(originalSession).getByRole('button'));
    await waitFor(() => assert.ok(within(day('Tuesday')).getByText('Rescheduled')));
    assertWholeWeek();
    assert.ok(within(day('Tuesday')).getByText('3:00 pm'));
    assert.ok(
      within(day('Thursday')).getByText('1:10 pm'),
      'The following Thursday keeps its repeating routine.',
    );
    assert.ok(within(day('Thursday')).queryByText('Moved') === null);

    // A dated change uses its own ID and version, leaving the weekly entry intact.
    if (
      within(board())
        .getByRole('button', { name: 'Manage weekly template & changes' })
        .getAttribute('aria-expanded') !== 'true'
    )
      fireEvent.click(
        within(board()).getByRole('button', { name: 'Manage weekly template & changes' }),
      );
    fireEvent.click(
      within(board()).getByRole('button', { name: 'Remove change UI Thursday Seminar' }),
    );
    const remove = await screen.findByRole('dialog', { name: 'Remove this item?' });
    fireEvent.click(within(remove).getByRole('button', { name: 'Remove' }));
    await closeAfterSave();
    assert.equal(
      lastCall('DELETE', `/api/schedule-exceptions/${exceptionId}?version=1`)?.status,
      200,
    );
    await waitFor(() => assert.ok(within(day('Tuesday')).getByText('No classes scheduled.')));
    assert.ok(within(day('Thursday')).getByRole('heading', { name: 'UI Thursday Seminar' }));
    fireEvent.click(within(board()).getByRole('button', { name: 'Previous week' }));
    await waitFor(() =>
      assert.ok(within(day('Thursday')).getByRole('heading', { name: 'UI Thursday Seminar' })),
    );
    assert.ok(
      within(day('Thursday')).queryByText('Moved') === null,
      'Removing a reschedule restores its original occurrence.',
    );

    // The owner opens a chosen section's planning from the directory, without
    // a student class picker or student navigation entering the owner workspace.
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch demo role' }), {
      target: { value: 'master' },
    });
    await screen.findByRole('heading', { level: 1, name: 'Your campus. Your control.' });
    fireEvent.click(await screen.findByRole('button', { name: /Semester 5/ }));
    fireEvent.click(await screen.findByRole('link', { name: /5D/ }));
    await screen.findByRole('heading', { level: 1, name: '5D' });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Class sections' })).getByRole('link', {
        name: 'Timetable',
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Timetable' });
    await within(board()).findByRole('region', { name: 'Monday' });
    assertWholeWeek();
    assert.ok(screen.queryByLabelText('Your class') === null);
    assert.ok(mainNavigation().queryByRole('link', { name: 'My classes' }) === null);
    assert.equal(
      screen.getByRole('link', { name: 'Back to section' }).getAttribute('href'),
      `/admin/classes/${DEMO_CLASS_ID}`,
    );
    assert.equal(
      screen.getByRole('link', { name: 'See deadlines' }).getAttribute('href'),
      `/admin/classes/${DEMO_CLASS_ID}/deadlines`,
    );
    assert.ok(within(board()).getByRole('button', { name: 'Weekly class' }));
    fireEvent.click(screen.getByRole('link', { name: 'See deadlines' }));
    await screen.findByRole('heading', { name: 'Class deadlines' });
    await screen.findByRole('heading', { name: 'Demo: OS practice quiz' });
    assert.ok(screen.getByRole('button', { name: 'Edit deadline Demo: OS practice quiz' }));
    assert.ok(screen.getByRole('button', { name: 'Add deadline' }));
    assert.ok(screen.queryByRole('group', { name: 'Deadline status' }) === null);
    assert.ok(screen.queryByRole('button', { name: /Mark complete:|Mark incomplete:/ }) === null);
    assert.ok(screen.queryByText(/Completion is your personal checklist/) === null);

    await switchRole('student', 'Areeba');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Deadlines' }));
    await screen.findByRole('heading', { name: 'Your deadlines' });
    await screen.findByRole('button', { name: 'Mark complete: Demo: OS practice quiz' });
    assert.ok(screen.getByRole('group', { name: 'Deadline status' }));
    assert.ok(screen.queryByRole('button', { name: 'Add deadline' }) === null);
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Timetable' }));
    await within(board()).findByRole('region', { name: 'Thursday' });
    assertWholeWeek();
    assertNoSharedEdits();
    assert.ok(within(day('Thursday')).getByText('Example Room B'));

    // Exercise the rendered opt-in flow, then block network transport entirely.
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Offline access' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare offline access' }));
    await screen.findByRole('heading', { name: 'Class information is saved.' });
    let online = true;
    const transport = globalThis.fetch;
    Object.defineProperty(dom.window.navigator, 'onLine', {
      configurable: true,
      get: () => online,
    });
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      if (!online) throw new TypeError('Network unavailable in the offline timetable test.');
      return transport(...args);
    }) as typeof fetch;
    await act(async () => {
      online = false;
      dom.window.dispatchEvent(new dom.window.Event('offline'));
    });
    await screen.findByRole('heading', { name: 'You’re reading your saved information.' });
    const onlineReads = calls.length;
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Timetable' }));
    await within(board()).findByRole('region', { name: 'Monday' });
    assertWholeWeek();
    assertNoSharedEdits();
    assert.ok(within(board()).getByText('Saved timetable · changes require a connection.'));
    fireEvent.click(within(board()).getByRole('button', { name: 'Next week' }));
    await waitFor(() => assert.ok(within(day('Thursday')).getByText('Example Room B')));
    assertWholeWeek();
    assertNoSharedEdits();
    assert.equal(
      calls.length,
      onlineReads,
      'Navigating a saved week must use the shared local resolver without network calls.',
    );
    ui.assertNoApiErrors();
  },
);
