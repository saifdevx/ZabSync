import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { buildOfflineSnapshot, offlineResponse } from '../client/src/offline-data.js';
import {
  OFFLINE_DATABASE,
  OFFLINE_FILE_LIMIT_BYTES,
  OFFLINE_TTL_MS,
  OfflineStorageError,
  OfflineStore,
  pruneSnapshot,
} from '../client/src/offline-store.js';
import { DEMO_USERS } from '../server/demo.js';
import { demoToken } from './helpers.js';
import { offlineNow, offlineTestApp, pdf } from './offline-fixtures.js';

async function fixture(t: TestContext) {
  const { app, reader, upload } = await offlineTestApp(t);
  const student = await demoToken(app, 'student'),
    admin = await demoToken(app, 'admin');
  const resource = await upload(admin);
  const snapshot = await buildOfflineSnapshot(reader(student), DEMO_USERS.student.id, offlineNow);
  const adminSnapshot = await buildOfflineSnapshot(reader(admin), DEMO_USERS.admin.id, offlineNow);
  const factory = new IDBFactory();
  let time = offlineNow;
  const changes: string[] = [];
  const store = new OfflineStore(
    () => factory,
    () => time,
    (value) => changes.push(value),
  );
  return {
    store,
    factory,
    snapshot,
    adminSnapshot,
    resource,
    changes,
    advance: (amount: number) => {
      time += amount;
    },
  };
}
const isCode = (code: string) => (error: unknown) =>
  error instanceof OfflineStorageError && error.code === code;

test('legacy owner and pre-section snapshots cannot reopen and promotion to owner clears prepared private files', async (t) => {
  const { store, factory, snapshot, resource } = await fixture(t);
  const ownerSnapshot = structuredClone(snapshot);
  ownerSnapshot.me.user.role = 'master';
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  await assert.rejects(store.commit(lease, ownerSnapshot), isCode('OFFLINE_OWNER_DISABLED'));
  assert.throws(
    () => offlineResponse(ownerSnapshot, '/me', offlineNow),
    isCode('OFFLINE_OWNER_DISABLED'),
  );
  const preSectionSnapshot = { ...structuredClone(snapshot), schemaVersion: 1 };
  assert.throws(
    () => offlineResponse(preSectionSnapshot as unknown as typeof snapshot, '/me', offlineNow),
    isCode('OFFLINE_UPGRADE_REQUIRED'),
  );
  for (const legacy of [ownerSnapshot, preSectionSnapshot]) {
    const currentLease = await store.activateVerifiedAccount(snapshot.userId);
    await store.commit(currentLease, snapshot);
    await store.saveFile(currentLease, resource, new Blob([pdf]));
    // Reproduce records written before owner and one-section access safeguards existed.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(OFFLINE_DATABASE, 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put(legacy);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    assert.equal(await store.snapshot(), null);
    assert.equal(await store.active(), null);
    assert.deepEqual(await store.listFiles(snapshot.userId), []);
  }
  const newLease = await store.activateVerifiedAccount(snapshot.userId);
  await store.commit(newLease, snapshot);
  await store.saveFile(newLease, resource, new Blob([pdf]));
  assert.equal(
    await store.revalidate((await store.snapshot())!.lease, ownerSnapshot.access, ownerSnapshot.me),
    null,
  );
  assert.equal(await store.snapshot(), null);
  assert.deepEqual(await store.listFiles(snapshot.userId), []);
});

