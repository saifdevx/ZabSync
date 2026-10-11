import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import type { PrivateStorage } from '../server/storage.js';
import type { CurrentUser } from '../server/auth.js';
import type { SiteSettings } from '../server/site-settings.js';
import type { TutorProfile } from '../server/operations.js';
import { DEMO_CLASS_ID, DEMO_USERS } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectForbidden, expectSuccess } from './helpers.js';

class MemoryStorage implements PrivateStorage {
  objects = new Map<string, Buffer>();
  failDeletes = 0;
  failPutsAfterWrite = 0;
  async putFile(key: string, path: string): Promise<void> {
    this.objects.set(key, await readFile(path));
    if (this.failPutsAfterWrite > 0) { this.failPutsAfterWrite--; throw new Error('Injected failure after storage wrote bytes.'); }
  }
  async open(key: string) {
    const data = this.objects.get(key);
    if (!data) throw new Error('Missing test object.');
    return { stream: Readable.from(data), size: data.length, contentType: 'image/webp' };
  }
  async delete(key: string): Promise<void> {
    if (this.failDeletes > 0) { this.failDeletes--; throw new Error('Injected transient storage failure.'); }
    this.objects.delete(key);
  }
}

function multipart(data: Buffer, mime = 'image/png', filename = 'photo.png') {
  const boundary = 'xvia-avatar-upload-boundary';
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

test('profile handles normalize uniquely without changing authenticated identity or permissions', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');
  const cr = await demoToken(app, 'cr');
  const save = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(student), payload: { displayName: 'Areeba Study', username: '@Areeba_5D' } });
  expectSuccess(save);
  const saved = save.json<{ user: CurrentUser }>().user;
  assert.equal(saved.username, 'areeba_5d');
  assert.equal(saved.id, DEMO_USERS.student.id);
  assert.equal(saved.email, DEMO_USERS.student.email);
  assert.equal(saved.role, 'student');

  const collision = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(cr), payload: { displayName: 'Should not be saved', username: 'AREEBA_5D' } });
  assert.equal(collision.statusCode, 409, collision.body);
  assert.equal(collision.json().error.code, 'username_taken');
  const unchanged = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(cr) });
  assert.equal(unchanged.json().user.displayName, DEMO_USERS.cr.displayName);

  for (const payload of [{ username: 'Admin' }, { username: '../admin' }, { username: 'ab' }, { username: 'طالب' }, { email: 'other@szabist-isb.pk' }, { role: 'master' }, { id: 'another-person' }]) {
    const invalid = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(student), payload });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  const clear = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(student), payload: { username: null } });
  assert.equal(clear.json().user.username, null);
  const freed = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(cr), payload: { username: 'areeba_5d' } });
  expectSuccess(freed);
  const roster = await app.inject({ method: 'GET', url: `/api/classes/${DEMO_CLASS_ID}`, headers: bearer(student) });
  assert.equal(roster.json().members.find((entry: { userId: string }) => entry.userId === DEMO_USERS.cr.id).username, 'areeba_5d');
  assert.equal(roster.json().members.some((entry: object) => Object.hasOwn(entry, 'email')), false);
});

