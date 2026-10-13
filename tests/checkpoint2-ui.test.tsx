import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { createPrivateStorage } from '../server/storage.js';
import { renderApplication } from './ui-harness.js';

test(
  'rendered academic and profile workflows retain real sharing, saved items, private developer drafts and multipart photos',
  { timeout: 180_000 },
  async (t) => {
    const directory = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.ui-storage-'),
    );
    t.after(async () => rm(directory, { recursive: true, force: true }));
    const ui = await renderApplication(t, {
      appOptions: { storage: createPrivateStorage({ driver: 'local', localDirectory: directory }) },
    });
    const {
      screen,
      fireEvent,
      waitFor,
      within,
      mainNavigation,
      switchRole,
      lastCall,
      calls,
      NativeFile,
      dom,
    } = ui;
    const openDeveloperEditor = async () => {
      fireEvent.click(mainNavigation().getByRole('link', { name: 'Owner dashboard' }));
      await screen.findByRole('heading', { level: 1, name: 'Your campus. Your control.' });
      fireEvent.click(screen.getByRole('button', { name: 'Developer' }));
      await screen.findByRole('heading', { name: 'Meet the Developer' });
    };
    // A class admin creates a real subject with the rendered subject form.
    fireEvent.click(await screen.findByRole('button', { name: /^Class Admin/ }));
    await screen.findByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), Hamza\.$/,
    });
    fireEvent.click(await screen.findByRole('link', { name: /5D/ }));
    await screen.findByRole('heading', { level: 1, name: '5D' });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Class sections' })).getByRole('button', {
        name: 'Subjects',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add subject' }));
    const subjectDialog = await screen.findByRole('dialog', { name: 'Add a subject' });
    fireEvent.change(within(subjectDialog).getByLabelText('Subject name'), {
      target: { value: 'Operating Systems UI Lab' },
    });
    fireEvent.change(within(subjectDialog).getByLabelText(/^Course code/), {
      target: { value: 'OS-UI' },
    });
    fireEvent.change(within(subjectDialog).getByLabelText(/^Instructor/), {
      target: { value: 'Example Instructor' },
    });
    fireEvent.change(within(subjectDialog).getByLabelText(/^Description/), {
      target: { value: 'Process scheduling and operating system exercises.' },
    });
    fireEvent.click(within(subjectDialog).getByRole('radio', { name: 'teal' }));
    fireEvent.click(within(subjectDialog).getByRole('button', { name: 'Add subject' }));
    await waitFor(() => assert.ok(lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/subjects`)));
    const subjectCreate = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/subjects`);
    assert.equal(subjectCreate?.status, 201, JSON.stringify(subjectCreate?.response));
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    await screen.findByRole('link', { name: 'Operating Systems UI Lab' });
    assert.equal(subjectCreate.payload?.color, 'teal');
    assert.equal(subjectCreate.response?.subject.classId, DEMO_CLASS_ID);
    const subjectId = String(subjectCreate.response?.subject.id);

    // A class-wide notice is prominent on the student's home feed, with no edit controls.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Class sections' })).getByRole('button', {
        name: 'Announcements',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Post announcement' }));
    const announcementDialog = await screen.findByRole('dialog', { name: 'Post an announcement' });
    assert.equal(
      (within(announcementDialog).getByLabelText('Who should see this?') as HTMLSelectElement)
        .value,
      'class',
    );
    fireEvent.change(within(announcementDialog).getByLabelText('Title'), {
      target: { value: 'Class trip information' },
    });
    fireEvent.change(within(announcementDialog).getByLabelText('Details'), {
      target: { value: 'Meet at the campus gate at 8:00 AM. Bring your university ID.' },
    });
    fireEvent.change(within(announcementDialog).getByLabelText('Priority'), {
      target: { value: 'important' },
    });
    fireEvent.click(
      within(announcementDialog).getByRole('checkbox', { name: /Pin this announcement/ }),
    );
    fireEvent.click(
      within(announcementDialog).getByRole('button', { name: 'Publish announcement' }),
    );
    await screen.findByRole('heading', { name: 'Class trip information' });
    await waitFor(() =>
      assert.ok(screen.queryByRole('dialog') === null, 'The submitted dialog closes.'),
    );
    const noticeCreate = lastCall('POST', '/api/announcements');
    assert.equal(noticeCreate?.status, 201);
    assert.equal(noticeCreate.payload?.scope, 'class');
    assert.equal(noticeCreate.payload?.classId, DEMO_CLASS_ID);
    assert.equal(noticeCreate.payload?.pinned, true);
    const noticeId = String(noticeCreate.response?.announcement.id);
    assert.ok(noticeId && noticeId !== 'undefined');

    // A new subject does not silently enroll all section members. Its admin shares
    // a subject invitation through the real UI, then the student chooses to join.
    await ui.navigate(`/subjects/${subjectId}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Subject code' }));
    const inviteDialog = await screen.findByRole('dialog', { name: 'Subject join code' });
    fireEvent.click(within(inviteDialog).getByRole('button', { name: 'Create new code' }));
    const copyCode = await within(inviteDialog).findByRole('button', { name: 'Copy subject code' });
    fireEvent.click(copyCode);
    await waitFor(() => assert.match(ui.copied(), /^[A-Z0-9-]+$/));
    const subjectCode = ui.copied();
    fireEvent.click(within(inviteDialog).getByRole('button', { name: 'Close dialog' }));

    await switchRole('student', 'Areeba');
    const notice = (await screen.findByRole('heading', { name: 'Class trip information' })).closest(
      'article',
    );
    assert.ok(notice);
    assert.ok(within(notice).getByText(/5D · Whole class/));
    assert.ok(within(notice).getByText(/Meet at the campus gate/));
    assert.ok(
      within(notice).queryByRole('button', { name: /Edit announcement|Trash announcement/ }) ===
        null,
      'A student cannot edit or trash the class announcement.',
    );
    assert.ok(screen.queryByRole('button', { name: 'Post announcement' }) === null);
    fireEvent.click(within(notice).getByRole('button', { name: 'Save announcement' }));
    await within(notice).findByRole('button', { name: 'Unsave announcement' });
    assert.equal(
      lastCall('POST', `/api/bookmarks/announcement/${noticeId}`)?.response?.saved,
      true,
    );
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Saved items' }));
    await screen.findByRole('heading', { level: 1, name: 'Saved for later' });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Saved item type' })).getByRole('button', {
        name: 'Announcements',
      }),
    );
    const savedNotice = (
      await screen.findByRole('heading', { name: 'Class trip information' })
    ).closest('article');
    assert.ok(savedNotice);
    assert.ok(within(savedNotice).getByRole('button', { name: 'Unsave announcement' }));
    assert.ok(
      calls.some(
        (call) =>
          call.method === 'GET' &&
          call.url.startsWith('/api/announcements?') &&
          call.url.includes('saved=true') &&
          call.response?.announcements.some((item: { id: string }) => item.id === noticeId),
      ),
    );

    fireEvent.click(mainNavigation().getByRole('link', { name: 'My Subjects' }));
    await screen.findByRole('heading', { level: 1, name: 'My Subjects' });
    assert.ok(
      screen.queryByRole('link', { name: 'Operating Systems UI Lab' }) === null,
      'A new subject stays out of the student subject list until they join it.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Join a subject' }));
    const joinSubject = await screen.findByRole('dialog', { name: 'Join a subject' });
    fireEvent.change(within(joinSubject).getByLabelText('Subject join code'), {
      target: { value: subjectCode },
    });
    fireEvent.click(within(joinSubject).getByRole('button', { name: 'Request to join' }));
    await waitFor(() => assert.ok(lastCall('POST', '/api/subjects/join')));
    const joined = lastCall('POST', '/api/subjects/join');
    assert.equal(joined?.status, 200, JSON.stringify(joined?.response));
    assert.equal(joined?.response?.membership.classId, DEMO_CLASS_ID);
    assert.equal(joined?.response?.membership.subjectId, subjectId);
    assert.equal(joined?.response?.membership.status, 'active');
    await waitFor(() =>
      assert.ok(
        screen.queryByRole('dialog') === null,
        'The dialog closes after the action succeeds.',
      ),
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Operating Systems UI Lab' }));
    await screen.findByRole('heading', { level: 1, name: 'Operating Systems UI Lab' });
    assert.ok(screen.queryByRole('button', { name: 'Edit subject' }) === null);
    assert.ok(screen.queryByRole('button', { name: 'Add subject' }) === null);

    // The Developer introduction is private until the owner explicitly publishes it.
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Get the App' }));
    await screen.findByRole('heading', { level: 1, name: 'Your campus, one tap away' });
    fireEvent.click(screen.getByRole('link', { name: 'Open developer page' }));
    await screen.findByRole('heading', { level: 1, name: 'Meet the Developer' });
    await waitFor(() => assert.equal(lastCall('GET', '/api/developer')?.status, 200));
    assert.equal(lastCall('GET', '/api/developer')?.response?.developer, null);
    await screen.findByRole('heading', { name: 'An introduction is on its way.' });
    await switchRole('master', 'ZabSync');
    await openDeveloperEditor();
    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Example Developer' },
    });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Student developer' } });
    fireEvent.change(screen.getByLabelText('Your introduction'), {
      target: { value: 'I build practical tools that help students organize their classes.' },
    });
    fireEvent.change(screen.getByLabelText('Portfolio link'), {
      target: { value: 'https://example.org/portfolio' },
    });
    fireEvent.change(screen.getByLabelText('Updates from you'), {
      target: { value: 'A new campus project is in progress.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add an app' }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Study Helper' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'A small project for organizing study sessions.' },
    });
    fireEvent.change(screen.getByLabelText('App link'), {
      target: { value: 'https://example.org/study-helper' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save developer draft' }));
    await waitFor(() => assert.ok(lastCall('PATCH', '/api/admin/developer')));
    const draft = lastCall('PATCH', '/api/admin/developer');
    assert.equal(draft?.status, 200, JSON.stringify(draft?.response));
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('button', { name: 'Save developer draft' }) as HTMLButtonElement)
          .disabled,
        true,
      ),
    );
    assert.equal(draft.response?.developer.published, false);
    assert.deepEqual(draft.response?.developer.apps, [
      {
        name: 'Study Helper',
        description: 'A small project for organizing study sessions.',
        url: 'https://example.org/study-helper',
      },
    ]);
    const beforePrivateRead = calls.length;
    await switchRole('student', 'Areeba');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Get the App' }));
    await screen.findByRole('heading', { level: 1, name: 'Your campus, one tap away' });
    fireEvent.click(screen.getByRole('link', { name: 'Open developer page' }));
    await screen.findByRole('heading', { level: 1, name: 'Meet the Developer' });
    await waitFor(() =>
      assert.ok(
        calls
          .slice(beforePrivateRead)
          .some(
            (call) =>
              call.method === 'GET' &&
              call.url === '/api/developer' &&
              call.response?.developer === null,
          ),
      ),
    );
    await screen.findByRole('heading', { name: 'An introduction is on its way.' });
    assert.ok(screen.queryByRole('heading', { name: 'Example Developer' }) === null);
    await switchRole('master', 'ZabSync');
    await openDeveloperEditor();
    assert.equal(
      (screen.getByLabelText('Your name') as HTMLInputElement).value,
      'Example Developer',
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Publish developer details' }));
    const beforePublish = calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save & publish profile' }));
    await waitFor(() =>
      assert.ok(
        calls
          .slice(beforePublish)
          .some((call) => call.method === 'PATCH' && call.url === '/api/admin/developer'),
      ),
    );
    const published = lastCall('PATCH', '/api/admin/developer');
    assert.equal(published?.status, 200, JSON.stringify(published?.response));
    assert.equal(published?.response?.developer.published, true);
    await switchRole('student', 'Areeba');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Get the App' }));
    await screen.findByRole('heading', { level: 1, name: 'Your campus, one tap away' });
    fireEvent.click(screen.getByRole('link', { name: 'Open developer page' }));
    await screen.findByRole('heading', { level: 1, name: 'Meet the Developer' });
    const disclosure = (await screen.findByRole('heading', { name: 'Example Developer' })).closest(
      '.developer-profile-page',
    );
    assert.ok(disclosure, 'The published introduction is visible directly on its own page.');
    await within(disclosure).findByRole('heading', { name: 'Example Developer' });
    assert.ok(
      within(disclosure).getByText(
        'I build practical tools that help students organize their classes.',
      ),
    );
    assert.ok(within(disclosure).getByText('A new campus project is in progress.'));
    const portfolio = within(disclosure).getByRole('link', { name: 'Portfolio' });
    assert.equal(portfolio.getAttribute('href'), 'https://example.org/portfolio');
    assert.equal(portfolio.getAttribute('target'), '_blank');
    assert.equal(
      within(disclosure)
        .getByRole('link', { name: /Study Helper/ })
        .getAttribute('href'),
      'https://example.org/study-helper',
    );
    assert.ok(screen.queryByRole('button', { name: /Save.*profile/ }) === null);
    // Profile customization retains the verified identity and uses the real upload stack.
    fireEvent.click(screen.getByRole('link', { name: 'Open your account' }));
    await screen.findByRole('heading', { level: 1, name: 'Make yourself at home' });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Areeba UI' } });
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'Areeba_ui' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => assert.ok(lastCall('PATCH', '/api/me')));
    const profileSave = lastCall('PATCH', '/api/me');
    assert.equal(profileSave?.status, 200, JSON.stringify(profileSave?.response));
    assert.equal(profileSave.response?.user.username, 'areeba_ui');
    assert.equal(profileSave.response?.user.id, DEMO_USERS.student.id);
    assert.equal(profileSave.response?.user.email, DEMO_USERS.student.email);
    assert.equal(profileSave.response?.user.role, 'student');
    await screen.findByText('@areeba_ui');
    const image = await readFile(
      new URL('../client/public/icons/zabsync-icon.png', import.meta.url),
    );
    const photo = new NativeFile([new Uint8Array(image)], 'profile.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), {
      target: { files: [photo] },
    });
    await screen.findByRole('img', { name: 'Selected profile photo preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
    await waitFor(() => assert.ok(lastCall('POST', '/api/me/avatar')));
    const avatarSave = lastCall('POST', '/api/me/avatar');
    assert.equal(avatarSave?.status, 200, JSON.stringify(avatarSave?.response));
    assert.match(avatarSave.contentType, /^multipart\/form-data; boundary=/);
    assert.ok(avatarSave.response?.user.avatarVersion);
    await waitFor(() =>
      assert.ok(
        calls.some(
          (call) =>
            call.method === 'GET' &&
            call.url.startsWith(`/api/users/${DEMO_USERS.student.id}/avatar?`) &&
            call.status === 200,
        ),
      ),
    );
    await waitFor(() => assert.ok(dom.window.document.querySelector('.ops-profile-avatar img')));
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    const removeDialog = await screen.findByRole('dialog', { name: 'Remove your profile photo?' });
    fireEvent.click(within(removeDialog).getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => assert.ok(lastCall('DELETE', '/api/me/avatar')));
    const removedPhoto = lastCall('DELETE', '/api/me/avatar');
    assert.equal(removedPhoto?.status, 200, JSON.stringify(removedPhoto?.response));
    assert.equal(removedPhoto?.response?.user.avatarVersion, null);
    await waitFor(() =>
      assert.ok(dom.window.document.querySelector('.ops-profile-avatar img') === null),
    );
    ui.assertNoApiErrors();
  },
);
