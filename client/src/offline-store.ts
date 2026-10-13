import type { Announcement, Notification, Resource, Subject } from './academic-types';
import type { SiteSettings } from './site';
import type { ClassDetail, MeResponse, PublicConfig } from './types';

export const OFFLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_FILE_LIMIT_BYTES = 150 * 1024 * 1024;
export const OFFLINE_SNAPSHOT_LIMIT_BYTES = 20 * 1024 * 1024;
export const OFFLINE_DATABASE = 'zabsync-offline-v1';

/** This is an access list, never a credential. The server computes the complete current scope. */
export interface OfflineAccess {
  userId: string;
  generatedAt: string;
  settings: SiteSettings;
  classes: { id: string; updatedAt: string }[];
  resources: Pick<
    Resource,
    'id' | 'classId' | 'updatedAt' | 'filename' | 'title' | 'mimeType' | 'sizeBytes'
  >[];
  subjectIds: string[];
  timetableSubjectIds?: string[];
  announcementIds: string[];
}
export interface OfflineLease {
  userId: string;
  epoch: string;
  revision: number;
}
interface ActiveAccount extends OfflineLease {
  enabled: boolean;
}
export interface OfflineSnapshot {
  schemaVersion: 2;
  userId: string;
  savedAt: string;
  expiresAt: string;
  me: MeResponse;
  settings: SiteSettings;
  access: OfflineAccess;
  classDetails: Record<string, ClassDetail>;
  subjects: Subject[];
  resources: Resource[];
  announcements: Announcement[];
  notifications: Notification[];
  timetables: Record<string, Record<string, unknown>>;
  exceptions: Record<string, Record<string, unknown>[]>;
  deadlines: Record<string, Record<string, unknown>[]>;
  resourceLimits: { fileBytes: number; classBytes: number };
}
export interface OfflineFileInfo {
  id: string;
  userId: string;
  classId: string;
  filename: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  resourceUpdatedAt: string;
  savedAt: string;
}
interface StoredFile extends OfflineFileInfo {
  key: string;
  blob: Blob;
}
export type OfflineChange = 'updated' | 'identity' | 'cleared' | 'logout';
export class OfflineStorageError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OfflineStorageError';
  }
}
function storageError(error: unknown): Error {
  if (error instanceof OfflineStorageError) return error;
  if ((error as { name?: string })?.name === 'QuotaExceededError')
    return new OfflineStorageError(
      'OFFLINE_QUOTA',
      'This browser has run out of storage. Remove an offline file or free device space, then try again.',
    );
  return new OfflineStorageError(
    'OFFLINE_STORAGE_UNAVAILABLE',
    'Offline storage is unavailable in this browser. Your online account still works; use a normal browser window with website storage enabled.',
  );
}
function randomEpoch() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}-${Math.random()}`;
}
function getRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Offline transaction aborted.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Offline transaction failed.'));
  });
}
const mismatch = () =>
  new OfflineStorageError(
    'OFFLINE_ACCOUNT_CHANGED',
    'The active account changed. Sign in again before preparing offline data.',
  );
const staleSnapshot = () =>
  new OfflineStorageError(
    'OFFLINE_CHANGED',
    'Offline information changed while this action was running. Refresh and try again.',
  );
const ownerOfflineDisabled = () =>
  new OfflineStorageError(
    'OFFLINE_OWNER_DISABLED',
    'Master Admin requires a connection. Use your university student account to prepare class information offline.',
  );
function assertLease(
  active: ActiveAccount | undefined,
  lease: OfflineLease,
): asserts active is ActiveAccount {
  if (!active || active.userId !== lease.userId || active.epoch !== lease.epoch) throw mismatch();
}
function validSnapshot(snapshot: OfflineSnapshot | undefined, now: number) {
  return (
    !!snapshot &&
    snapshot.schemaVersion === 2 &&
    snapshot.me.user.id === snapshot.userId &&
    snapshot.me.user.role === 'student' &&
    snapshot.me.user.status === 'active' &&
    Date.parse(snapshot.expiresAt) > now &&
    Date.parse(snapshot.savedAt) <= now + 60_000 &&
    Date.parse(snapshot.expiresAt) - Date.parse(snapshot.savedAt) <= OFFLINE_TTL_MS
  );
}
export function safeOfflineMe(
  me: MeResponse,
  classIds = new Set(me.classes.map((item) => item.id)),
): MeResponse {
  if (me.user.role === 'master') throw ownerOfflineDisabled();
  return {
    user: {
      id: me.user.id,
      email: me.user.email,
      displayName: me.user.displayName,
      username: me.user.username ?? null,
      avatarVersion: null,
      role: me.user.role,
      status: me.user.status,
    },
    classes: me.classes.filter((item) => classIds.has(item.id)),
    section: me.section ? { ...me.section, pendingClassId: null } : undefined,
    subjectRequests: [],
    canCreateClass: false,
    pendingMemberships: [],
    classRequests: [],
  };
}
export function safeOfflineClass(value: ClassDetail): ClassDetail {
  return {
    class: value.class,
    myRole: value.myRole,
    members: [],
    pendingMembers: [],
    invite: null,
    pagination: { limit: 50, offset: 0, membersTotal: 0, pendingMembersTotal: 0 },
  };
}

/** Pruning never extends the freshness window. Only a complete successful sync does that. */
export function pruneSnapshot(
  snapshot: OfflineSnapshot,
  access: OfflineAccess,
  me?: MeResponse,
): OfflineSnapshot {
  if (snapshot.userId !== access.userId || (me && me.user.id !== access.userId)) throw mismatch();
  const classes = new Set(access.classes.map((item) => item.id));
  const subjects = new Set(access.subjectIds);
  const timetableSubjects = new Set(access.timetableSubjectIds ?? access.subjectIds);
  const resources = new Map(access.resources.map((item) => [item.id, item]));
  const notices = new Set(access.announcementIds);
  const flags = access.settings.features;
  const keepScoped = (item: { classId?: unknown; subjectId?: unknown }) =>
    (!item.classId || classes.has(String(item.classId))) &&
    (!item.subjectId || (flags.subjects && subjects.has(String(item.subjectId))));
  const keepTimetableScoped = (item: { classId?: unknown; subjectId?: unknown }) =>
    (!item.classId || classes.has(String(item.classId))) &&
    (!item.subjectId || (flags.subjects && timetableSubjects.has(String(item.subjectId))));
  const keepResource = (item: Resource) =>
    flags.resources && keepScoped(item) && resources.get(item.id)?.updatedAt === item.updatedAt;
  const entryIds = new Set(
    Object.values(snapshot.timetables).flatMap((item) =>
      (Array.isArray(item.entries) ? item.entries : [])
        .filter(keepTimetableScoped)
        .map((entry: { id: string }) => entry.id),
    ),
  );
  const keepPlanning = (item: { classId?: unknown; subjectId?: unknown; entryId?: unknown }) =>
    keepTimetableScoped(item) && (!item.entryId || entryIds.has(String(item.entryId)));
  const filterClasses = <T>(value: Record<string, T>, transform: (entry: T) => T) =>
    Object.fromEntries(
      Object.entries(value)
        .filter(([id]) => classes.has(id))
        .map(([id, item]) => [id, transform(item)]),
    );
  return {
    ...snapshot,
    access,
    settings: access.settings,
    me: safeOfflineMe(me ?? snapshot.me, classes),
    classDetails: filterClasses(snapshot.classDetails, safeOfflineClass),
    subjects: flags.subjects
      ? snapshot.subjects.filter((item) => subjects.has(item.id) && keepScoped(item))
      : [],
    resources: snapshot.resources.filter(keepResource),
    announcements: flags.announcements
      ? snapshot.announcements
          .filter((item) => notices.has(item.id) && keepScoped(item))
          .map((item) => ({
            ...item,
            canManage: false,
            resources: item.resources.filter(keepResource),
          }))
      : [],
    notifications: flags.announcements
      ? snapshot.notifications.filter(
          (item) => notices.has(item.announcementId) && keepScoped(item),
        )
      : [],
    timetables: flags.timetable
      ? filterClasses(snapshot.timetables, (item) => ({
          ...item,
          canManage: false,
          entries: (Array.isArray(item.entries) ? item.entries : []).filter(keepTimetableScoped),
          exceptions: (Array.isArray(item.exceptions) ? item.exceptions : []).filter(keepPlanning),
          sessions: (Array.isArray(item.sessions) ? item.sessions : []).filter(keepPlanning),
        }))
      : {},
    exceptions: flags.timetable
      ? filterClasses(snapshot.exceptions, (items) => items.filter(keepPlanning))
      : {},
    deadlines: flags.deadlines
      ? filterClasses(snapshot.deadlines, (items) => items.filter(keepScoped))
      : {},
  };
}

/** A single enabled account per browser origin prevents shared-device account leakage. */
export class OfflineStore {
  constructor(
    private factory: () => IDBFactory | undefined = () => globalThis.indexedDB,
    private now: () => number = () => Date.now(),
    private onChange: (change: OfflineChange) => void = () => {},
    private name = OFFLINE_DATABASE,
  ) {}

  private async database(): Promise<IDBDatabase> {
    try {
      const factory = this.factory();
      if (!factory) throw new Error('IndexedDB is unavailable.');
      return await new Promise((resolve, reject) => {
        const request = factory.open(this.name, 1);
        let blocked = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('meta');
          db.createObjectStore('snapshots', { keyPath: 'userId' });
          db.createObjectStore('files', { keyPath: 'key' });
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
          blocked = true;
          reject(new Error('Close older app tabs and retry.'));
        };
        request.onsuccess = () => {
          if (blocked) {
            request.result.close();
            return;
          }
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
      });
    } catch (error) {
      throw storageError(error);
    }
  }

  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.database();
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = db.transaction(stores, mode);
      done = completed(transaction);
      // Attach a rejection handler immediately: a quota error can abort before work returns.
      void done.catch(() => {});
      const result = await work(transaction);
      await done;
      return result;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        /* Already completed or aborted. */
      }
      await done?.catch(() => {});
      throw storageError(error);
    } finally {
      db.close();
    }
  }

  async savePublicConfig(config: PublicConfig): Promise<void> {
    // The public Firebase app configuration contains no login/session token.
    await this.transaction(['meta'], 'readwrite', async (tx) => {
      tx.objectStore('meta').put({ config, savedAt: this.now() }, 'public-config');
    });
  }
  async publicConfig(): Promise<PublicConfig | null> {
    return this.transaction(['meta'], 'readonly', async (tx) => {
      const value = await getRequest<{ config: PublicConfig; savedAt: number } | undefined>(
        tx.objectStore('meta').get('public-config'),
      );
      return value &&
        value.savedAt <= this.now() + 60_000 &&
        this.now() - value.savedAt < OFFLINE_TTL_MS
        ? value.config
        : null;
    });
  }
  async active(): Promise<ActiveAccount | null> {
    return this.transaction(
      ['meta'],
      'readonly',
      async (tx) =>
        (await getRequest<ActiveAccount | undefined>(tx.objectStore('meta').get('active'))) ?? null,
    );
  }
  async activateVerifiedAccount(
    userId: string,
    guard: () => boolean = () => true,
  ): Promise<OfflineLease> {
    let changed = false;
    const result = await this.transaction(
      ['meta', 'snapshots', 'files'],
      'readwrite',
      async (tx) => {
        const meta = tx.objectStore('meta');
        const active = await getRequest<ActiveAccount | undefined>(meta.get('active'));
        if (!guard()) throw mismatch();
        if (active?.userId === userId)
          return { userId, epoch: active.epoch, revision: active.revision ?? 0 };
        changed = true;
        const next = { userId, epoch: randomEpoch(), revision: 0, enabled: false };
        tx.objectStore('snapshots').clear();
        tx.objectStore('files').clear();
        meta.put(next, 'active');
        return { userId, epoch: next.epoch, revision: 0 };
      },
    );
    if (changed) this.onChange('identity');
    return result;
  }
  async snapshot(
    expectedUserId?: string,
  ): Promise<{ snapshot: OfflineSnapshot; lease: OfflineLease } | null> {
    const result = await this.transaction(['meta', 'snapshots'], 'readonly', async (tx) => {
      const active = await getRequest<ActiveAccount | undefined>(
        tx.objectStore('meta').get('active'),
      );
      if (!active?.enabled || (expectedUserId && active.userId !== expectedUserId)) return null;
      const snapshot = await getRequest<OfflineSnapshot | undefined>(
        tx.objectStore('snapshots').get(active.userId),
      );
      return { active, snapshot };
    });
    if (!result) return null;
    if (!validSnapshot(result.snapshot, this.now())) {
      const cleared = await this.clear('cleared', result.active, true);
      return cleared ? null : this.snapshot(expectedUserId);
    }
    return {
      snapshot: result.snapshot!,
      lease: {
        userId: result.active.userId,
        epoch: result.active.epoch,
        revision: result.active.revision ?? 0,
      },
    };
  }
  async commit(lease: OfflineLease, snapshot: OfflineSnapshot): Promise<OfflineLease> {
    if (snapshot.me.user.role === 'master') throw ownerOfflineDisabled();
    if (snapshot.userId !== lease.userId || !validSnapshot(snapshot, this.now())) throw mismatch();
    if (new Blob([JSON.stringify(snapshot)]).size > OFFLINE_SNAPSHOT_LIMIT_BYTES)
      throw new OfflineStorageError(
        'OFFLINE_SNAPSHOT_LIMIT',
        'This account has more than 20 MiB of class information. Offline preparation was not saved; online access is unchanged.',
      );
    const nextLease = await this.transaction(
      ['meta', 'snapshots', 'files'],
      'readwrite',
      async (tx) => {
        const meta = tx.objectStore('meta');
        const active = await getRequest<ActiveAccount | undefined>(meta.get('active'));
        assertLease(active, lease);
        if ((active.revision ?? 0) !== lease.revision) throw staleSnapshot();
        tx.objectStore('snapshots').put(snapshot);
        const updated = { ...active, enabled: true, revision: lease.revision + 1 };
        meta.put(updated, 'active');
        const files = await getRequest<StoredFile[]>(tx.objectStore('files').getAll());
        const accessible = new Map(snapshot.access.resources.map((item) => [item.id, item]));
        for (const file of files) {
          const current = accessible.get(file.id);
          if (
            file.userId !== lease.userId ||
            !current ||
            current.updatedAt !== file.resourceUpdatedAt ||
            current.sizeBytes !== file.sizeBytes ||
            !snapshot.settings.features.resources
          )
            tx.objectStore('files').delete(file.key);
        }
        return { userId: lease.userId, epoch: lease.epoch, revision: updated.revision };
      },
    );
    this.onChange('updated');
    return nextLease;
  }
  async revalidate(
    lease: OfflineLease,
    access: OfflineAccess,
    me: MeResponse,
  ): Promise<{ snapshot: OfflineSnapshot; lease: OfflineLease } | null> {
    const stored = await this.snapshot(lease.userId);
    if (!stored) return null;
    if (stored.lease.epoch !== lease.epoch) throw mismatch();
    if (stored.lease.revision !== lease.revision) throw staleSnapshot();
    if (me.user.role === 'master') {
      await this.clear('cleared', lease, true);
      return null;
    }
    const snapshot = pruneSnapshot(stored.snapshot, access, me);
    const nextLease = await this.commit(lease, snapshot);
    return { snapshot, lease: nextLease };
  }
  async clear(
    reason: OfflineChange = 'cleared',
    expected?: OfflineLease,
    matchRevision = false,
  ): Promise<boolean> {
    let changed = false;
    await this.transaction(['meta', 'snapshots', 'files'], 'readwrite', async (tx) => {
      const meta = tx.objectStore('meta');
      const active = await getRequest<ActiveAccount | undefined>(meta.get('active'));
      // A slow failure belonging to an old account must not erase the new account's data.
      if (
        expected &&
        (!active || active.userId !== expected.userId || active.epoch !== expected.epoch)
      )
        return;
      if (expected && matchRevision && (active?.revision ?? 0) !== (expected.revision ?? 0)) return;
      tx.objectStore('snapshots').clear();
      tx.objectStore('files').clear();
      meta.delete('active');
      changed = true;
    });
    if (changed) this.onChange(reason);
    return changed;
  }
  async saveFile(lease: OfflineLease, resource: Resource, blob: Blob): Promise<void> {
    await this.transaction(['meta', 'snapshots', 'files'], 'readwrite', async (tx) => {
      const active = await getRequest<ActiveAccount | undefined>(
        tx.objectStore('meta').get('active'),
      );
      assertLease(active, lease);
      const snapshot = await getRequest<OfflineSnapshot | undefined>(
        tx.objectStore('snapshots').get(lease.userId),
      );
      if (!active.enabled || !validSnapshot(snapshot, this.now()))
        throw new OfflineStorageError(
          'OFFLINE_NOT_PREPARED',
          'Prepare offline access before saving a file to this device.',
        );
      const current = snapshot!.access.resources.find((item) => item.id === resource.id);
      if (
        !snapshot!.settings.features.resources ||
        !current ||
        current.updatedAt !== resource.updatedAt ||
        current.classId !== resource.classId ||
        current.sizeBytes !== blob.size
      )
        throw new OfflineStorageError(
          'OFFLINE_FILE_CHANGED',
          'This file or your access changed. Refresh offline access and save the current file again.',
        );
      const files = await getRequest<StoredFile[]>(tx.objectStore('files').getAll());
      const total =
        files
          .filter((item) => item.id !== resource.id)
          .reduce((sum, item) => sum + item.sizeBytes, 0) + blob.size;
      if (total > OFFLINE_FILE_LIMIT_BYTES)
        throw new OfflineStorageError(
          'OFFLINE_FILE_LIMIT',
          'Offline files are limited to 150 MiB on this device. Remove a saved file before adding another.',
        );
      tx.objectStore('files').put({
        key: `${lease.userId}:${resource.id}`,
        id: resource.id,
        userId: lease.userId,
        classId: resource.classId,
        filename: current.filename,
        title: current.title,
        mimeType: current.mimeType,
        sizeBytes: blob.size,
        resourceUpdatedAt: resource.updatedAt,
        savedAt: new Date(this.now()).toISOString(),
        blob,
      } satisfies StoredFile);
    });
    this.onChange('updated');
  }
  private async files(userId: string): Promise<StoredFile[]> {
    return this.transaction(['meta', 'snapshots', 'files'], 'readonly', async (tx) => {
      const active = await getRequest<ActiveAccount | undefined>(
        tx.objectStore('meta').get('active'),
      );
      if (!active?.enabled || active.userId !== userId) return [];
      const snapshot = await getRequest<OfflineSnapshot | undefined>(
        tx.objectStore('snapshots').get(userId),
      );
      if (!validSnapshot(snapshot, this.now())) return [];
      const resources = new Map(snapshot!.access.resources.map((item) => [item.id, item]));
      return (await getRequest<StoredFile[]>(tx.objectStore('files').getAll())).filter(
        (file) =>
          file.userId === userId &&
          snapshot!.settings.features.resources &&
          resources.get(file.id)?.updatedAt === file.resourceUpdatedAt,
      );
    });
  }
  async listFiles(userId: string): Promise<OfflineFileInfo[]> {
    return (await this.files(userId))
      .map(({ key: _key, blob: _blob, ...info }) => info)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async file(userId: string, id: string): Promise<Blob | null> {
    return (await this.files(userId)).find((item) => item.id === id)?.blob ?? null;
  }
  async removeFile(lease: OfflineLease, id: string): Promise<void> {
    await this.transaction(['meta', 'files'], 'readwrite', async (tx) => {
      const active = await getRequest<ActiveAccount | undefined>(
        tx.objectStore('meta').get('active'),
      );
      assertLease(active, lease);
      tx.objectStore('files').delete(`${lease.userId}:${id}`);
    });
    this.onChange('updated');
  }
}

const changeEvent = 'zabsync:offline-changed';
const signalKey = 'zabsync.offline.signal';
function notifyChange(change: OfflineChange) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: change }));
  const message = { change, nonce: randomEpoch() };
  try {
    window.localStorage.setItem(signalKey, JSON.stringify(message));
  } catch {
    /* Private mode can deny localStorage as well. */
  }
  try {
    if (typeof window.BroadcastChannel === 'function') {
      const channel = new window.BroadcastChannel(changeEvent);
      try {
        channel.postMessage(message);
      } finally {
        channel.close();
      }
    }
  } catch {
    /* Storage events still propagate when BroadcastChannel is unavailable or denied. */
  }
}
export const offlineStore = new OfflineStore(undefined, undefined, notifyChange);
export function subscribeOfflineChanges(
  callback: (change: OfflineChange, external: boolean) => void,
): () => void {
  const local = (event: Event) => callback((event as CustomEvent<OfflineChange>).detail, false);
  const seen = new Set<string>();
  const receive = (message: { change?: OfflineChange; nonce?: string }) => {
    if (
      !message.change ||
      !message.nonce ||
      !['updated', 'identity', 'cleared', 'logout'].includes(message.change) ||
      seen.has(message.nonce)
    )
      return;
    seen.add(message.nonce);
    if (seen.size > 50) seen.delete(seen.values().next().value!);
    callback(message.change, true);
  };
  const crossTab = (event: StorageEvent) => {
    if (event.key !== signalKey || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      /* Unrelated or invalid storage messages never affect identity. */
    }
  };
  window.addEventListener(changeEvent, local);
  window.addEventListener('storage', crossTab);
  let channel: BroadcastChannel | null = null;
  try {
    channel =
      typeof window.BroadcastChannel === 'function'
        ? new window.BroadcastChannel(changeEvent)
        : null;
    if (channel) channel.onmessage = (event) => receive(event.data ?? {});
  } catch {
    /* Storage events are the fallback when channel creation is blocked. */
  }
  return () => {
    window.removeEventListener(changeEvent, local);
    window.removeEventListener('storage', crossTab);
    channel?.close();
  };
}
