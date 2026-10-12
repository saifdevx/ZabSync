import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import type { AuthContextValue } from '../client/src/auth.js';
import type { OfflineAccess } from '../client/src/offline-store.js';
import type { MeResponse } from '../client/src/types.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, demoToken, expectSuccess } from './helpers.js';
import { offlineTestApp, pdf } from './offline-fixtures.js';

test('authenticated offline preparation reopens a verified account, blocks writes, clears across accounts, and honors real HTTP revocation', { timeout: 35_000 }, async (t) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173', pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const NativeRequest = Request, NativeResponse = Response, factory = new IDBFactory();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver, indexedDB: factory, IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
  let online = true;
  Object.defineProperty(dom.window.navigator, 'onLine', { configurable: true, get: () => online });
  const { app, db, upload, reader } = await offlineTestApp(t, () => new Date());
  const adminToken = await demoToken(app, 'admin');
  const resource = await upload(adminToken);
  const calls: { path: string; method: string; status: number }[] = [];
  let held: { path: string; wait: Promise<void> } | null = null;
  install('fetch', (async (input, options = {}) => {
    if (!online) throw new TypeError('Failed to fetch');
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, dom.window.location.href);
    assert.equal(url.origin, dom.window.location.origin);
    const request = new NativeRequest(url, options), headers = Object.fromEntries(request.headers.entries());
    headers.host = 'localhost:3001'; headers.origin = dom.window.location.origin;
    const result = await app.inject({ method: request.method as 'GET' | 'POST' | 'PATCH' | 'DELETE',
      url: `${url.pathname}${url.search}`, headers,
      ...(request.body ? { payload: Buffer.from(await request.arrayBuffer()) } : {}) });
    calls.push({ path: `${url.pathname}${url.search}`, method: request.method, status: result.statusCode });
    if (held && held.path === `${url.pathname}${url.search}`) await held.wait;
    return new NativeResponse(result.statusCode === 204 ? null : new Uint8Array(result.rawPayload), {
      status: result.statusCode, headers: { 'Content-Type': String(result.headers['content-type'] ?? 'application/json') } });
  }) satisfies typeof fetch);
  const React = await import('react'), testing = await import('@testing-library/react');
  const { AuthProvider, useAuth, ApiError } = await import('../client/src/auth.js');
  const { offlineStore, OfflineStore } = await import('../client/src/offline-store.js');
  const { buildOfflineSnapshot } = await import('../client/src/offline-data.js');
  const { useApi } = await import('../client/src/hooks.js');
  const { render, waitFor, cleanup } = testing;
  const act = async (work: () => unknown | Promise<unknown>) => testing.act(async () => {
    await work();
    // Offline change subscribers finish in later IndexedDB tasks. Read barriers let their
    // real transactions settle inside React's act boundary, without timers or mocked data.
    await offlineStore.active().catch(() => null);
    await offlineStore.active().catch(() => null);
  });
  let auth!: AuthContextValue;
  let feed!: ReturnType<typeof useApi<{ announcements: { id: string; scope: string }[] }>>;
  const currentUserId = () => auth.me?.user.id;
  function Probe() {
    auth = useAuth();
    feed = useApi<{ announcements: { id: string; scope: string }[] }>(auth.offline ? '/announcements?limit=100' : null);
    return null;
  }
  const mount = () => render(React.createElement(AuthProvider, null, React.createElement(Probe)));
  t.after(() => {
    cleanup(); dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  let tree = mount();
  await waitFor(() => assert.equal(auth.loading, false));
  assert.equal(auth.offlineEnabled, false);
  await act(async () => { await auth.demoLogin('admin'); });
  await waitFor(() => assert.equal(auth.me?.user.id, DEMO_USERS.admin.id));
  assert.equal(await offlineStore.snapshot(), null, 'An ordinary login must not enable private offline storage.');
  await act(async () => { await auth.prepareOffline(); });
  await waitFor(() => assert.equal(auth.offlineEnabled, true));
  assert.ok(auth.lastSyncedAt);
  await act(async () => { await auth.saveOfflineFile(resource); });
  assert.equal((await auth.listOfflineFiles()).length, 1);
  await act(async () => { assert.equal(await (await auth.getOfflineFile(resource.id)).text(), pdf); });

  online = false;
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event('offline')); });
  await waitFor(() => assert.equal(auth.offline, true));
  await waitFor(() => assert.ok(feed.data?.announcements.length));
  const lastCalls = calls.length;
  const timetable = await auth.request<{ entries: unknown[]; canManage: boolean }>(`/classes/${DEMO_CLASS_ID}/timetable`);
  assert.ok(timetable.entries.length); assert.equal(timetable.canManage, false);
  await assert.rejects(auth.request('/me', { method: 'PATCH', body: JSON.stringify({ displayName: 'Offline must not edit' }) }), (error: unknown) => error instanceof ApiError && error.code === 'OFFLINE_READ_ONLY');
  assert.equal(calls.length, lastCalls, 'Offline writes must not reach the transport or a queue.');
  assert.equal(await (await auth.requestBlob(`/resources/${resource.id}/download`)).text(), pdf);
  await assert.rejects(auth.requestBlob(`/users/${DEMO_USERS.admin.id}/avatar`), /Save this file/);
  await assert.rejects(auth.request('/admin/overview'), /not available offline/);

  // Another tab learns of a deleted notice. Permission pruning must refresh already-mounted queries,
  // even though neither the account, offline mode, nor the last successful full-sync timestamp changes.
  const removedNotice = feed.data!.announcements.find((item) => item.scope === 'class')!;
  assert.ok(removedNotice);
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/announcements/${removedNotice.id}`, headers: bearer(adminToken) }));
  const syncedBeforePrune = auth.lastSyncedAt, beforePrune = (await offlineStore.snapshot())!;
  const changedAccess = await reader(adminToken)<OfflineAccess>('/offline/access');
  await act(async () => {
    await offlineStore.revalidate(beforePrune.lease, changedAccess, await reader(adminToken)<MeResponse>('/me'));
  });
  await waitFor(() => {
    assert.ok(feed.data);
    assert.ok(!feed.data.announcements.some((item) => item.id === removedNotice.id));
  });
  assert.equal(auth.lastSyncedAt, syncedBeforePrune); assert.equal(auth.offline, true);

  // A completely new tab has no demo token, yet explicit previous verification permits a read-only saved view.
  await act(async () => tree.unmount());
  dom.window.sessionStorage.removeItem('zabsync.demo.token');
  const loginCalls = calls.filter((call) => call.path === '/api/demo/session').length;
  tree = mount();
  await waitFor(() => { assert.equal(auth.offline, true); assert.equal(auth.loading, false); });
  assert.equal(currentUserId(), DEMO_USERS.admin.id); assert.equal(auth.verified, true);
  assert.equal(calls.filter((call) => call.path === '/api/demo/session').length, loginCalls);
  assert.equal(dom.window.sessionStorage.getItem('zabsync.demo.token'), null);
  assert.equal(await (await auth.getOfflineFile(resource.id)).text(), pdf);

  online = true;
  await act(async () => { await auth.reconnect(); });
  await waitFor(() => { assert.equal(auth.loading, false); assert.equal(auth.signedIn, false); });
  assert.equal(auth.me, null, 'A saved identity cannot become an editable online login without credentials.');
  await act(async () => { await auth.demoLogin('student'); });
  await waitFor(() => assert.equal(auth.me?.user.id, DEMO_USERS.student.id));
  assert.equal(auth.offlineEnabled, false); assert.equal(await offlineStore.snapshot(), null);
  assert.deepEqual(await auth.listOfflineFiles(), []);
  await act(async () => { await auth.prepareOffline(); });
  assert.ok(await offlineStore.snapshot(DEMO_USERS.student.id));

  // A real 403 may not turn into a cached response, even though the browser has a fresh snapshot.
  await act(async () => {
    await assert.rejects(auth.request('/admin/overview'), (error: unknown) => error instanceof ApiError && error.status === 403);
  });
  assert.equal(auth.offline, false); assert.equal(await offlineStore.snapshot(), null);
  assert.equal(currentUserId(), DEMO_USERS.student.id);
  await act(async () => { await auth.prepareOffline(); });
  await db.execute({ sql: 'DELETE FROM demo_sessions WHERE user_id=?', args: [DEMO_USERS.student.id] });
  await act(async () => {
    await assert.rejects(auth.request('/me'), (error: unknown) => error instanceof ApiError && error.status === 401);
  });
  assert.equal(await offlineStore.snapshot(), null); assert.equal(auth.me, null); assert.equal(auth.signedIn, false);

  // A slow previous-account read cannot populate the new account or recreate its deleted snapshot.
  await act(async () => { await auth.demoLogin('admin'); });
  await waitFor(() => assert.equal(auth.me?.user.id, DEMO_USERS.admin.id));
  let release!: () => void;
  const previousAccessReads = calls.filter((call) => call.path === '/api/offline/access').length;
  held = { path: '/api/offline/access', wait: new Promise<void>((resolve) => { release = resolve; }) };
  let oldJob!: Promise<unknown>;
  await act(async () => {
    oldJob = auth.prepareOffline().then(() => 'unexpected-success', (error) => error);
    await waitFor(() => assert.ok(calls.filter((call) => call.path === held!.path).length > previousAccessReads));
  });
  await act(async () => { await auth.demoLogin('student'); });
  await waitFor(() => assert.equal(auth.me?.user.id, DEMO_USERS.student.id));
  held = null;
  await act(async () => { release(); await oldJob; });
  assert.equal((await oldJob as Error).name, 'AbortError');
  assert.equal(currentUserId(), DEMO_USERS.student.id); assert.equal(await offlineStore.snapshot(), null);

  // Explicit Clear cancels an already-started preparation, while retaining the online login.
  const beforeClearReads = calls.filter((call) => call.path === '/api/offline/access').length;
  held = { path: '/api/offline/access', wait: new Promise<void>((resolve) => { release = resolve; }) };
  let clearedJob!: Promise<unknown>;
  await act(async () => {
    clearedJob = auth.prepareOffline().then(() => 'unexpected-success', (error) => error);
    await waitFor(() => assert.ok(calls.filter((call) => call.path === held!.path).length > beforeClearReads));
  });
  await act(async () => { await auth.clearOffline(); });
  held = null;
  await act(async () => { release(); await clearedJob; });
  assert.equal((await clearedJob as Error).name, 'AbortError');
  assert.equal(await offlineStore.snapshot(), null); assert.equal(auth.offlineEnabled, false);
  assert.equal(currentUserId(), DEMO_USERS.student.id);

  // A delayed old-tab 403 cannot place a global revocation tombstone over a newly prepared account.
  await act(async () => { await auth.prepareOffline(); });
  held = { path: '/api/admin/overview', wait: new Promise<void>((resolve) => { release = resolve; }) };
  const beforeForbidden = calls.filter((call) => call.path === held!.path).length;
  let oldForbidden!: Promise<unknown>;
  await act(async () => { oldForbidden = auth.request('/admin/overview').catch((error) => error); });
  await waitFor(() => assert.ok(calls.filter((call) => call.path === held!.path).length > beforeForbidden));
  const anotherTab = new OfflineStore(() => factory);
  const replacementLease = await anotherTab.activateVerifiedAccount(DEMO_USERS.admin.id);
  await anotherTab.commit(replacementLease, await buildOfflineSnapshot(reader(adminToken), DEMO_USERS.admin.id));
  await anotherTab.saveFile(replacementLease, resource, new Blob([pdf]));
  held = null;
  await act(async () => { release(); await oldForbidden; });
  assert.ok(await oldForbidden instanceof ApiError);
  assert.equal((await anotherTab.snapshot())?.snapshot.userId, DEMO_USERS.admin.id);
  await act(async () => tree.unmount());
  dom.window.sessionStorage.removeItem('zabsync.demo.token'); online = false;
  tree = mount();
  await waitFor(() => { assert.equal(auth.offline, true); assert.equal(currentUserId(), DEMO_USERS.admin.id); });
  assert.equal(await (await auth.getOfflineFile(resource.id)).text(), pdf);
  online = true;
  await act(async () => { await auth.reconnect(); });
  await waitFor(() => assert.equal(auth.loading, false));
  await act(async () => { await auth.demoLogin('student'); });
  await waitFor(() => assert.equal(currentUserId(), DEMO_USERS.student.id));

  await act(async () => { await auth.prepareOffline(); });
  await act(async () => {
    await offlineStore.clear('logout');
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'zabsync.offline.signal',
      newValue: JSON.stringify({ change: 'logout', nonce: 'another-tab' }) }));
  });
  assert.equal(auth.signedIn, false); assert.equal(auth.me, null);
  assert.equal(dom.window.sessionStorage.getItem('zabsync.demo.token'), null);
  await act(async () => { await auth.demoLogin('student'); });
  await waitFor(() => assert.equal(auth.me?.user.id, DEMO_USERS.student.id));
  await act(async () => { await auth.prepareOffline(); });
  await act(async () => { await auth.logout(); });
  assert.equal(auth.signedIn, false); assert.equal(await offlineStore.snapshot(), null);
  assert.deepEqual(await offlineStore.listFiles(DEMO_USERS.student.id), []);
  assert.ok(Object.keys(dom.window.localStorage).some((key) => key.startsWith(`zabsync.offline.revoked:${DEMO_USERS.student.id}:`)));

  // Storage denial affects only offline features, never an otherwise valid online login.
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: undefined });
  await act(async () => { await auth.demoLogin('student'); });
  await waitFor(() => assert.equal(auth.me?.user.id, DEMO_USERS.student.id));
  assert.equal(auth.offline, false);
  await act(async () => { await assert.rejects(auth.prepareOffline(), /Offline storage is unavailable/); });
  assert.equal(currentUserId(), DEMO_USERS.student.id);
});
