import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, migrate, first, numberValue } from '../server/db.js';
import { seedDemo, DEMO_USERS } from '../server/demo.js';
import { publicUser } from '../server/auth.js';
import { createHelpAssistant, loadHelpAiConfig } from '../server/help-assistant.js';
import { makeTestConfig } from '../server/config.js';

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(process.cwd(), 'tests/.help-ai-'));
  const db = await openDatabase(pathToFileURL(join(directory, 'test.db')).href);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await migrate(db);
  await seedDemo(db);
  const actor = publicUser(
    (await first(db, 'SELECT * FROM users WHERE id=?', [DEMO_USERS.student.id]))!,
  );
  return { db, actor };
}
const config = {
  enabled: true,
  apiKey: 'test-only-key',
  model: 'test-model',
  perUserDaily: 1,
  globalDaily: 2,
};
function output(sourceIds: string[]) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify({ sourceIds }) }],
        },
      ],
    }),
    { status: 200 },
  );
}

test('unknown questions do not call OpenAI; configured-off mode is safe', async (t) => {
  const { db, actor } = await fixture(t);
  let calls = 0;
  const assistant = createHelpAssistant({
    db,
    config,
    appConfig: makeTestConfig({ authMode: 'firebase' }),
    fetchForTests: async () => {
      calls++;
      return output([]);
    },
  });
  for (const question of ['Photosynthesis chlorophyll mitochondria', '???', 'how can I please']) {
    const reply = await assistant.answer(actor, question);
    assert.equal(calls, 0);
    assert.deepEqual(reply.sourceIds, []);
    assert.equal(reply.remainingToday, 1);
  }
  assert.equal(numberValue((await first(db, 'SELECT count(*) AS n FROM help_ai_usage'))?.n), 0);
  assert.equal(loadHelpAiConfig({}).enabled, false);
  assert.throws(() => loadHelpAiConfig({ HELP_AI_ENABLED: 'true' }));
  assert.throws(() => createHelpAssistant({ db, config, appConfig: makeTestConfig() }));
});
test('provider receives only bounded approved content and returns IDs; server supplies exact published answer', async (t) => {
  const { db, actor } = await fixture(t);
  const id = '71111111-0000-4000-8000-000000000005';
  let body: Record<string, any> | undefined;
  const assistant = createHelpAssistant({
    db,
    config,
    appConfig: makeTestConfig({ authMode: 'firebase' }),
    fetchForTests: async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      body = JSON.parse(init!.body as string);
      assert.equal(body!.store, false);
      assert.equal(body!.max_output_tokens, 512);
      assert.doesNotMatch(init!.body as string, new RegExp(actor.email));
      return output([id]);
    },
  });
  const result = await assistant.answer(actor, 'What works offline?');
  const approved = await first(db, 'SELECT body FROM help_articles WHERE id=?', [id]);
  assert.ok(result.answer.includes(String(approved?.body)));
  assert.deepEqual(result.sourceIds, [id]);
  assert.equal(result.remainingToday, 0);
  await assert.rejects(() => assistant.answer(actor, 'What works offline?'), /allowance/);
  const use = await first(db, "SELECT sum(requests) AS n FROM help_ai_usage WHERE scope='global'");
  assert.equal(numberValue(use?.n), 1);
});
test('simultaneous AI requests cannot exceed the per-user allowance and timeout reservations are retained', async (t) => {
  const { db, actor } = await fixture(t);
  let calls = 0;
  const assistant = createHelpAssistant({
    db,
    config,
    appConfig: makeTestConfig({ authMode: 'firebase' }),
    fetchForTests: async () => {
      calls++;
      throw new Error('Simulated provider timeout');
    },
  });
  const results = await Promise.allSettled([
    assistant.answer(actor, 'What works offline?'),
    assistant.answer(actor, 'What works offline?'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 0);
  assert.equal(calls, 1);
  assert.equal((await assistant.status(actor)).remainingToday, 0);
});
test('invented source IDs and material unpublished during a call never reach students', async (t) => {
  const { db, actor } = await fixture(t);
  const base = {
    db,
    config: { ...config, perUserDaily: 4 },
    appConfig: makeTestConfig({ authMode: 'firebase' }),
  };
  const bogus = createHelpAssistant({
    ...base,
    fetchForTests: async () => output(['88888888-0000-4000-8000-000000000001']),
  });
  await assert.rejects(() => bogus.answer(actor, 'What works offline?'), /supported answer/);
  const id = '71111111-0000-4000-8000-000000000005';
  const changed = createHelpAssistant({
    ...base,
    fetchForTests: async () => {
      await db.execute({ sql: "UPDATE help_articles SET status='draft' WHERE id=?", args: [id] });
      return output([id]);
    },
  });
  const result = await changed.answer(actor, 'What works offline?');
  assert.deepEqual(result.sourceIds, []);
  assert.doesNotMatch(result.answer, /Prepare offline access/);
});
