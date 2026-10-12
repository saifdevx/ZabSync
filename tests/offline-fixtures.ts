import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/app.js';
import { makeTestConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { DEMO_CLASS_ID } from '../server/demo.js';
import { createPrivateStorage } from '../server/storage.js';
import { ApiError } from '../client/src/auth.js';
import type { Resource } from '../client/src/academic-types.js';
import type { OnlineReader } from '../client/src/offline-data.js';

export const offlineNow = Date.parse('2026-10-11T19:30:00.000Z');
export const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
export async function offlineTestApp(t: TestContext, now: () => Date = () => new Date(offlineNow)) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.offline-api-'));
  const databaseUrl = pathToFileURL(join(directory, 'data.sqlite')).href;
  const db = await openDatabase(databaseUrl);
  const app = await createApp({ db, config: makeTestConfig({ databaseUrl }), now,
    storage: createPrivateStorage({ driver: 'local', localDirectory: join(directory, 'files') }) });
  await app.ready();
  t.after(async () => { await app.close(); db.close(); await rm(directory, { recursive: true, force: true }); });
  const calls: string[] = [];
  const reader = (token: string): OnlineReader => async <T,>(path: string): Promise<T> => {
    calls.push(path);
    const response = await app.inject({ method: 'GET', url: `/api${path}`, headers: { authorization: `Bearer ${token}` } });
    if (response.statusCode >= 400) {
      const body = response.json(); throw new ApiError(body.error.code, body.error.message, response.statusCode);
    }
    return response.json<T>();
  };
  const upload = async (token: string, subjectId?: string): Promise<Resource> => {
    const form = new FormData(); form.append('title', 'Saved offline lecture');
    if (subjectId) form.append('subjectId', subjectId);
    form.append('file', new File([pdf], 'offline-lecture.pdf', { type: 'application/pdf' }));
    const request = new Request('http://localhost:3001', { method: 'POST', body: form });
    const response = await app.inject({ method: 'POST', url: `/api/classes/${DEMO_CLASS_ID}/resources`,
      headers: { authorization: `Bearer ${token}`, 'content-type': request.headers.get('content-type')! },
      payload: Buffer.from(await request.arrayBuffer()) });
    assert.equal(response.statusCode, 201, response.body); return response.json().resource;
  };
  return { app, db, reader, upload, calls };
}