test('Tutor draft remains private; owner publication, safe links, stale saves and feature controls are enforced', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  const initial = await app.inject({ method: 'GET', url: '/api/tutor', headers: bearer(student) });
  assert.equal(initial.json().tutor, null);
  for (const path of ['/api/admin/tutor', '/api/admin/settings']) {
    expectForbidden(await app.inject({ method: 'GET', url: path, headers: bearer(student) }));
  }
  const initialDraft = (await app.inject({ method: 'GET', url: '/api/admin/tutor', headers: bearer(master) })).json<{ tutor: TutorProfile }>().tutor;
  assert.equal(initialDraft.name, '');
  const draftSave = await app.inject({ method: 'PATCH', url: '/api/admin/tutor', headers: bearer(master), payload: { version: initialDraft.version, title: 'Study sessions', name: 'Example Tutor', bio: 'Private draft biography', subjects: ['Databases'] } });
  expectSuccess(draftSave);
  const draft = draftSave.json<{ tutor: TutorProfile }>().tutor;
  assert.equal((await app.inject({ method: 'GET', url: '/api/tutor', headers: bearer(student) })).json().tutor, null);

  for (const changes of [{ contactUrl: 'javascript:alert(1)' }, { bookingUrl: 'http://example.org' }, { contactUrl: 'https://user:password@example.org' }, { bio: '<script>alert(1)</script>' }]) {
    const invalid = await app.inject({ method: 'PATCH', url: '/api/admin/tutor', headers: bearer(master), payload: { version: draft.version, ...changes } });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  const publish = await app.inject({ method: 'PATCH', url: '/api/admin/tutor', headers: bearer(master), payload: { version: draft.version, published: true, bio: 'Published tutor biography', contactLabel: 'Contact', contactUrl: 'https://example.org/contact' } });
  expectSuccess(publish);
  const visible = await app.inject({ method: 'GET', url: '/api/tutor', headers: bearer(student) });
  assert.equal(visible.json().tutor.bio, 'Published tutor biography');
  const stale = await app.inject({ method: 'PATCH', url: '/api/admin/tutor', headers: bearer(master), payload: { version: draft.version, name: 'Stale overwrite' } });
  assert.equal(stale.statusCode, 409, stale.body);
  expectForbidden(await app.inject({ method: 'PATCH', url: '/api/admin/tutor', headers: bearer(student), payload: { version: publish.json().tutor.version, name: 'Forged owner' } }));

  const settings = (await app.inject({ method: 'GET', url: '/api/site', headers: bearer(student) })).json<{ settings: SiteSettings }>().settings;
  const disable = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: bearer(master), payload: { version: settings.version, features: { tutor: false } } });
  expectSuccess(disable);
  const hidden = await app.inject({ method: 'GET', url: '/api/tutor', headers: bearer(student) });
  assert.equal(hidden.statusCode, 404, hidden.body);
  assert.equal(hidden.json().error.code, 'feature_disabled');
  expectSuccess(await app.inject({ method: 'GET', url: '/api/admin/tutor', headers: bearer(master) }));
  const staleSettings = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: bearer(master), payload: { version: settings.version, features: { tutor: true } } });
  assert.equal(staleSettings.statusCode, 409, staleSettings.body);
  const inventFeature = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: bearer(master), payload: { version: disable.json().settings.version, features: { executeCode: true } } });
  assert.equal(inventFeature.statusCode, 400, inventFeature.body);
});

test('maintenance pauses non-owner writes through existing APIs while reads and owner recovery work', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');
  const cr = await demoToken(app, 'cr');
  const master = await demoToken(app, 'master');
  const current = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: bearer(master) })).json<{ settings: SiteSettings }>().settings;
  const enabled = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: bearer(master), payload: { version: current.version, maintenance: { enabled: true, message: 'Read-only update in progress.' } } });
  expectSuccess(enabled);
  const classBody = { name: '5D edited', program: 'BS Computer Science', semester: 5, section: 'D', description: '' };
  for (const call of [
    { method: 'PATCH' as const, url: '/api/me', headers: bearer(student), payload: { displayName: 'Paused name' } },
    { method: 'POST' as const, url: `/api/classes/${DEMO_CLASS_ID}/invite`, headers: bearer(cr) },
    { method: 'PATCH' as const, url: `/api/classes/${DEMO_CLASS_ID}`, headers: bearer(cr), payload: classBody },
    { method: 'DELETE' as const, url: '/api/me/avatar', headers: bearer(student) },
  ]) {
    const paused = await app.inject(call);
    assert.equal(paused.statusCode, 503, paused.body);
    assert.equal(paused.json().error.code, 'maintenance_mode');
    assert.equal(paused.headers['retry-after'], '60');
  }
  for (const path of ['/api/me', '/api/site', `/api/classes/${DEMO_CLASS_ID}`]) {
    expectSuccess(await app.inject({ method: 'GET', url: path, headers: bearer(student) }));
  }
  await demoToken(app, 'student');
  expectSuccess(await app.inject({ method: 'PATCH', url: `/api/classes/${DEMO_CLASS_ID}`, headers: bearer(master), payload: classBody }));
  const off = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: bearer(master), payload: { version: enabled.json().settings.version, maintenance: { enabled: false, message: 'Updates complete.' } } });
  expectSuccess(off);
  expectSuccess(await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(student), payload: { displayName: 'Changes resumed' } }));
});

