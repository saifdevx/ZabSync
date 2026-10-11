import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestApp } from './helpers.js';

test('the compiled checkpoint 2 app serves deep links, assets, install metadata and stamped public fallback while APIs stay JSON', async (t) => {
  const staticRoot = fileURLToPath(new URL('../dist/client/', import.meta.url));
  let builtHtml: string;
  try {
    builtHtml = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      t.skip('Run npm run build before checking the real compiled frontend.');
      return;
    }
    throw error;
  }
  assert.match(builtHtml, /id="root"/);
  assert.doesNotMatch(builtHtml, /src="\/src\/.*\.tsx"/);
  assert.match(builtHtml, /<title>XVIA · Node Compass Task<\/title>/);
  assert.match(builtHtml, /rel="manifest"[^>]*href="\/manifest\.webmanifest"/);
  assert.match(builtHtml, /rel="icon"[^>]*href="\/icons\/xvia-icon\.png"/);
  assert.match(builtHtml, /rel="apple-touch-icon"[^>]*href="\/icons\/xvia-icon\.png"/);
  const app = await createTestApp(t, { staticRoot });

  // These match client/src/App.tsx routes. Every direct visit must load the same
  // compiled shell; the client and API then apply authentication and permissions.
  for (const url of [
    '/', '/classes', '/classes/10000000-0000-4000-8000-000000000001',
    '/requests', '/account', '/admin', '/install', '/tutor', '/saved',
    '/search?q=databases', '/more', '/notifications', '/announcements',
    '/subjects/20000000-0000-4000-8000-000000000001',
    '/announcements/30000000-0000-4000-8000-000000000001',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    assert.match(String(response.headers['content-type']), /text\/html/);
    assert.equal(response.body, builtHtml);
  }

  const assets = [...builtHtml.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(
    (match) => match[1]!,
  );
  assert.ok(
    assets.some((asset) => asset.endsWith('.js')),
    'The build must reference JavaScript.',
  );
  assert.ok(
    assets.some((asset) => asset.endsWith('.css')),
    'The build must reference styles.',
  );
  for (const url of new Set(assets)) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, `${url}: ${response.body.slice(0, 200)}`);
    assert.ok(response.rawPayload.length > 100);
    assert.match(
      String(response.headers['content-type']),
      url.endsWith('.css') ? /text\/css/ : /javascript/,
    );
  }

  for (const url of ['/branding/szabist-horizontal.png', '/branding/szabist-emblem.png']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, url);
    assert.match(String(response.headers['content-type']), /image\/png/);
    assert.deepEqual([...response.rawPayload.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }

  const manifestResponse = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
  assert.equal(manifestResponse.statusCode, 200, manifestResponse.body);
  assert.match(String(manifestResponse.headers['content-type']), /application\/(?:manifest\+json|json)/);
  const manifest = manifestResponse.json<{
    id: string; name: string; short_name: string; start_url: string; scope: string;
    display: string; icons: { src: string; sizes: string; type: string }[];
  }>();
  assert.equal(manifest.name, 'XVIA · Node Compass Task');
  assert.equal(manifest.short_name, 'XVIA');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.src === '/icons/xvia-icon.png'));
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/') && !icon.src.startsWith('//'), 'Packaged install icons must be same-origin paths.');
    const response = await app.inject({ method: 'GET', url: icon.src });
    assert.equal(response.statusCode, 200, icon.src);
    assert.equal(String(response.headers['content-type']).split(';')[0], icon.type);
    if (icon.type === 'image/png') {
      assert.deepEqual([...response.rawPayload.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const actualSize = `${response.rawPayload.readUInt32BE(16)}x${response.rawPayload.readUInt32BE(20)}`;
      assert.ok(icon.sizes.split(/\s+/).includes(actualSize), 'Manifest PNG dimensions must match the actual provided icon.');
    } else if (icon.type === 'image/svg+xml') {
      assert.match(response.body, /<svg\b/);
    }
  }

  const fallback = await app.inject({ method: 'GET', url: '/offline.html' });
  assert.equal(fallback.statusCode, 200, fallback.body);
  assert.match(String(fallback.headers['content-type']), /text\/html/);
  assert.equal(fallback.body, await readFile(new URL('../dist/client/offline.html', import.meta.url), 'utf8'));
  assert.match(fallback.body, /Reconnect · XVIA/);
  assert.match(fallback.body, /src="\/icons\/xvia-icon\.png"/);
  assert.doesNotMatch(fallback.body, /id="root"/, 'The public connection fallback must be served as its own page.');

  const serviceWorker = await app.inject({ method: 'GET', url: '/sw.js' });
  assert.equal(serviceWorker.statusCode, 200, serviceWorker.body);
  assert.match(String(serviceWorker.headers['content-type']), /javascript/);
  assert.equal(serviceWorker.body, await readFile(new URL('../dist/client/sw.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(serviceWorker.body, /__XVIA_BUILD__/, 'The deployable service worker must have its build marker stamped.');
  assert.match(serviceWorker.body, /xvia-public-connection-v2-[a-f0-9]{16}/);

  for (const url of ['/api', '/api/a-route-that-does-not-exist']) {
    const unknownApi = await app.inject({ method: 'GET', url });
    assert.equal(unknownApi.statusCode, 404);
    assert.match(String(unknownApi.headers['content-type']), /application\/json/);
    assert.equal(unknownApi.json<{ error: { code: string } }>().error.code, 'not_found');
  }
});
