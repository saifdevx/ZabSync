import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../client/public/', import.meta.url);
const source = await readFile(new URL('sw.js', root), 'utf8');

async function workerHarness(offline = false) {
  const handlers = new Map<string, (event: any) => void>();
  const cached = new Map<string, Response>();
  const cacheReads: string[] = [];
  const deleted: string[] = [];
  const network: string[] = [];
  const writes: string[] = [];
  let skipWaiting = 0;
  let claimed = 0;
  const publicPage = await readFile(new URL('offline.html', root), 'utf8');
  const context = {
    URL,
    Response,
    self: {
      location: { origin: 'https://xvia.example' },
      addEventListener: (type: string, callback: (event: any) => void) =>
        handlers.set(type, callback),
      skipWaiting: async () => {
        skipWaiting++;
      },
      clients: {
        claim: async () => {
          claimed++;
        },
      },
    },
    caches: {
      keys: async () => ['xvia-public-connection-v1', 'unrelated-app-cache'],
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
      open: async () => ({
        addAll: async (paths: string[]) => {
          for (const path of paths) {
            writes.push(path);
            cached.set(path, new Response(path === '/offline.html' ? publicPage : 'public-icon'));
          }
        },
        match: async (path: string) => {
          cacheReads.push(path);
          return cached.get(path)?.clone();
        },
      }),
    },
    fetch: async (request: { url?: string } | string) => {
      network.push(typeof request === 'string' ? request : (request.url ?? ''));
      if (offline) throw new TypeError('network unavailable');
      return new Response('fresh network response');
    },
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  const lifecycle = async (type: string, data?: unknown) => {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)?.({ data, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  const request = async (
    path: string,
    options: { mode?: string; method?: string; authorized?: boolean } = {},
  ) => {
    let response: Promise<Response> | undefined;
    const url = new URL(path, 'https://xvia.example').href;
    handlers.get('fetch')?.({
      request: {
        url,
        mode: options.mode ?? 'cors',
        method: options.method ?? 'GET',
        headers: new Headers(
          options.authorized ? { Authorization: 'Bearer private-test-token' } : {},
        ),
      },
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    return response ? await response : null;
  };
  return {
    lifecycle,
    request,
    network,
    writes,
    cacheReads,
    deleted,
    get skipped() {
      return skipWaiting;
    },
    get claimed() {
      return claimed;
    },
  };
}

test('worker leaves authenticated APIs, file paths, cross-origin requests, and mutations to the network', async () => {
  const harness = await workerHarness(true);
  for (const path of [
    '/api/me',
    '/api/users/student/avatar',
    '/api/resources/id/download',
    '/__/auth/handler',
    '/uploads/lecture.pdf',
    '/downloads/lecture.pdf',
    '/files/lecture.pdf',
    'https://identitytoolkit.googleapis.com/v1/accounts',
  ]) {
    assert.equal(await harness.request(path, { mode: 'navigate' }), null, path);
  }
  assert.equal(
    await harness.request('/classes/class-id', { mode: 'navigate', authorized: true }),
    null,
  );
  assert.equal(await harness.request('/icons/xvia-icon.png', { authorized: true }), null);
  assert.equal(await harness.request('/classes/class-id', { method: 'POST' }), null);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.cacheReads, []);
});

test('worker stores only public fallback assets and never caches online class navigations', async () => {
  const harness = await workerHarness();
  await harness.lifecycle('install');
  assert.deepEqual(harness.writes, ['/offline.html', '/icons/xvia-icon.png']);
  const response = await harness.request('/classes/private-class', { mode: 'navigate' });
  assert.equal(await response?.text(), 'fresh network response');
  assert.deepEqual(harness.cacheReads, []);
  assert.deepEqual(harness.writes, ['/offline.html', '/icons/xvia-icon.png']);
});

test('offline navigation receives public reconnect content and retry preserves the requested route', async () => {
  const harness = await workerHarness(true);
  await harness.lifecycle('install');
  const response = await harness.request('/classes/private-class?tab=resources', {
    mode: 'navigate',
  });
  const html = await response!.text();
  assert.match(html, /Let’s get you reconnected/);
  assert.match(html, /<a href="">Try again<\/a>/);
  assert.doesNotMatch(html, /private-class|Bearer|university-email/);
  assert.deepEqual(harness.cacheReads, ['/offline.html']);
  assert.equal(await harness.request('/assets/private-app.js'), null);
});

test('a worker update waits for an explicit user update action and only clears its own old cache', async () => {
  const harness = await workerHarness();
  await harness.lifecycle('install');
  assert.equal(harness.skipped, 0);
  await harness.lifecycle('message', { type: 'unrelated-message' });
  assert.equal(harness.skipped, 0);
  await harness.lifecycle('message', { type: 'XVIA_ACTIVATE_UPDATE' });
  assert.equal(harness.skipped, 1);
  await harness.lifecycle('activate');
  assert.deepEqual(harness.deleted, ['xvia-public-connection-v1']);
  assert.equal(harness.claimed, 1);
});

test('manifest icon dimensions are honest and the SVG preserves the supplied PNG bytes', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.name, 'XVIA · Node Compass Task');
  assert.equal(manifest.short_name, 'XVIA');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  const png = await readFile(new URL('icons/xvia-icon.png', root));
  const dimensions = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
  assert.equal(
    manifest.icons.find((icon: { type: string }) => icon.type === 'image/png').sizes,
    dimensions,
  );
  const svg = await readFile(new URL('icons/xvia-icon.svg', root), 'utf8');
  const embedded = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(embedded);
  assert.deepEqual(Buffer.from(embedded[1], 'base64'), png);
  assert.equal(
    manifest.icons.find((icon: { type: string }) => icon.type === 'image/svg+xml').sizes,
    'any',
  );
});
