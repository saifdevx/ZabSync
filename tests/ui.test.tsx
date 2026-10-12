import assert from 'node:assert/strict';
import test from 'node:test';
import { renderApplication } from './ui-harness.js';

test(
  'rendered students cannot create classes while a class admin creates directly, edits details and copies a real invite',
  { timeout: 30_000 },
  async (t) => {
    const ui = await renderApplication(t);
    const { screen, fireEvent, waitFor, within, switchRole, lastCall, calls } = ui;
    fireEvent.click(await screen.findByRole('button', { name: /^Student/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Areeba\.$/,
    });
    assert.ok(screen.queryByRole('button', { name: 'Create class' }) === null);
    assert.ok(screen.queryByRole('link', { name: 'Owner dashboard' }) === null);
    assert.ok(screen.getByRole('button', { name: 'Join a class' }));

    await switchRole('admin', 'Hamza');
    fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
    const createDialog = await screen.findByRole('dialog', { name: 'Create a class space' });
    for (const [label, value] of [
      ['Class name', '6F UI Test'],
      ['Program', 'BS Computer Science'],
      ['Semester', '6'],
      ['Section', 'F'],
    ]) {
      fireEvent.change(within(createDialog).getByLabelText(label!), { target: { value } });
    }
    fireEvent.change(within(createDialog).getByLabelText(/^Description/), {
      target: { value: 'A class created through the rendered application.' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create class' }));
    await screen.findByText('Class created. Open it from My classes.');
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const creation = lastCall('POST', '/api/classes');
    assert.equal(creation?.status, 201);
    assert.equal(creation.payload?.semester, 6);
    assert.equal(creation.response?.class.role, 'admin');
    const classId = String(creation.response?.class.id);
    assert.ok(classId && classId !== 'undefined');
    assert.equal(
      calls.some((call) => call.url.includes('class-requests')),
      false,
      'The current UI must never use the retired approval workflow.',
    );
    assert.ok(screen.queryByRole('link', { name: 'Owner dashboard' }) === null);

    fireEvent.click(await screen.findByRole('link', { name: /6F UI Test/ }));
    await screen.findByRole('heading', { level: 1, name: '6F UI Test' });
    assert.ok(screen.getAllByText('Class Admin').length > 0);
    fireEvent.click(screen.getByRole('button', { name: 'Class details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Edit class details' });
    assert.equal((within(editDialog).getByLabelText('Semester') as HTMLInputElement).value, '6');
    fireEvent.change(within(editDialog).getByLabelText('Class name'), {
      target: { value: '6F UI Edited' },
    });
    fireEvent.change(within(editDialog).getByLabelText(/^Description/), {
      target: { value: 'Edited through the rendered application.' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { level: 1, name: '6F UI Edited' });
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const edit = lastCall('PATCH', `/api/classes/${classId}`);
    assert.equal(edit?.status, 200);
    assert.deepEqual(Object.keys(edit.payload || {}).sort(), [
      'description',
      'name',
      'program',
      'section',
      'semester',
    ]);
    assert.equal(edit.payload?.semester, 6);
    assert.equal(edit.payload?.name, '6F UI Edited');

    fireEvent.click(screen.getByRole('button', { name: 'Create join code' }));
    const invitation = await screen.findByRole('dialog', { name: 'Invite your classmates' });
    fireEvent.click(within(invitation).getByRole('button', { name: 'Create join code' }));
    const codeDialog = await screen.findByRole('dialog', { name: 'Your class join code' });
    const invite = lastCall('POST', `/api/classes/${classId}/invite`);
    assert.equal(invite?.status, 200);
    const code = String(invite.response?.code);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    assert.ok(within(codeDialog).getByText(code));
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Copy join code' }));
    await waitFor(() => assert.equal(ui.copied(), code));
    assert.ok(within(codeDialog).getByRole('button', { name: 'Copied' }));
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    ui.assertNoApiErrors();
  },
);
