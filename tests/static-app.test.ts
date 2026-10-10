import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestApp } from './helpers.js';

test('the actual compiled frontend serves SPA deep links, JavaScript, CSS and branding while unknown APIs stay JSON 404', async (t) => {
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
  const app = await createTestApp(t, { staticRoot });

  for (const url of ['/', '/classes/a-deep-link', '/requests', '/account', '/admin']) {
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

  const unknownApi = await app.inject({ method: 'GET', url: '/api/a-route-that-does-not-exist' });
  assert.equal(unknownApi.statusCode, 404);
  assert.match(String(unknownApi.headers['content-type']), /application\/json/);
  assert.equal(unknownApi.json<{ error: { code: string } }>().error.code, 'not_found');
});
