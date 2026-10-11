import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { createPrivateStorage } from '../server/storage.js';
import { createTestApp } from './helpers.js';

type TransportCall = {
  method: string;
  url: string;
  contentType: string;
  payload?: Record<string, unknown>;
  status: number;
  response?: Record<string, any>;
};

test(
  'rendered checkpoint 2 workflow shares class notices, saves them, publishes a tutor, and customizes a student profile',
  { timeout: 45_000 },
  async (t) => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost:5173',
      pretendToBeVisual: true,
    });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const installGlobal = (key: string, value: unknown) => {
      descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    };
    const NativeRequest = Request;
    const NativeResponse = Response;
    const NativeFile = File;
    for (const [key, value] of Object.entries({
      window: dom.window,
      self: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      sessionStorage: dom.window.sessionStorage,
      localStorage: dom.window.localStorage,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      HTMLDialogElement: dom.window.HTMLDialogElement,
      Node: dom.window.Node,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      MouseEvent: dom.window.MouseEvent,
      MutationObserver: dom.window.MutationObserver,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      installGlobal(key, value);

    // jsdom lacks dialog top-layer layout. Preserve open/close semantics, without claiming
    // browser rendering or native focus validation. FormData/Request/Blob stay native so
    // the actual profile upload goes through real multipart serialization and decoding.
    Object.defineProperties(dom.window.HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value(this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
    dom.window.scrollTo = () => undefined;
    let cleanupReact: () => void = () => undefined;
    t.after(() => {
      cleanupReact();
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });

    const privateDirectory = await mkdtemp(
      join(fileURLToPath(new URL('.', import.meta.url)), '.ui-storage-'),
    );
    const app = await createTestApp(t, {
      storage: createPrivateStorage({ driver: 'local', localDirectory: privateDirectory }),
    });
    t.after(async () => rm(privateDirectory, { recursive: true, force: true }));
    const calls: TransportCall[] = [];
    installGlobal('fetch', (async (input, init = {}) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(path, dom.window.location.href);
      assert.equal(
        url.origin,
        dom.window.location.origin,
        'UI tests may not contact external services.',
      );
      assert.ok(url.pathname.startsWith('/api/'), 'UI transport accepts only the application API.');
      const serialized = new NativeRequest(url, init);
      const method = serialized.method as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      const headers = Object.fromEntries(new Headers(serialized.headers).entries());
      headers.host = 'localhost:3001';
      headers.origin = dom.window.location.origin;
      const contentType = headers['content-type'] ?? '';
      const bytes = serialized.body ? Buffer.from(await serialized.arrayBuffer()) : undefined;
      const result = await app.inject({
        method,
        url: `${url.pathname}${url.search}`,
        headers,
        ...(bytes ? { payload: bytes } : {}),
      });
      const json = String(result.headers['content-type'] ?? '').includes('application/json');
      calls.push({
        method,
        url: `${url.pathname}${url.search}`,
        contentType,
        payload:
          bytes && contentType.includes('application/json')
            ? JSON.parse(bytes.toString())
            : undefined,
        status: result.statusCode,
        response: json ? result.json() : undefined,
      });
      return new NativeResponse(
        result.statusCode === 204 ? null : new Uint8Array(result.rawPayload),
        {
          status: result.statusCode,
          headers: {
            'Content-Type': String(result.headers['content-type'] ?? 'application/octet-stream'),
          },
        },
      );
    }) satisfies typeof fetch);

    const [React, router, testing, auth, components, application] = await Promise.all([
      import('react'),
      import('react-router-dom'),
      import('@testing-library/react'),
      import('../client/src/auth.js'),
      import('../client/src/components.js'),
      import('../client/src/App.js'),
    ]);
    const { render, screen, fireEvent, waitFor, within, configure } = testing;
    cleanupReact = testing.cleanup;
    configure({ asyncUtilTimeout: 5_000 });
    render(
      React.createElement(
        router.MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement(
          auth.AuthProvider,
          null,
          React.createElement(
            components.ToastProvider,
            null,
            React.createElement(application.default),
          ),
        ),
      ),
    );

    const mainNavigation = () =>
      within(screen.getByRole('navigation', { name: 'Main navigation' }));
    const lastCall = (method: string, url: string) =>
      [...calls].reverse().find((call) => call.method === method && call.url === url);
    const switchRole = async (
      persona: 'student' | 'cr' | 'master',
      name = DEMO_USERS[persona].displayName.split(' ')[0],
    ) => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Switch demo role' }), {
        target: { value: persona },
      });
      await screen.findByRole('heading', {
        level: 1,
        name: new RegExp(`^Good (morning|afternoon|evening), ${name}\\.$`),
      });
      await waitFor(() =>
        assert.equal(
          (screen.getByRole('combobox', { name: 'Switch demo role' }) as HTMLSelectElement)
            .disabled,
          false,
        ),
      );
    };
    const openTutorEditor = async () => {
      fireEvent.click(mainNavigation().getByRole('link', { name: 'Master Admin' }));
      await screen.findByRole('heading', { level: 1, name: 'Master control room' });
      fireEvent.click(screen.getByRole('button', { name: 'Settings & Tutor' }));
      await screen.findByRole('heading', { name: 'Your tutor profile' });
    };

    // CR creates a real subject with the rendered subject form.
    fireEvent.click(await screen.findByRole('button', { name: /^Class representative/ }));
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
    await screen.findByRole('link', { name: 'Operating Systems UI Lab' });
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    const subjectCreate = lastCall('POST', `/api/classes/${DEMO_CLASS_ID}/subjects`);
    assert.equal(subjectCreate?.status, 201);
    assert.equal(subjectCreate.payload?.color, 'teal');
    assert.equal(subjectCreate.response?.subject.classId, DEMO_CLASS_ID);

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
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    const noticeCreate = lastCall('POST', '/api/announcements');
    assert.equal(noticeCreate?.status, 201);
    assert.equal(noticeCreate.payload?.scope, 'class');
    assert.equal(noticeCreate.payload?.classId, DEMO_CLASS_ID);
    assert.equal(noticeCreate.payload?.pinned, true);
    const noticeId = String(noticeCreate.response?.announcement.id);
    assert.ok(noticeId && noticeId !== 'undefined');

    await switchRole('student', 'Areeba');
    const notice = (await screen.findByRole('heading', { name: 'Class trip information' })).closest(
      'article',
    );
    assert.ok(notice);
    assert.ok(within(notice).getByText(/5D · Whole class/));
    assert.ok(within(notice).getByText(/Meet at the campus gate/));
    assert.equal(
      within(notice).queryByRole('button', { name: /Edit announcement|Trash announcement/ }),
      null,
    );
    assert.equal(screen.queryByRole('button', { name: 'Post announcement' }), null);
    fireEvent.click(within(notice).getByRole('button', { name: 'Save announcement' }));
    await within(notice).findByRole('button', { name: 'Unsave announcement' });
    assert.equal(
      lastCall('POST', `/api/bookmarks/announcement/${noticeId}`)?.response?.saved,
      true,
    );
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Saved for later' }));
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

    fireEvent.click(mainNavigation().getByRole('link', { name: /^My classes/ }));
    await screen.findByRole('heading', { level: 1, name: 'My classes' });
    fireEvent.click(screen.getByRole('link', { name: /5D/ }));
    await screen.findByRole('heading', { level: 1, name: '5D' });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Class sections' })).getByRole('button', {
        name: 'Subjects',
      }),
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Operating Systems UI Lab' }));
    await screen.findByRole('heading', { level: 1, name: 'Operating Systems UI Lab' });
    assert.equal(screen.queryByRole('button', { name: 'Edit subject' }), null);
    assert.equal(screen.queryByRole('button', { name: 'Add subject' }), null);

    // The owner saves a draft; students cannot see it until explicit publication.
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Tutor' }));
    await screen.findByRole('heading', { name: 'Tutor details are on their way.' });
    await switchRole('master');
    await openTutorEditor();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Example Tutor' } });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Systems and database tutor' },
    });
    fireEvent.change(screen.getByLabelText(/^About you/), {
      target: { value: 'I help students understand operating systems and database design.' },
    });
    fireEvent.change(screen.getByLabelText(/^Subjects and support/), {
      target: { value: 'Operating systems\nDatabase design' },
    });
    fireEvent.change(screen.getByLabelText('Contact button label'), {
      target: { value: 'Ask about tutoring' },
    });
    fireEvent.change(screen.getByLabelText('Contact link'), {
      target: { value: 'https://example.org/tutor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tutor draft' }));
    await screen.findByText('Tutor draft saved. Students cannot see it yet.');
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('button', { name: 'Save tutor draft' }) as HTMLButtonElement).disabled,
        true,
      ),
    );
    const draftSave = lastCall('PATCH', '/api/admin/tutor');
    assert.equal(draftSave?.status, 200);
    assert.equal(draftSave.response?.tutor.published, false);
    assert.deepEqual(draftSave.response?.tutor.subjects, ['Operating systems', 'Database design']);
    await switchRole('student', 'Areeba');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Tutor' }));
    await screen.findByRole('heading', { name: 'Tutor details are on their way.' });
    assert.equal(screen.queryByRole('heading', { name: 'Example Tutor' }), null);
    assert.equal(lastCall('GET', '/api/tutor')?.response?.tutor, null);
    await switchRole('master');
    await openTutorEditor();
    assert.equal((screen.getByLabelText('Name') as HTMLInputElement).value, 'Example Tutor');
    fireEvent.click(screen.getByRole('switch', { name: 'Publish tutor profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & publish profile' }));
    await screen.findByText('Tutor profile published.');
    assert.equal(lastCall('PATCH', '/api/admin/tutor')?.response?.tutor.published, true);
    await switchRole('student', 'Areeba');
    fireEvent.click(mainNavigation().getByRole('link', { name: 'Tutor' }));
    await screen.findByRole('heading', { name: 'Example Tutor' });
    assert.ok(
      screen.getByText('I help students understand operating systems and database design.'),
    );
    const contact = screen.getByRole('link', { name: 'Ask about tutoring' });
    assert.equal(contact.getAttribute('href'), 'https://example.org/tutor');
    assert.equal(contact.getAttribute('target'), '_blank');
    assert.equal(screen.queryByRole('button', { name: /Save.*profile/ }), null);

    // Profile customization retains the verified identity and uses the real upload stack.
    fireEvent.click(screen.getByRole('link', { name: 'Open your account' }));
    await screen.findByRole('heading', { level: 1, name: 'Make yourself at home' });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Areeba UI' } });
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'Areeba_ui' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await screen.findByText('Profile details saved.');
    const profileSave = lastCall('PATCH', '/api/me');
    assert.equal(profileSave?.status, 200);
    assert.equal(profileSave.response?.user.username, 'areeba_ui');
    assert.equal(profileSave.response?.user.id, DEMO_USERS.student.id);
    assert.equal(profileSave.response?.user.email, DEMO_USERS.student.email);
    assert.equal(profileSave.response?.user.role, 'student');
    assert.ok(screen.getByText('@areeba_ui'));
    const image = await readFile(new URL('../client/public/icons/xvia-icon.png', import.meta.url));
    const photo = new NativeFile([new Uint8Array(image)], 'profile.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), {
      target: { files: [photo] },
    });
    await screen.findByRole('img', { name: 'Selected profile photo preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
    await screen.findByText('Your profile photo has been updated.');
    const avatarSave = lastCall('POST', '/api/me/avatar');
    assert.equal(avatarSave?.status, 200);
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
    await screen.findByText('Profile photo removed.');
    assert.equal(lastCall('DELETE', '/api/me/avatar')?.response?.user.avatarVersion, null);
    await waitFor(() =>
      assert.equal(dom.window.document.querySelector('.ops-profile-avatar img'), null),
    );
    assert.equal(
      calls.filter((call) => call.status >= 400).length,
      0,
      JSON.stringify(calls.filter((call) => call.status >= 400)),
    );
  },
);
