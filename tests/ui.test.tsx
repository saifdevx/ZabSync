import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_CLASS_ID } from '../server/demo.js';
import { renderApplication } from './ui-harness.js';

test(
  'rendered students join subjects, owners create sections, and Class Admins create/edit subjects and copy their real join codes',
  { timeout: 180_000 },
  async (t) => {
    const ui = await renderApplication(t);
    const { screen, fireEvent, waitFor, within, switchRole, mainNavigation, lastCall, calls } = ui;
    fireEvent.click(await screen.findByRole('button', { name: /^Student/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Areeba\.$/,
    });
    assert.ok(
      screen.queryByRole('button', { name: /Create (class|section)/ }) === null,
      'Students cannot create sections.',
    );
    assert.ok(
      screen.queryByRole('link', { name: 'Owner dashboard' }) === null,
      'Students cannot access the owner dashboard.',
    );
    assert.ok(screen.getByRole('button', { name: 'Join a subject' }));

    await switchRole('master', 'ZabSync');
    assert.ok(
      mainNavigation().queryByRole('link', { name: /^My Class/ }) === null,
      'The owner navigation does not include a student class page.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create section' }));
    const createDialog = await screen.findByRole('dialog', { name: 'Create a class space' });
    for (const [label, value] of [
      ['Class name', '6F UI Test'],
      ['Program', 'BS Computer Science'],
      ['Semester', '6'],
      ['Section', 'F'],
    ])
      fireEvent.change(within(createDialog).getByLabelText(label!), { target: { value } });
    fireEvent.change(within(createDialog).getByLabelText(/^Description/), {
      target: { value: 'A section created through the rendered owner dashboard.' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create section' }));
    await screen.findByText('Class created. Manage this section from the owner console.');
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
    );
    const creation = lastCall('POST', '/api/classes');
    assert.equal(creation?.status, 201);
    assert.equal(creation.payload?.semester, 6);
    assert.equal(creation.response?.class.role, null);
    const classId = String(creation.response?.class.id);
    assert.ok(classId && classId !== 'undefined');
    assert.equal(
      calls.some((call) => call.url.includes('class-requests')),
      false,
    );
    await screen.findByRole('heading', { level: 1, name: '6F UI Test' });
    assert.equal(ui.currentPath(), `/admin/classes/${classId}?view=people`);
    fireEvent.click(screen.getByRole('button', { name: 'Class details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const editDialog = await screen.findByRole('dialog', { name: 'Edit class details' });
    assert.equal((within(editDialog).getByLabelText('Semester') as HTMLInputElement).value, '6');
    fireEvent.change(within(editDialog).getByLabelText('Class name'), {
      target: { value: '6F UI Edited' },
    });
    fireEvent.change(within(editDialog).getByLabelText(/^Description/), {
      target: { value: 'Edited through the rendered owner dashboard.' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { level: 1, name: '6F UI Edited' });
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
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

    await switchRole('admin', 'Hamza');
    assert.ok(
      screen.queryByRole('button', { name: /Create (class|section)/ }) === null,
      'A Class Admin cannot create sections.',
    );
    assert.ok(
      mainNavigation().queryByRole('link', { name: 'Owner dashboard' }) === null,
      'A Class Admin cannot access the owner dashboard.',
    );
    fireEvent.click(mainNavigation().getByRole('link', { name: 'My Subjects' }));
    await screen.findByRole('heading', { level: 1, name: 'My Subjects' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add subject' }));
    const subjectDialog = await screen.findByRole('dialog', { name: 'Add a subject' });
    fireEvent.change(within(subjectDialog).getByLabelText('Subject name'), {
      target: { value: 'Networks UI Test' },
    });
    fireEvent.change(within(subjectDialog).getByLabelText(/^Course code/), {
      target: { value: 'CS-NET' },
    });
    fireEvent.click(within(subjectDialog).getByRole('button', { name: 'Add subject' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Networks UI Test' }));
    await screen.findByRole('heading', { level: 1, name: 'Networks UI Test' });
    const subjectCreation = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/subjects`);
    assert.equal(subjectCreation?.status, 201);
    const subjectId = String(subjectCreation.response?.subject.id);
    fireEvent.click(screen.getByRole('button', { name: 'Edit subject' }));
    const subjectEdit = await screen.findByRole('dialog', { name: 'Edit subject' });
    fireEvent.change(within(subjectEdit).getByLabelText('Subject name'), {
      target: { value: 'Computer Networks UI' },
    });
    fireEvent.click(within(subjectEdit).getByRole('button', { name: 'Save subject' }));
    await screen.findByRole('heading', { level: 1, name: 'Computer Networks UI' });
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
    );
    assert.equal(lastCall('PATCH', `/api/subjects/${subjectId}`)?.status, 200);
    fireEvent.click(screen.getByRole('button', { name: 'Subject code' }));
    const codeDialog = await screen.findByRole('dialog', { name: 'Subject join code' });
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Create new code' }));
    await waitFor(() =>
      assert.equal(lastCall('POST', `/api/subjects/${subjectId}/invite`)?.status, 200),
    );
    const code = String(lastCall('POST', `/api/subjects/${subjectId}/invite`)?.response?.code);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    await within(codeDialog).findByText(code);
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Copy subject code' }));
    await waitFor(() => assert.equal(ui.copied(), code));
    assert.ok(within(codeDialog).getByRole('button', { name: 'Copied' }));
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Close dialog' }));

    await switchRole('student', 'Areeba');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'My Subjects' }));
    await screen.findByRole('heading', { level: 1, name: 'My Subjects' });
    await screen.findByRole('link', { name: 'OS Lab' });
    assert.ok(
      screen.queryByRole('link', { name: 'Computer Networks UI' }) === null,
      'Students cannot open subjects before joining them.',
    );
    assert.ok(
      screen.queryByRole('button', { name: 'Add subject' }) === null,
      'Students cannot create subjects.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Join a subject' }));
    const joinDialog = await screen.findByRole('dialog', { name: 'Join a subject' });
    fireEvent.change(within(joinDialog).getByLabelText('Subject join code'), {
      target: { value: code },
    });
    fireEvent.click(within(joinDialog).getByRole('button', { name: 'Request to join' }));
    await waitFor(() =>
      assert.equal(
        lastCall('POST', '/api/subjects/join')?.status,
        200,
        JSON.stringify(lastCall('POST', '/api/subjects/join')),
      ),
    );
    await screen.findByText('Subject joined. Open it from My Subjects.');
    fireEvent.click(await screen.findByRole('link', { name: 'Computer Networks UI' }));
    await screen.findByRole('heading', { level: 1, name: 'Computer Networks UI' });
    assert.equal(lastCall('POST', '/api/subjects/join')?.response?.membership.status, 'active');
    assert.ok(
      screen.queryByRole('button', { name: 'Edit subject' }) === null,
      'Enrolled students cannot edit their subject.',
    );
    assert.ok(
      screen.queryByRole('button', { name: 'Subject code' }) === null,
      'Enrolled students cannot manage subject join codes.',
    );
    assert.ok(
      screen.queryByRole('button', { name: 'Post announcement' }) === null,
      'Enrolled students cannot post announcements.',
    );
    ui.assertNoApiErrors();
  },
);