test('IndexedDB opt-in, account leases, delayed commits and conditional clearing isolate private files', async (t) => {
  const { store, factory, snapshot, adminSnapshot, resource, changes } = await fixture(t);
  const studentLease = await store.activateVerifiedAccount(snapshot.userId);
  assert.equal(await store.snapshot(), null);
  await store.commit(studentLease, snapshot);
  await store.saveFile(studentLease, resource, new Blob([pdf]));
  assert.equal(await (await store.file(studentLease.userId, resource.id))?.text(), pdf);
  assert.deepEqual(await store.listFiles(DEMO_USERS.admin.id), []);
  const reopened = new OfflineStore(
    () => factory,
    () => offlineNow,
  );
  assert.equal((await reopened.snapshot())?.snapshot.me.user.email, DEMO_USERS.student.email);
  const adminLease = await store.activateVerifiedAccount(DEMO_USERS.admin.id);
  assert.equal(await store.snapshot(), null);
  assert.deepEqual(await store.listFiles(studentLease.userId), []);
  await store.commit(adminLease, adminSnapshot);
  await assert.rejects(store.commit(studentLease, snapshot), isCode('OFFLINE_ACCOUNT_CHANGED'));
  await assert.rejects(
    store.saveFile(studentLease, resource, new Blob([pdf])),
    isCode('OFFLINE_ACCOUNT_CHANGED'),
  );
  await assert.rejects(
    store.activateVerifiedAccount(studentLease.userId, () => false),
    isCode('OFFLINE_ACCOUNT_CHANGED'),
  );
  await store.clear('logout', studentLease);
  assert.equal(
    (await store.snapshot())?.snapshot.userId,
    DEMO_USERS.admin.id,
    'An obsolete 401/logout cannot erase a new account.',
  );
  await store.clear('logout', adminLease);
  assert.equal(await reopened.snapshot(), null);
  assert.equal(await store.active(), null);
  assert.ok(changes.includes('identity'));
  assert.equal(changes.at(-1), 'logout');
});

test('seven-day expiry clears snapshots and files and access validation never extends freshness', async (t) => {
  const { store, snapshot, resource, advance } = await fixture(t);
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  await store.commit(lease, snapshot);
  await store.saveFile(lease, resource, new Blob([pdf]));
  advance(OFFLINE_TTL_MS - 1);
  await store.revalidate((await store.snapshot())!.lease, snapshot.access, snapshot.me);
  assert.equal((await store.snapshot())?.snapshot.savedAt, snapshot.savedAt);
  assert.equal((await store.listFiles(lease.userId)).length, 1);
  advance(1);
  assert.equal(await store.snapshot(), null);
  assert.equal(await store.active(), null);
  assert.deepEqual(await store.listFiles(lease.userId), []);
  assert.equal(await store.file(lease.userId, resource.id), null);
});

test('explicit file storage enforces 150 MiB atomically and replacement does not double-count', async (t) => {
  const { store, snapshot, resource } = await fixture(t);
  const big = new Blob([new Uint8Array(20 * 1024 * 1024)]),
    small = big.slice(0, 10 * 1024 * 1024);
  const items = Array.from({ length: 9 }, (_, index) => ({
    ...resource,
    id: `size-fixture-${index}`,
    sizeBytes: index === 7 ? small.size : big.size,
  }));
  snapshot.resources = items;
  snapshot.access.resources = items;
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  await store.commit(lease, snapshot);
  for (const item of items.slice(0, 7)) await store.saveFile(lease, item, big);
  await store.saveFile(lease, items[7], small);
  assert.equal(
    (await store.listFiles(lease.userId)).reduce((sum, item) => sum + item.sizeBytes, 0),
    OFFLINE_FILE_LIMIT_BYTES,
  );
  await store.saveFile(lease, items[0], big);
  await assert.rejects(store.saveFile(lease, items[8], big), isCode('OFFLINE_FILE_LIMIT'));
  assert.equal(await store.file(lease.userId, items[8].id), null);
  assert.equal((await store.listFiles(lease.userId)).length, 8);
  await store.removeFile(lease, items[0].id);
  await store.saveFile(lease, items[8], big);
  assert.equal((await store.listFiles(lease.userId)).length, 8);
});

test('a changed file version or disabled resource flag removes saved bytes without renewing the snapshot', async (t) => {
  const { store, snapshot, resource } = await fixture(t);
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  await store.commit(lease, snapshot);
  await store.saveFile(lease, resource, new Blob([pdf]));
  const access = structuredClone(snapshot.access);
  access.resources[0].updatedAt = new Date(offlineNow + 1000).toISOString();
  await store.revalidate((await store.snapshot())!.lease, access, snapshot.me);
  assert.equal(await store.file(lease.userId, resource.id), null);
  assert.deepEqual((await store.snapshot())!.snapshot.resources, []);
  await assert.rejects(
    store.saveFile(lease, resource, new Blob([pdf])),
    isCode('OFFLINE_FILE_CHANGED'),
  );
  access.settings.features.resources = false;
  access.resources = [];
  await store.revalidate((await store.snapshot())!.lease, access, snapshot.me);
  assert.equal((await store.snapshot())!.snapshot.savedAt, snapshot.savedAt);
  assert.deepEqual(await store.listFiles(lease.userId), []);
});

