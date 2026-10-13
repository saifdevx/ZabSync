import assert from 'node:assert/strict';
import test from 'node:test';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

const article = {
  title: 'Source-backed test university answer',
  category: 'university',
  body: 'Only the text explicitly provided by the owner belongs in this test answer.',
  sourceUrl: 'https://szabist-isb.edu.pk/',
  status: 'draft',
};

test('published help starts with app guidance and no fabricated university policy or developer biography', async (t) => {
  const app = await createTestApp(t),
    student = await demoToken(app, 'student');
  const missing = await app.inject({ method: 'GET', url: '/api/help' });
  assert.equal(missing.statusCode, 401);
  const all = await app.inject({ method: 'GET', url: '/api/help', headers: bearer(student) });
  expectSuccess(all);
  assert.equal(all.json().articles.length, 7);
  assert.ok(
    all
      .json()
      .articles.every(
        (item: { category: string; status: string }) =>
          item.category === 'app' && item.status === 'published',
      ),
  );
  for (const category of ['university', 'developer'])
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/help?category=${category}`,
          headers: bearer(student),
        })
      ).json().articles.length,
      0,
    );
  const found = await app.inject({
    method: 'GET',
    url: '/api/help?q=How%20does%20chat%20work%3F',
    headers: bearer(student),
  });
  expectSuccess(found);
  assert.ok(found.json().articles.some((item: { title: string }) => item.title.includes('chat')));
});

test('only the owner authors help; drafts and unsafe or absent sources never become student-visible', async (t) => {
  const app = await createTestApp(t),
    student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin'),
    master = await demoToken(app, 'master');
  for (const token of [student, admin])
    expectForbidden(
      await app.inject({
        method: 'POST',
        url: '/api/admin/help',
        headers: bearer(token),
        payload: article,
      }),
    );
  for (const sourceUrl of [
    null,
    'javascript:alert(1)',
    'http://example.com/',
    'https://user:pass@example.com/',
  ])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/help',
          headers: bearer(master),
          payload: { ...article, sourceUrl },
        })
      ).statusCode,
      400,
    );
  const draft = await app.inject({
    method: 'POST',
    url: '/api/admin/help',
    headers: bearer(master),
    payload: article,
  });
  assert.equal(draft.statusCode, 201);
  const saved = draft.json().article;
  expectForbidden(
    await app.inject({ method: 'GET', url: `/api/help/${saved.id}`, headers: bearer(student) }),
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/admin/help?status=draft',
        headers: bearer(master),
      })
    ).json().articles.length,
    1,
  );
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/help/${saved.id}`,
      headers: bearer(master),
      payload: { ...article, status: 'published', version: 1 },
    }),
  );
  const publicArticle = (
    await app.inject({ method: 'GET', url: `/api/help/${saved.id}`, headers: bearer(student) })
  ).json().article;
  assert.equal(publicArticle.body, article.body);
  assert.equal(publicArticle.sourceUrl, article.sourceUrl);
  assert.equal(publicArticle.version, 2);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/admin/help/${saved.id}`,
        headers: bearer(master),
        payload: { ...article, status: 'published', version: 1 },
      })
    ).statusCode,
    409,
  );
  expectForbidden(
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/help/${saved.id}`,
      headers: bearer(admin),
      payload: { version: 2 },
    }),
  );
});

test('removed help disappears from public retrieval and restores as an unpublished draft', async (t) => {
  const app = await createTestApp(t),
    student = await demoToken(app, 'student'),
    master = await demoToken(app, 'master');
  const created = (
    await app.inject({
      method: 'POST',
      url: '/api/admin/help',
      headers: bearer(master),
      payload: { ...article, status: 'published' },
    })
  ).json().article;
  expectSuccess(
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/help/${created.id}`,
      headers: bearer(master),
      payload: { version: 1 },
    }),
  );
  expectForbidden(
    await app.inject({ method: 'GET', url: `/api/help/${created.id}`, headers: bearer(student) }),
  );
  const trash = (
    await app.inject({
      method: 'GET',
      url: '/api/admin/help?deleted=true',
      headers: bearer(master),
    })
  ).json().articles;
  assert.equal(trash.length, 1);
  assert.equal(trash[0].version, 2);
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/admin/help/${created.id}/restore`,
      headers: bearer(master),
      payload: { version: 2 },
    }),
  );
  const restored = (
    await app.inject({
      method: 'GET',
      url: '/api/admin/help?status=draft',
      headers: bearer(master),
    })
  ).json().articles[0];
  assert.equal(restored.status, 'draft');
  assert.equal(restored.version, 3);
  assert.equal(restored.publishedAt, null);
  expectForbidden(
    await app.inject({ method: 'GET', url: `/api/help/${created.id}`, headers: bearer(student) }),
  );
});

test('assistant is explicitly disabled without a configured bounded provider and rejects malformed requests', async (t) => {
  const app = await createTestApp(t),
    student = await demoToken(app, 'student');
  const status = await app.inject({
    method: 'GET',
    url: '/api/help/assistant-status',
    headers: bearer(student),
  });
  expectSuccess(status);
  assert.equal(status.json().enabled, false);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/help/ask',
        headers: bearer(student),
        payload: { question: 'How do reminders work?' },
      })
    ).statusCode,
    503,
  );
  for (const payload of [
    { question: '' },
    { question: 'ab' },
    { question: 'a'.repeat(1001) },
    { question: 'Hello', role: 'master' },
  ])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/help/ask',
          headers: bearer(student),
          payload,
        })
      ).statusCode,
      400,
    );
});

test('owner can curate drafts while help is disabled, and disabling the feature closes student endpoints', async (t) => {
  const app = await createTestApp(t),
    student = await demoToken(app, 'student'),
    master = await demoToken(app, 'master');
  const settings = (
    await app.inject({ method: 'GET', url: '/api/admin/settings', headers: bearer(master) })
  ).json().settings;
  expectSuccess(
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: bearer(master),
      payload: {
        version: settings.version,
        features: { ...settings.features, help: false },
        maintenance: settings.maintenance,
      },
    }),
  );
  expectForbidden(await app.inject({ method: 'GET', url: '/api/help', headers: bearer(student) }));
  expectForbidden(
    await app.inject({
      method: 'GET',
      url: '/api/help/assistant-status',
      headers: bearer(student),
    }),
  );
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: '/api/admin/help',
      headers: bearer(master),
      payload: article,
    }),
  );
});