test('only the owner can suspend accounts and an existing session loses access immediately', async (t) => {
  const app = await createTestApp(t);
  const student = await demoToken(app, 'student');
  const cr = await demoToken(app, 'cr');
  const master = await demoToken(app, 'master');
  const path = `/api/admin/users/${DEMO_USERS.student.id}/status`;
  expectForbidden(await app.inject({ method: 'PATCH', url: path, headers: { ...bearer(cr), 'x-role': 'master' }, payload: { status: 'suspended' } }));
  const suspend = await app.inject({ method: 'PATCH', url: path, headers: bearer(master), payload: { status: 'suspended' } });
  expectSuccess(suspend);
  assert.equal(suspend.json().user.status, 'suspended');
  for (const url of ['/api/me', '/api/site', `/api/classes/${DEMO_CLASS_ID}`]) {
    const blocked = await app.inject({ method: 'GET', url, headers: bearer(student) });
    assert.equal(blocked.statusCode, 403, blocked.body);
    assert.equal(blocked.json().error.code, 'account_suspended');
  }
  const protectedOwner = await app.inject({ method: 'PATCH', url: `/api/admin/users/${DEMO_USERS.master.id}/status`, headers: bearer(master), payload: { status: 'suspended' } });
  assert.equal(protectedOwner.statusCode, 409, protectedOwner.body);
  const restore = await app.inject({ method: 'PATCH', url: path, headers: bearer(master), payload: { status: 'active' } });
  expectSuccess(restore);
  const restored = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(student) });
  expectSuccess(restored);
  assert.equal(restored.json().user.id, DEMO_USERS.student.id);
  assert.equal(restored.json().classes.length, 1);
});

test('profile photos are decoded, resized and stripped, and class membership controls their authenticated reads', async (t) => {
  const storage = new MemoryStorage();
  const app = await createTestApp(t, { storage });
  const cr = await demoToken(app, 'cr');
  const student = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  const original = await sharp({ create: { width: 1000, height: 900, channels: 3, background: '#0B4CA1' } }).withMetadata().jpeg().toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const upload = multipart(original, 'image/jpeg', 'original.jpg');
  const saved = await app.inject({ method: 'POST', url: '/api/me/avatar', ...upload, headers: { ...upload.headers, ...bearer(cr) } });
  expectSuccess(saved);
  const body = saved.json<{ user: CurrentUser }>();
  assert.ok(body.user.avatarVersion);
  assert.equal(Object.hasOwn(body.user, 'avatar_key'), false);
  assert.equal(Object.hasOwn(body.user, 'avatarUrl'), false);
  assert.equal(storage.objects.size, 1);
  const endpoint = `/api/users/${DEMO_USERS.cr.id}/avatar`;
  assert.equal((await app.inject({ method: 'GET', url: endpoint })).statusCode, 401);
  for (const token of [cr, student, master]) {
    const read = await app.inject({ method: 'GET', url: endpoint, headers: bearer(token) });
    expectSuccess(read);
    assert.equal(read.headers['content-type'], 'image/webp');
    assert.equal(read.headers['cache-control'], 'private, no-store');
    const image = await sharp(read.rawPayload).metadata();
    assert.equal(image.format, 'webp');
    assert.equal(image.width, 512);
    assert.equal(image.height, 512);
    assert.equal(image.exif, undefined);
    assert.equal(image.xmp, undefined);
  }
  expectSuccess(await app.inject({ method: 'DELETE', url: `/api/classes/${DEMO_CLASS_ID}/members/${DEMO_USERS.student.id}`, headers: bearer(cr) }));
  assert.equal((await app.inject({ method: 'GET', url: endpoint, headers: bearer(student) })).statusCode, 404);
  expectSuccess(await app.inject({ method: 'GET', url: endpoint, headers: bearer(master) }));
});