test('denied storage and a quota error produce useful failures while retaining the last committed snapshot', async (t) => {
  const { factory, store, snapshot } = await fixture(t);
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  await store.commit(lease, snapshot);
  const denied = new OfflineStore(
    () => undefined,
    () => offlineNow,
  );
  await assert.rejects(
    denied.activateVerifiedAccount(snapshot.userId),
    isCode('OFFLINE_STORAGE_UNAVAILABLE'),
  );
  // fake-indexeddb deliberately has no disk quota; inject a platform quota fault at its open boundary.
  const noSpace = new OfflineStore(
    () => {
      throw new DOMException('Disk full', 'QuotaExceededError');
    },
    () => offlineNow,
  );
  await assert.rejects(noSpace.commit(lease, snapshot), isCode('OFFLINE_QUOTA'));
  const reopened = new OfflineStore(
    () => factory,
    () => offlineNow,
  );
  assert.equal((await reopened.snapshot())?.snapshot.savedAt, snapshot.savedAt);
  // Real IndexedDB clone rejection aborts a write transaction instead of corrupting the old copy.
  const invalid = structuredClone(snapshot);
  Object.assign(invalid.classDetails, { cannotStoreFunctions: () => undefined });
  await assert.rejects(
    store.commit((await store.snapshot())!.lease, invalid),
    isCode('OFFLINE_STORAGE_UNAVAILABLE'),
  );
  assert.equal((await reopened.snapshot())?.snapshot.savedAt, snapshot.savedAt);
  assert.ok(
    !Object.hasOwn((await reopened.snapshot())!.snapshot.classDetails, 'cannotStoreFunctions'),
  );
});

test('same-account snapshot revisions prevent a late manifest or sync from undoing a newer access prune', async (t) => {
  const { store, snapshot, resource } = await fixture(t);
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  await store.commit(lease, snapshot);
  await store.saveFile(lease, resource, new Blob([pdf]));
  const old = (await store.snapshot())!;
  const delayedPrune = pruneSnapshot(old.snapshot, old.snapshot.access, old.snapshot.me);
  const revoked = structuredClone(snapshot.access);
  revoked.resources = [];
  revoked.settings.features.resources = false;
  await store.revalidate(old.lease, revoked, old.snapshot.me);
  await assert.rejects(store.commit(old.lease, delayedPrune), isCode('OFFLINE_CHANGED'));
  await assert.rejects(
    store.revalidate(old.lease, old.snapshot.access, old.snapshot.me),
    isCode('OFFLINE_CHANGED'),
  );
  const current = (await store.snapshot())!;
  assert.equal(current.snapshot.settings.features.resources, false);
  assert.deepEqual(current.snapshot.access.resources, []);
  assert.equal(await store.file(lease.userId, resource.id), null);
});

test('delayed expiry cleanup cannot delete a newer full sync for the same account', async (t) => {
  const { store, snapshot, resource, advance } = await fixture(t);
  const lease = await store.activateVerifiedAccount(snapshot.userId);
  const committed = await store.commit(lease, snapshot);
  await store.saveFile(committed, resource, new Blob([pdf]));
  advance(OFFLINE_TTL_MS);
  let expireObserved!: () => void, release!: () => void;
  const observed = new Promise<void>((resolve) => {
    expireObserved = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realClear = store.clear.bind(store);
  store.clear = async (reason, expected, matchRevision) => {
    if (matchRevision) {
      expireObserved();
      await delayed;
    }
    return realClear(reason, expected, matchRevision);
  };
  const oldExpiryRead = store.snapshot();
  await observed;
  const fresh = {
    ...structuredClone(snapshot),
    savedAt: new Date(offlineNow + OFFLINE_TTL_MS).toISOString(),
    expiresAt: new Date(offlineNow + 2 * OFFLINE_TTL_MS).toISOString(),
  };
  await store.commit(committed, fresh);
  release();
  assert.equal((await oldExpiryRead)?.snapshot.savedAt, fresh.savedAt);
  assert.equal((await store.snapshot())?.snapshot.savedAt, fresh.savedAt);
  assert.equal(await (await store.file(lease.userId, resource.id))?.text(), pdf);
});
