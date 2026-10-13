import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { DEMO_CLASS_ID } from '../server/demo.js';
import { renderApplication } from './ui-harness.js';

test(
  'rendered subject chat uses admin-selected posting, personal reminder opt-in and published help search',
  { timeout: 120_000 },
  async (t) => {
    const ui = await renderApplication(t, {
      appOptions: { now: () => new Date('2026-10-12T06:00:00.000Z') },
    });
    const { screen, fireEvent, waitFor, within } = ui;
    fireEvent.click(await screen.findByRole('button', { name: /^Class Admin/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Hamza\.$/,
    });
    await ui.navigate(`/subjects/${DEMO_SUBJECT_IDS.os}?tab=chat`);
    await screen.findByRole('heading', { name: 'Subject conversation' });
    const mode = await screen.findByRole('combobox', { name: 'Who can post?' });
    assert.equal((mode as HTMLSelectElement).value, 'admins');
    fireEvent.change(mode, { target: { value: 'members' } });
    await waitFor(() =>
      assert.equal(
        ui.lastCall('PATCH', `/api/subjects/${DEMO_SUBJECT_IDS.os}/chat/settings`)?.status,
        200,
      ),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message your subject' }), {
      target: { value: 'The quiz covers the shared process-scheduling notes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('The quiz covers the shared process-scheduling notes.', {
      selector: '.chat-message p',
    });
    // Demo deadlines are class-wide. Create a real subject deadline before a
    // student opens this subject's own deadline/reminder panel.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Subject sections' })).getByRole('button', {
        name: 'Deadlines',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add deadline' }));
    const deadline = await screen.findByRole('dialog', { name: 'Add deadline' });
    fireEvent.change(within(deadline).getByLabelText('Title'), {
      target: { value: 'Chat practice quiz' },
    });
    fireEvent.change(within(deadline).getByLabelText('Due date'), {
      target: { value: '2026-10-13' },
    });
    fireEvent.change(within(deadline).getByLabelText('Due time'), {
      target: { value: '12:00' },
    });
    fireEvent.click(within(deadline).getByRole('button', { name: 'Add to class' }));
    await screen.findByRole('heading', { name: 'Chat practice quiz' });
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
    );
    const deadlineId = String(
      ui.lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/deadlines`)?.response?.deadline.id,
    );
    await ui.switchRole('student', 'Areeba');
    await ui.navigate(`/subjects/${DEMO_SUBJECT_IDS.os}?tab=chat`);
    await screen.findByText('The quiz covers the shared process-scheduling notes.');
    assert.ok(
      screen.queryByRole('combobox', { name: 'Who can post?' }) === null,
      'Students cannot change the subject chat mode.',
    );
    assert.ok(
      screen.queryByRole('button', { name: 'Review reports' }) === null,
      'Students cannot review moderation reports.',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message your subject' }), {
      target: { value: 'Is the practice example included?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const own = (
      await screen.findByText('Is the practice example included?', {
        selector: '.chat-message p',
      })
    ).closest('.chat-message');
    assert.ok(own);
    fireEvent.click(within(own as HTMLElement).getByRole('button', { name: 'Edit' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit your message' });
    fireEvent.change(within(edit).getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Is the worked example in lecture 2 included?' },
    });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save message' }));
    await screen.findByText('Is the worked example in lecture 2 included?', {
      selector: '.chat-message p',
    });
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Subject sections' })).getByRole('button', {
        name: 'Deadlines',
      }),
    );
    const remind = await screen.findByRole('button', { name: 'Remind me' });
    fireEvent.click(remind);
    const preference = await screen.findByRole('dialog', { name: 'Your deadline reminder' });
    const enabled = await within(preference).findByRole('checkbox', {
      name: 'Remind me about this deadline',
    });
    await waitFor(() => assert.equal((enabled as HTMLInputElement).checked, false));
    fireEvent.click(enabled);
    fireEvent.change(within(preference).getByRole('combobox', { name: 'When' }), {
      target: { value: '15' },
    });
    fireEvent.click(within(preference).getByRole('button', { name: 'Save reminder' }));
    await waitFor(() => assert.ok(ui.lastCall('POST', `/api/deadlines/${deadlineId}/reminder`)));
    const reminder = ui.lastCall('POST', `/api/deadlines/${deadlineId}/reminder`);
    assert.equal(reminder?.status, 200, JSON.stringify(reminder?.response));
    assert.equal(reminder?.payload?.enabled, true);
    assert.equal(reminder?.payload?.offsetMinutes, 15);
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
    );
    await ui.navigate('/reminders');
    await screen.findByRole('heading', { level: 1, name: 'Reminders' });
    await screen.findByText(
      'Phone alerts are not configured yet. Your personal reminder inbox remains available.',
    );
    await ui.navigate('/help');
    await screen.findByRole('heading', { level: 1, name: 'How can we help?' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search help' }), {
      target: { value: 'offline' },
    });
    const title = await screen.findByRole('heading', {
      name: 'What works without an internet connection?',
    });
    const details = title.closest('details');
    assert.ok(details);
    fireEvent.click(title.closest('summary')!);
    assert.equal(details!.open, true);
    assert.match(details!.textContent || '', /a bookmark is not a download/i);
    await waitFor(() => assert.ok(ui.lastCall('GET', '/api/help?q=offline&offset=0&limit=20')));
    ui.assertNoApiErrors();
  },
);
