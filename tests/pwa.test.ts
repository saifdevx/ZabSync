import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import vm from 'node:vm';

const root = new URL('../client/public/', import.meta.url);
const source = await readFile(new URL('sw.js', root), 'utf8');
const approved = ['/index.html', '/offline.html', '/manifest.webmanifest', '/icons/zabsync-icon.png',
  '/icons/zabsync-icon.svg', '/assets/index-Abc123.js', '/assets/index-Abc123.css', '/assets/firebase-Xyz456.js'];
const prepared = source.replaceAll('__ZABSYNC_BUILD__', 'test-build')
  .replace(/\/\* __ZABSYNC_PUBLIC_ASSETS__ \*\/ \[[^;]*\]/, JSON.stringify(approved));

async function workerHarness(offline = false) {
  const handlers = new Map<string, (event: any) => void>(), cached = new Map<string, Response>();
  const cacheReads: string[] = [], deleted: string[] = [], network: string[] = [], writes: string[] = [];
  let skipWaiting = 0, claimed = 0;
  const publicPage = await readFile(new URL('offline.html', root), 'utf8');
  const context = {
    URL, Response,
    self: {
      location: { origin: 'https://zabsync.example' },
      addEventListener: (type: string, callback: (event: any) => void) => handlers.set(type, callback),
      skipWaiting: async () => { skipWaiting++; }, clients: { claim: async () => { claimed++; } },
    },
    caches: {
      keys: async () => ['zabsync-public-shell-v3-old', 'zabsync-public-shell-v3-test-build', 'xvia-public-connection-v2-old', 'unrelated-app-cache'],
      delete: async (key: string) => { deleted.push(key); return true; },
      open: async () => ({
        addAll: async (paths: string[]) => {
          for (const path of paths) { writes.push(path); cached.set(path, new Response(path === '/offline.html' ? publicPage : path === '/index.html' ? '<html>Public ZabSync app shell</html>' : `public asset ${path}`)); }
        },
        match: async (path: string) => { cacheReads.push(path); return cached.get(path)?.clone(); },
      }),
    },
    fetch: async (request: { url?: string } | string) => {
      network.push(typeof request === 'string' ? request : (request.url ?? ''));
      if (offline) throw new TypeError('network unavailable'); return new Response('fresh network response');
    },
  };
  vm.runInNewContext(prepared, context, { filename: 'sw.js' });
  const lifecycle = async (type: string, data?: unknown, port?: { postMessage: (value: any) => void }) => {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)?.({ data, ports: port ? [port] : [], waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  const request = async (path: string, options: { mode?: string; method?: string; authorized?: boolean } = {}) => {
    let response: Promise<Response> | undefined;
    handlers.get('fetch')?.({ request: { url: new URL(path, 'https://zabsync.example').href,
      mode: options.mode ?? 'cors', method: options.method ?? 'GET',
      headers: new Headers(options.authorized ? { Authorization: 'Bearer private-test-token' } : {}) },
      respondWith: (promise: Promise<Response>) => { response = promise; },
    });
    return response ? await response : null;
  };
  return { lifecycle, request, network, writes, cacheReads, deleted, cached,
    get skipped() { return skipWaiting; }, get claimed() { return claimed; } };
}

test('worker never intercepts APIs, private files, authenticated assets, cross-origin requests, or mutations', async () => {
  const harness = await workerHarness(true);
  for (const path of ['/api/me', '/api/site', '/api/config', '/api/offline/access', '/api/users/student/avatar',
    '/api/resources/id/download', '/__/auth/handler', '/uploads/lecture.pdf', '/downloads/lecture.pdf', '/files/lecture.pdf',
    'https://identitytoolkit.googleapis.com/v1/accounts']) assert.equal(await harness.request(path, { mode: 'navigate' }), null, path);
  assert.equal(await harness.request('/classes/class-id', { mode: 'navigate', authorized: true }), null);
  assert.equal(await harness.request('/icons/zabsync-icon.png', { authorized: true }), null);
  assert.equal(await harness.request('/classes/class-id', { method: 'POST' }), null);
  assert.equal(await harness.request('/assets/not-in-the-build.js'), null);
  assert.equal(await harness.request('/assets/index-Abc123.js?token=private'), null);
  assert.deepEqual(harness.writes, []); assert.deepEqual(harness.cacheReads, []);
});
test('complete public shell caches include lazy auth chunks, without caching class navigation responses', async () => {
  const harness = await workerHarness(); await harness.lifecycle('install');
  assert.deepEqual(harness.writes, approved);
  const response = await harness.request('/classes/private-class', { mode: 'navigate' });
  assert.equal(await response?.text(), 'fresh network response'); assert.deepEqual(harness.cacheReads, []);
  assert.deepEqual(harness.writes, approved);
  assert.match(await (await harness.request('/assets/firebase-Xyz456.js'))!.text(), /public asset/);
});
test('offline class and deep-link navigations reopen the public app shell without revealing private data', async () => {
  const harness = await workerHarness(true); await harness.lifecycle('install');
  const html = await (await harness.request('/classes/private-class?tab=timetable', { mode: 'navigate' }))!.text();
  assert.match(html, /Public ZabSync app shell/); assert.doesNotMatch(html, /private-class|Bearer|university-email/);
  assert.deepEqual(harness.cacheReads, ['/index.html']);
  harness.cached.delete('/index.html');
  const fallback = await (await harness.request('/offline', { mode: 'navigate' }))!.text();
  assert.match(fallback, /Let’s get you reconnected/); assert.match(fallback, /<a href="">Try again<\/a>/);
  assert.doesNotMatch(fallback, /offline resources will be available/);
});
test('updates wait for explicit activation and only retire this app’s public caches', async () => {
  const harness = await workerHarness(); await harness.lifecycle('install'); assert.equal(harness.skipped, 0);
  await harness.lifecycle('message', { type: 'unrelated-message' }); assert.equal(harness.skipped, 0);
  await harness.lifecycle('message', { type: 'ZABSYNC_ACTIVATE_UPDATE' }); assert.equal(harness.skipped, 1);
  await harness.lifecycle('activate');
  assert.deepEqual(harness.deleted, ['zabsync-public-shell-v3-old', 'xvia-public-connection-v2-old']);
  assert.equal(harness.claimed, 1);
});
test('offline readiness requires every built asset, not just an installed worker', async () => {
  const harness = await workerHarness(); await harness.lifecycle('install');
  let result: any;
  const port = { postMessage: (value: any) => { result = value; } };
  await harness.lifecycle('message', { type: 'ZABSYNC_OFFLINE_STATUS' }, port); assert.equal(result.ready, true);
  harness.cached.delete('/assets/firebase-Xyz456.js');
  await harness.lifecycle('message', { type: 'ZABSYNC_OFFLINE_STATUS' }, port); assert.equal(result.ready, false);
});
test('post-build stamping discovers all public chunks, excludes unknown files, and changes the cache version with code', async (t) => {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.pwa-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const folder of ['scripts', 'client/public', 'dist/client/assets', 'dist/client/icons', 'dist/client/api']) await mkdir(join(directory, folder), { recursive: true });
  await copyFile(new URL('../scripts/stamp-web-build.mjs', import.meta.url), join(directory, 'scripts/stamp-web-build.mjs'));
  await writeFile(join(directory, 'client/public/sw.js'), source);
  for (const path of approved) await writeFile(join(directory, 'dist/client', path), path);
  await writeFile(join(directory, 'dist/client/api/private.json'), '{"private":true}');
  await writeFile(join(directory, 'dist/client/assets/app.js.map'), '{}');
  const run = () => promisify(execFile)(process.execPath, [join(directory, 'scripts/stamp-web-build.mjs')], { cwd: directory });
  await run(); const first = await readFile(join(directory, 'dist/client/sw.js'), 'utf8');
  assert.doesNotMatch(first, /__ZABSYNC_/); assert.match(first, /firebase-Xyz456\.js/);
  assert.doesNotMatch(first, /private\.json|app\.js\.map/);
  await run(); assert.equal(await readFile(join(directory, 'dist/client/sw.js'), 'utf8'), first);
  await writeFile(join(directory, 'dist/client/assets/firebase-Xyz456.js'), 'changed public code');
  await run(); assert.notEqual(await readFile(join(directory, 'dist/client/sw.js'), 'utf8'), first);
});
test('manifest dimensions remain honest and the SVG preserves the supplied university PNG', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.match(manifest.name, /^ZabSync|^ZabSync/); assert.match(manifest.short_name, /^ZabSync|^ZabSync/);
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/');
  const png = await readFile(new URL('icons/zabsync-icon.png', root));
  assert.equal(manifest.icons.find((icon: { type: string }) => icon.type === 'image/png').sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  const svg = await readFile(new URL('icons/zabsync-icon.svg', root), 'utf8');
  const embedded = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/); assert.ok(embedded);
  assert.deepEqual(Buffer.from(embedded[1], 'base64'), png);
  assert.equal(manifest.icons.find((icon: { type: string }) => icon.type === 'image/svg+xml').sizes, 'any');
});