test('invalid and excessive avatar uploads are rejected before creating any stored object', async (t) => {
  const storage = new MemoryStorage();
  const app = await createTestApp(t, { storage });
  const student = await demoToken(app, 'student');
  for (const input of [
    multipart(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', 'bad.svg'),
    multipart(Buffer.from('not actually an image'), 'image/png'),
    multipart(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#3EC44F' } }).png().toBuffer(), 'image/jpeg', 'wrong.jpg'),
  ]) {
    const result = await app.inject({ method: 'POST', url: '/api/me/avatar', ...input, headers: { ...input.headers, ...bearer(student) } });
    assert.equal(result.statusCode, 400, result.body);
  }
  const oversized = multipart(Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png');
  const rejectedSize = await app.inject({ method: 'POST', url: '/api/me/avatar', ...oversized, headers: { ...oversized.headers, ...bearer(student) } });
  assert.equal(rejectedSize.statusCode, 413, rejectedSize.body);
  const tooManyPixels = multipart(await sharp({ create: { width: 4100, height: 4100, channels: 3, background: '#ffffff' } }).png().toBuffer());
  const rejectedPixels = await app.inject({ method: 'POST', url: '/api/me/avatar', ...tooManyPixels, headers: { ...tooManyPixels.headers, ...bearer(student) } });
  assert.equal(rejectedPixels.statusCode, 400, rejectedPixels.body);
  assert.equal(storage.objects.size, 0);
});

test('photo replacement cleanup recovers from storage failure and users can remove photos after the feature is disabled', async (t) => {
  const storage = new MemoryStorage();
  const app = await createTestApp(t, { storage });
  const student = await demoToken(app, 'student');
  const master = await demoToken(app, 'master');
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#192E59' } }).png().toBuffer();
  const input = multipart(source);
  const upload = () => app.inject({ method: 'POST', url: '/api/me/avatar', ...input, headers: { ...input.headers, ...bearer(student) } });
  const firstPhoto = await upload();
  expectSuccess(firstPhoto);
  storage.failDeletes = 1;
  const replacement = await upload();
  expectSuccess(replacement);
  assert.notEqual(firstPhoto.json().user.avatarVersion, replacement.json().user.avatarVersion);
  assert.equal(storage.objects.size, 2, 'Failed deletion should remain queued, not discard the new photo.');
  const settings = (await app.inject({ method: 'GET', url: '/api/site', headers: bearer(student) })).json<{ settings: SiteSettings }>().settings;
  expectSuccess(await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: bearer(master), payload: { version: settings.version, features: { profilePhotos: false } } }));
  assert.equal((await upload()).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/users/${DEMO_USERS.student.id}/avatar`, headers: bearer(student) })).statusCode, 404);
  const removed = await app.inject({ method: 'DELETE', url: '/api/me/avatar', headers: bearer(student) });
  expectSuccess(removed);
  assert.equal(removed.json().user.avatarVersion, null);
  assert.equal(storage.objects.size, 0, 'Both queued old photo and removed current photo should be cleaned up.');
});

test('a profile storage write that fails after writing bytes is compensated without replacing the existing photo', async (t) => {
  const storage = new MemoryStorage();
  const app = await createTestApp(t, { storage });
  const student = await demoToken(app, 'student');
  const input = multipart(await sharp({ create: { width: 80, height: 80, channels: 3, background: '#192E59' } }).png().toBuffer());
  const upload = () => app.inject({ method: 'POST', url: '/api/me/avatar', ...input, headers: { ...input.headers, ...bearer(student) } });
  const existing = await upload();
  expectSuccess(existing);
  const oldKey = [...storage.objects.keys()][0];
  storage.failPutsAfterWrite = 1;
  const failed = await upload();
  assert.equal(failed.statusCode, 500, failed.body);
  assert.deepEqual([...storage.objects.keys()], [oldKey]);
  const profile = await app.inject({ method: 'GET', url: '/api/me', headers: bearer(student) });
  assert.equal(profile.json().user.avatarVersion, existing.json().user.avatarVersion);
});
