import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createTestApp } from './helpers.js';

type TransportCall = {
  method: string;
  url: string;
  payload: Record<string, unknown> | undefined;
  status: number;
  response: Record<string, unknown>;
};

test(
  'rendered demo workflow creates and approves a class, edits its details and copies a real invite',
  { timeout: 30_000 },
  async (t) => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost:5173',
      pretendToBeVisual: true,
    });
    const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
    const installGlobal = (key: string, value: unknown) => {
      originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    };
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
      MouseEvent: dom.window.MouseEvent,
      MutationObserver: dom.window.MutationObserver,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      installGlobal(key, value);

    // jsdom has no top-layer layout or system clipboard. These small platform
    // adapters preserve the dialog/open and copy semantics used by the app.
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
    dom.window.scrollTo = () => {};
    let copiedText = '';
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copiedText = text;
        },
      },
    });

    let cleanupReact = () => {};
    t.after(() => {
      cleanupReact();
      dom.window.close();
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });

    const app = await createTestApp(t);
    const calls: TransportCall[] = [];
    installGlobal('fetch', (async (input, init = {}) => {
      const path =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(path, dom.window.location.href);
      assert.equal(
        url.origin,
        dom.window.location.origin,
        'The component test must not contact an external service.',
      );
      assert.ok(url.pathname.startsWith('/api/'));
      const method = (init.method || 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      headers.host = 'localhost:3001';
      headers.origin = dom.window.location.origin;
      assert.ok(
        init.body === undefined || typeof init.body === 'string',
        'CP1 API requests must use JSON text bodies.',
      );
      const result = await app.inject({
        method,
        url: `${url.pathname}${url.search}`,
        headers,
        ...(init.body !== undefined ? { payload: init.body as string } : {}),
      });
      calls.push({
        method,
        url: `${url.pathname}${url.search}`,
        payload: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        status: result.statusCode,
        response: JSON.parse(result.body),
      });
      return new Response(result.body, {
        status: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }) satisfies typeof fetch);

    // Import React DOM/testing utilities only after a document exists. The app,
    // authentication provider and toast provider are the production components.
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

    fireEvent.click(await screen.findByRole('button', { name: /^Student/ }));
    await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Areeba\.$/ });
    fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
    const createDialog = await screen.findByRole('dialog', { name: 'Create a class space' });
    fireEvent.change(within(createDialog).getByLabelText('Class name'), {
      target: { value: '6F UI Test' },
    });
    fireEvent.change(within(createDialog).getByLabelText('Program'), {
      target: { value: 'BS Computer Science' },
    });
    fireEvent.change(within(createDialog).getByLabelText('Semester'), { target: { value: '6' } });
    fireEvent.change(within(createDialog).getByLabelText('Section'), { target: { value: 'F' } });
    fireEvent.change(within(createDialog).getByLabelText(/^Description/), {
      target: { value: 'A class created through the rendered application.' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Send request' }));
    await screen.findByText('Class request sent to the Master Admin.');
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    const createCall = calls.find(
      (call) => call.method === 'POST' && call.url === '/api/class-requests',
    );
    assert.equal(createCall?.status, 201);
    assert.equal(createCall.payload?.semester, 6);

    fireEvent.change(screen.getByRole('combobox', { name: 'Switch demo role' }), {
      target: { value: 'master' },
    });
    const masterNavigation = await screen.findByRole('link', { name: 'Master Admin' });
    fireEvent.click(masterNavigation);
    await screen.findByRole('heading', { name: 'Master control room' });
    const requestCard = (await screen.findByRole('heading', { name: '6F UI Test' })).closest(
      'article',
    );
    assert.ok(requestCard);
    fireEvent.click(within(requestCard).getByRole('button', { name: 'Review request' }));
    const reviewDialog = await screen.findByRole('dialog', { name: 'Review 6F UI Test' });
    fireEvent.change(within(reviewDialog).getByLabelText(/^Note to requester/), {
      target: { value: 'Approved through the real admin form.' },
    });
    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'Approve class' }));
    await screen.findByText('Class approved. Its requester is now the CR.');
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    const approveCall = calls.find(
      (call) => call.method === 'POST' && call.url.startsWith('/api/admin/class-requests/'),
    );
    assert.equal(approveCall?.status, 200);
    assert.equal(approveCall.response.status, 'approved');
    const classId = String(approveCall.response.classId);

    fireEvent.change(screen.getByRole('combobox', { name: 'Switch demo role' }), {
      target: { value: 'student' },
    });
    await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Areeba\.$/ });
    const approvedClass = await screen.findByRole('link', { name: /6F UI Test/ });
    fireEvent.click(approvedClass);
    await screen.findByRole('heading', { level: 1, name: '6F UI Test' });
    assert.ok(screen.getByText('Class representative'));
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
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    const editCall = calls.find(
      (call) => call.method === 'PATCH' && call.url === `/api/classes/${classId}`,
    );
    assert.equal(editCall?.status, 200);
    assert.deepEqual(Object.keys(editCall.payload || {}).sort(), [
      'description',
      'name',
      'program',
      'section',
      'semester',
    ]);
    assert.equal(editCall.payload?.semester, 6);
    assert.equal(editCall.payload?.name, '6F UI Edited');

    fireEvent.click(screen.getByRole('button', { name: 'Create join code' }));
    const invitationDialog = await screen.findByRole('dialog', { name: 'Invite your classmates' });
    fireEvent.click(within(invitationDialog).getByRole('button', { name: 'Create join code' }));
    const codeDialog = await screen.findByRole('dialog', { name: 'Your class join code' });
    const inviteCall = calls.find(
      (call) => call.method === 'POST' && call.url === `/api/classes/${classId}/invite`,
    );
    assert.equal(inviteCall?.status, 200);
    const code = String(inviteCall.response.code);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    assert.ok(within(codeDialog).getByText(code));
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Copy join code' }));
    await waitFor(() => assert.equal(copiedText, code));
    assert.ok(within(codeDialog).getByRole('button', { name: 'Copied' }));
    fireEvent.click(within(codeDialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  },
);
