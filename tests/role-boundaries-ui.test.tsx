import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_SUBJECT_IDS } from '../server/academic.js';
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, createTestApp, demoToken } from './helpers.js';
import { renderApplication } from './ui-harness.js';

test(
  'rendered class permissions stay local while the owner uses a separate section console and the Developer page stays visible',
  { timeout: 180_000 },
  async (t) => {
    const app = await createTestApp(t);
    const ownerToken = await demoToken(app, 'master');
    // A Class Admin is still a student of one section; ordinary enrollment cannot add a second.
    const secondSection = await app.inject({
      method: 'POST',
      url: `/api/admin/classes/${DEMO_OTHER_CLASS_ID}/members`,
      headers: bearer(ownerToken),
      payload: { userId: DEMO_USERS.admin.id },
    });
    assert.equal(secondSection.statusCode, 409);
    assert.equal(secondSection.json().error.code, 'section_conflict');
    const ui = await renderApplication(t, { app });
    const { screen, fireEvent, waitFor, within, mainNavigation, switchRole, lastCall } = ui;
    const noSharedEditing = () => {
      assert.ok(
        screen.queryByRole('button', {
          name: /^(Post announcement|Add subject|Upload resource|Edit subject|Move subject to trash|Subject code|Manage subjects|Edit details|Create section|Weekly class|One-time change|Add deadline|Manage weekly template & changes)$|^(Edit|Trash) announcement|^(Edit|Trash) resource/,
        }) === null,
        'Viewing a classroom must not grant shared editing controls.',
      );
      assert.ok(
        screen.queryByRole('dialog') === null,
        'Read-only classroom views have no editing dialog.',
      );
    };
    const classTab = (name: string) => {
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Class sections' })).getByRole('button', { name }),
      );
    };

    fireEvent.click(await screen.findByRole('button', { name: /^Student/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Areeba\.$/,
    });
    await screen.findByRole('heading', { name: 'Your class, in one place' });
    assert.ok(
      screen.queryByRole('link', { name: /4A/ }) === null,
      'Students cannot open another section from home.',
    );
    assert.ok(
      screen.queryByRole('heading', { name: 'Separate class sample notice' }) === null,
      'Another section’s announcement is not visible to this student.',
    );
    assert.ok(
      screen.queryByRole('button', { name: /Create (class|section)/ }) === null,
      'Students cannot create sections.',
    );
    assert.ok(
      mainNavigation().queryByRole('link', { name: 'Owner dashboard' }) === null,
      'Student navigation cannot access the owner dashboard.',
    );
    noSharedEditing();
    const developerCard = ui.dom.window.document.querySelector('.sidebar-developer');
    assert.ok(
      developerCard,
      'The Developer entry is a visible sidebar card, not a collapsed installation detail.',
    );
    assert.equal(developerCard.getAttribute('href'), '/developer');
    assert.ok(
      within(ui.dom.window.document.querySelector('.workspace-footer')!).getByRole('link', {
        name: 'Meet the Developer',
      }),
    );

    fireEvent.click(mainNavigation().getByRole('link', { name: 'Noticeboard' }));
    await screen.findByRole('heading', { level: 1, name: 'Your noticeboard' });
    await screen.findByRole('heading', { name: 'Your class, in one place' });
    noSharedEditing();
    assert.ok(
      screen.getAllByRole('button', { name: 'Save announcement' }).length > 0,
      'Personal bookmarks remain available to students.',
    );

    fireEvent.click(mainNavigation().getByRole('link', { name: /^My Class/ }));
    await screen.findByRole('heading', { level: 1, name: '5D' });
    assert.ok(
      screen.queryByRole('link', { name: /4A/ }) === null,
      'My Class does not offer access to another section.',
    );
    assert.equal(ui.currentPath(), `/classes/${DEMO_CLASS_ID}`);
    await screen.findByRole('heading', { name: 'Your class, in one place' });
    noSharedEditing();
    assert.equal(
      lastCall('GET', `/api/classes/${DEMO_CLASS_ID}?limit=50&offset=0`)?.response?.myRole,
      'student',
    );
    classTab('Subjects');
    await screen.findByRole('link', { name: 'OS Lab' });
    noSharedEditing();
    fireEvent.click(screen.getByRole('link', { name: 'OS Lab' }));
    await screen.findByRole('heading', { level: 1, name: 'OS Lab' });
    noSharedEditing();
    await ui.navigate(`/classes/${DEMO_CLASS_ID}`);
    await screen.findByRole('heading', { level: 1, name: '5D' });
    classTab('Resources');
    await screen.findByRole('heading', { name: 'Lecture resources' });
    noSharedEditing();
    classTab('Class details');
    await screen.findByRole('heading', { name: 'About this class' });
    noSharedEditing();
    await ui.navigate('/admin');
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Areeba\.$/,
    });
    assert.equal(ui.currentPath(), '/');

    await switchRole('admin', 'Hamza');
    await ui.navigate(`/classes/${DEMO_CLASS_ID}?view=announcements`);
    await screen.findByRole('heading', { level: 1, name: '5D' });
    assert.ok(await screen.findByRole('button', { name: 'Post announcement' }));
    classTab('Subjects');
    assert.ok(await screen.findByRole('button', { name: 'Add subject' }));
    await ui.navigate(`/classes/${DEMO_OTHER_CLASS_ID}?view=announcements`);
    await screen.findByRole('heading', { name: 'This is not your assigned section.' });
    assert.ok(
      screen.queryByRole('heading', { name: 'Separate class sample notice' }) === null,
      'A Class Admin cannot read another section’s announcements.',
    );
    noSharedEditing();
    assert.equal(
      lastCall('GET', `/api/classes/${DEMO_OTHER_CLASS_ID}?limit=50&offset=0`),
      undefined,
      'The section page rejects foreign navigation before requesting its content.',
    );
    await ui.navigate(`/subjects/${DEMO_SUBJECT_IDS.other}`);
    await waitFor(() =>
      assert.equal(lastCall('GET', `/api/subjects/${DEMO_SUBJECT_IDS.other}`)?.status, 404),
    );
    assert.ok(
      screen.queryByRole('heading', { level: 1, name: 'Separate class sample' }) === null,
      'A denied foreign subject does not render its content.',
    );
    noSharedEditing();
    for (const view of ['resources', 'settings']) {
      await ui.navigate(`/classes/${DEMO_OTHER_CLASS_ID}?view=${view}`);
      await screen.findByRole('heading', { name: 'This is not your assigned section.' });
      noSharedEditing();
    }
    // A forged planning query cannot select another section. The admin retains only 5D tools.
    await ui.navigate(`/timetable?class=${DEMO_OTHER_CLASS_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Timetable' });
    await screen.findByRole('region', { name: 'Monday' });
    assert.equal((screen.getByLabelText('Your class') as HTMLSelectElement).value, DEMO_CLASS_ID);
    assert.equal(within(screen.getByLabelText('Your class')).getAllByRole('option').length, 1);
    assert.ok(screen.getByRole('button', { name: 'Weekly class' }));
    await ui.navigate(`/deadlines?class=${DEMO_OTHER_CLASS_ID}`);
    await screen.findByRole('heading', { level: 1, name: 'Deadlines' });
    await waitFor(() =>
      assert.ok(
        ui.calls.some(
          (call) =>
            call.url.startsWith(`/api/classes/${DEMO_CLASS_ID}/deadlines?`) && call.status === 200,
        ),
      ),
    );
    assert.equal(
      ui.calls.some(
        (call) =>
          call.url.startsWith(`/api/classes/${DEMO_OTHER_CLASS_ID}/deadlines?`) ||
          call.url.startsWith(`/api/classes/${DEMO_OTHER_CLASS_ID}/timetable?`),
      ),
      false,
    );
    assert.equal((screen.getByLabelText('Your class') as HTMLSelectElement).value, DEMO_CLASS_ID);

    await switchRole('master', 'ZabSync');
    for (const name of [
      /^Home$/,
      /^My Class/,
      /^My Subjects$/,
      /^Timetable$/,
      /^Deadlines$/,
      /^Offline access$/,
      /^Saved items$/,
      /^Noticeboard$/,
    ]) {
      assert.ok(
        mainNavigation().queryByRole('link', { name }) === null,
        `Owner navigation does not include the student link ${name}.`,
      );
    }
    assert.ok(mainNavigation().getByRole('link', { name: 'Owner dashboard' }));
    assert.ok(mainNavigation().getByRole('link', { name: 'Meet the Developer' }));
    assert.ok(
      screen.queryByRole('button', { name: 'Join a subject' }) === null,
      'The owner account does not join subjects as a student.',
    );
    await ui.navigate('/classes');
    await screen.findByRole('heading', { level: 1, name: 'Your campus. Your control.' });
    assert.equal(ui.currentPath(), '/admin');
    await ui.navigate('/timetable');
    await waitFor(() => assert.equal(ui.currentPath(), '/admin'));
    await ui.navigate('/offline');
    await waitFor(() => assert.equal(ui.currentPath(), '/admin'));
    fireEvent.click(await screen.findByRole('button', { name: /Semester 4/ }));
    fireEvent.click(await screen.findByRole('link', { name: /4A/ }));
    await screen.findByRole('heading', { level: 1, name: '4A' });
    assert.equal(ui.currentPath(), `/admin/classes/${DEMO_OTHER_CLASS_ID}?view=people`);
    assert.ok(
      within(screen.getByRole('navigation', { name: 'Owner section breadcrumb' })).getByRole(
        'link',
        { name: 'Semester 4' },
      ),
    );
    assert.ok(
      screen.queryByRole('button', { name: /Create (class|section)/ }) === null,
      'Broad class creation belongs to the directory, not an open section.',
    );
    classTab('Announcements');
    fireEvent.click(await screen.findByRole('button', { name: 'Post announcement' }));
    const composer = await screen.findByRole('dialog', { name: 'Post an announcement' });
    fireEvent.change(within(composer).getByLabelText('Title'), {
      target: { value: 'Owner section notice' },
    });
    fireEvent.change(within(composer).getByLabelText('Details'), {
      target: { value: 'This notice belongs to section 4A only.' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: 'Publish announcement' }));
    await screen.findByRole('heading', { name: 'Owner section notice' });
    assert.equal(
      lastCall('POST', '/api/announcements')?.response?.announcement.classId,
      DEMO_OTHER_CLASS_ID,
    );
    const tabs = within(screen.getByRole('group', { name: 'Class sections' }));
    fireEvent.click(tabs.getByRole('link', { name: 'Timetable' }));
    await screen.findByRole('heading', { level: 1, name: 'Timetable' });
    assert.equal(ui.currentPath(), `/admin/classes/${DEMO_OTHER_CLASS_ID}/timetable`);
    assert.ok(
      screen.queryByLabelText('Your class') === null,
      'Owner planning is scoped by the open section, not an enrollment dropdown.',
    );
    assert.ok(await screen.findByRole('button', { name: 'Weekly class' }));
    await ui.navigate(`/subjects/${DEMO_SUBJECT_IDS.other}`);
    await screen.findByRole('heading', { level: 1, name: 'Separate class sample' });
    await waitFor(() =>
      assert.equal(
        ui.currentPath(),
        `/admin/classes/${DEMO_OTHER_CLASS_ID}/subjects/${DEMO_SUBJECT_IDS.other}`,
      ),
    );
    assert.ok(screen.getByRole('button', { name: 'Edit subject' }));

    fireEvent.click(mainNavigation().getByRole('link', { name: 'Meet the Developer' }));
    await screen.findByRole('heading', { level: 1, name: 'Meet the Developer' });
    await screen.findByRole('heading', { name: 'An introduction is on its way.' });
    fireEvent.click(screen.getByRole('link', { name: 'Edit Developer page' }));
    await screen.findByRole('heading', { name: 'Your Developer page' });
    assert.equal(ui.currentPath(), '/admin?tab=developer');
    assert.ok(await screen.findByRole('button', { name: 'Save developer draft' }));
    assert.ok(
      screen.queryByRole('button', { name: /Create (class|section)/ }) === null,
      'The Developer editor does not offer section creation.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'App controls' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Meet the Developer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save application settings' }));
    await screen.findByText('Application settings saved.');
    assert.equal(
      lastCall('PATCH', '/api/admin/settings')?.response?.settings.features.developer,
      false,
    );
    await switchRole('student', 'Areeba');
    fireEvent.click(ui.dom.window.document.querySelector('.sidebar-developer')!);
    await screen.findByRole('heading', { level: 1, name: 'Meet the Developer' });
    await screen.findByRole('heading', { name: 'The Developer page is temporarily unavailable.' });
    assert.ok(
      screen.queryByRole('link', { name: 'Edit Developer page' }) === null,
      'Students cannot edit the Developer page.',
    );
    assert.deepEqual(
      ui.calls
        .filter((call) => call.status >= 400)
        .map((call) => ({ method: call.method, url: call.url, status: call.status })),
      [{ method: 'GET', url: `/api/subjects/${DEMO_SUBJECT_IDS.other}`, status: 404 }],
      'Only the deliberately tested foreign subject lookup may be denied; all normal UI actions must succeed.',
    );
  },
);
