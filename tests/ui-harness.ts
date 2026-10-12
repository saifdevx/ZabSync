import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { createTestApp, type TestApp, type TestAppOptions } from './helpers.js';

export type TransportCall = {
  method: string;
  url: string;
  contentType: string;
  payload?: Record<string, unknown>;
  status: number;
  response?: Record<string, any>;
};

/** Actual React app + native multipart serialization + real Fastify/SQLite.
 * These are platform adapters for jsdom, never replacement API responses.
 */
export async function renderApplication(
  t: TestContext,
  options: {
    app?: TestApp;
    appOptions?: TestAppOptions;
    initialPath?: string;
  } = {},
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:5173',
    pretendToBeVisual: true,
  });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const installGlobal = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const NativeRequest = Request,
    NativeResponse = Response,
    NativeFile = File;
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
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    indexedDB: new IDBFactory(),
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    installGlobal(key, value);
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
  let copiedText = '';
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copiedText = value;
      },
    },
  });
  const pendingRequests = new Set<Promise<Response>>();
  let cleanupReact = () => {};
  t.after(async () => {
    cleanupReact();
    await Promise.allSettled([...pendingRequests]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const app = options.app ?? (await createTestApp(t, options.appOptions));
  if (options.app)
    t.after(async () => {
      await app.close();
    });
  const calls: TransportCall[] = [];
  const requestTransport = (async (input, init = {}) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
          'Cache-Control': String(result.headers['cache-control'] ?? 'private, no-store'),
        },
      },
    );
  }) satisfies typeof fetch;
  installGlobal('fetch', ((input, init) => {
    const pending = requestTransport(input, init);
    pendingRequests.add(pending);
    void pending.then(
      () => pendingRequests.delete(pending),
      () => pendingRequests.delete(pending),
    );
    return pending;
  }) satisfies typeof fetch);
  // Install the document before importing React DOM and Testing Library.
  const [React, router, testing, auth, components, application] = await Promise.all([
    import('react'),
    import('react-router-dom'),
    import('@testing-library/react'),
    import('../client/src/auth.js'),
    import('../client/src/components.js'),
    import('../client/src/App.js'),
  ]);
  const { render, screen, fireEvent, waitFor, within, configure } = testing;
  let navigateTo!: ReturnType<typeof router.useNavigate>;
  let currentRoute = '';
  function RouteProbe() {
    navigateTo = router.useNavigate();
    const location = router.useLocation();
    currentRoute = `${location.pathname}${location.search}`;
    return null;
  }
  cleanupReact = testing.cleanup;
  configure({ asyncUtilTimeout: 5_000 });
  render(
    React.createElement(
      router.MemoryRouter,
      { initialEntries: [options.initialPath ?? '/'] },
      React.createElement(
        auth.AuthProvider,
        null,
        React.createElement(
          components.ToastProvider,
          null,
          React.createElement(
            React.Fragment,
            null,
            React.createElement(application.default),
            React.createElement(RouteProbe),
          ),
        ),
      ),
    ),
  );
  const mainNavigation = () => within(screen.getByRole('navigation', { name: 'Main navigation' }));
  const switchRole = async (persona: 'student' | 'admin' | 'master', name: string) => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch demo role' }), {
      target: { value: persona },
    });
    await screen.findByRole('heading', {
      level: 1,
      name:
        persona === 'master'
          ? 'Your campus. Your control.'
          : new RegExp(`^Good (morning|afternoon|evening), ${name}\\.$`),
    });
    await waitFor(() =>
      assert.equal(
        (screen.getByRole('combobox', { name: 'Switch demo role' }) as HTMLSelectElement).disabled,
        false,
      ),
    );
  };
  const lastCall = (method: string, url: string) =>
    [...calls].reverse().find((call) => call.method === method && call.url === url);
  const assertNoApiErrors = () =>
    assert.deepEqual(
      calls.filter((call) => call.status >= 400),
      [],
      'All rendered actions must complete without unexpected API errors.',
    );
  return {
    dom,
    app,
    calls,
    screen,
    fireEvent,
    waitFor,
    within,
    mainNavigation,
    switchRole,
    lastCall,
    assertNoApiErrors,
    NativeFile,
    copied: () => copiedText,
    navigate: async (path: string) => {
      await testing.act(async () => {
        navigateTo(path);
      });
    },
    currentPath: () => currentRoute,
  };
}
