import {
  addCalendarDays,
  isCalendarDate,
  karachiDate,
  mondayFor,
  resolveSchedule,
  type TimetableEntry,
  type ScheduleException,
} from '../../server/schedule.js';
import type {
  Announcement,
  AnnouncementListData,
  Notification,
  NotificationsData,
  Resource,
  ResourceListData,
  Subject,
  SubjectList,
} from './academic-types';
import {
  OFFLINE_TTL_MS,
  OfflineStorageError,
  pruneSnapshot,
  safeOfflineClass,
  safeOfflineMe,
  type OfflineAccess,
  type OfflineSnapshot,
} from './offline-store';
import type { ClassDetail, MeResponse } from './types';

export type OnlineReader = <T>(path: string, options?: RequestInit) => Promise<T>;
const MAX_CLASSES = 1;
const MAX_ROWS = 10_000;
const changed = () =>
  new OfflineStorageError(
    'OFFLINE_CHANGED',
    'Class information or access changed during preparation. Nothing partial was saved. Please refresh offline access again.',
  );
function sameIds(a: string[], b: string[]) {
  const sorted = [...b].sort();
  return a.length === b.length && [...a].sort().every((id, index) => id === sorted[index]);
}
function scopeFingerprint(access: OfflineAccess) {
  return JSON.stringify({
    userId: access.userId,
    settings: access.settings,
    classes: [...access.classes].sort((a, b) => a.id.localeCompare(b.id)),
    resources: [...access.resources].sort((a, b) => a.id.localeCompare(b.id)),
    subjects: [...access.subjectIds].sort(),
    timetableSubjects: [...(access.timetableSubjectIds ?? access.subjectIds)].sort(),
    notices: [...access.announcementIds].sort(),
  });
}
async function pages<T extends { id: string }>(request: OnlineReader, path: string, field: string) {
  const all: T[] = [];
  let total: number | undefined;
  let last: Record<string, unknown> = {};
  for (let offset = 0; ; offset += 100) {
    const data = await request<Record<string, unknown>>(
      `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`,
    );
    const pagination = data.pagination as
      { total: number; offset: number; limit: number } | undefined;
    const items = data[field] as T[] | undefined;
    if (
      !pagination ||
      !Array.isArray(items) ||
      !Number.isSafeInteger(pagination.total) ||
      pagination.total < 0 ||
      pagination.offset !== offset ||
      pagination.limit !== 100 ||
      (total !== undefined && total !== pagination.total)
    )
      throw changed();
    total = pagination.total;
    if (total > MAX_ROWS)
      throw new OfflineStorageError(
        'OFFLINE_TOO_MANY_ITEMS',
        'A list contains more than 10,000 items. Offline preparation was not saved; your online account is unchanged.',
      );
    all.push(...items);
    last = data;
    if (all.length >= total) break;
    if (items.length !== 100) throw changed();
  }
  if (new Set(all.map((item) => item.id)).size !== total || all.length !== total) throw changed();
  return { items: all, extra: last };
}
function unique<T extends { id: string }>(values: T[]) {
  const result = [...new Map(values.map((item) => [item.id, item])).values()];
  if (result.length > MAX_ROWS)
    throw new OfflineStorageError(
      'OFFLINE_TOO_MANY_ITEMS',
      'This account has more than 10,000 items of one type. Offline preparation was not saved.',
    );
  return result;
}

/** Uses only authenticated GETs; does not store arbitrary API responses or partially completed syncs. */
export async function buildOfflineSnapshot(
  request: OnlineReader,
  expectedUserId: string,
  now = Date.now(),
): Promise<OfflineSnapshot> {
  const me = await request<MeResponse>('/me');
  if (me.user.id !== expectedUserId || me.user.status !== 'active') throw changed();
  if (me.user.role === 'master')
    throw new OfflineStorageError(
      'OFFLINE_OWNER_DISABLED',
      'Master Admin requires a connection. Use your university student account to prepare class information offline.',
    );
  const before = await request<OfflineAccess>('/offline/access');
  if (
    me.user.id !== expectedUserId ||
    before.userId !== expectedUserId ||
    me.user.status !== 'active'
  )
    throw changed();
  const classIds = new Set(before.classes.map((item) => item.id));
  if (classIds.size > MAX_CLASSES)
    throw new OfflineStorageError(
      'OFFLINE_TOO_MANY_CLASSES',
      'Your section assignment needs confirmation. Refresh online or ask the owner to resolve older memberships.',
    );
  const membershipIds = me.classes.map((item) => item.id).filter((id) => classIds.has(id));
  if (!sameIds([...classIds], membershipIds)) throw changed();
  const snapshot: OfflineSnapshot = {
    schemaVersion: 2,
    userId: expectedUserId,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OFFLINE_TTL_MS).toISOString(),
    me: safeOfflineMe(me, classIds),
    settings: before.settings,
    access: before,
    classDetails: {},
    subjects: [],
    resources: [],
    announcements: [],
    notifications: [],
    timetables: {},
    exceptions: {},
    deadlines: {},
    resourceLimits: { fileBytes: 0, classBytes: 0 },
  };
  const flags = before.settings.features;
  if (flags.announcements) {
    const [announcements, notifications] = await Promise.all([
      pages<Announcement>(request, '/announcements?scope=global', 'announcements'),
      pages<Notification>(request, '/notifications', 'notifications'),
    ]);
    snapshot.announcements.push(...announcements.items);
    snapshot.notifications = notifications.items;
  }
  // Students and Class Admins save only their joined classes. The owner console stays online-only.
  for (const id of classIds) {
    const base = `/classes/${encodeURIComponent(id)}`;
    const [detail, subjects, resources, announcements, timetable, exceptions, deadlines] =
      await Promise.all([
        request<ClassDetail>(`${base}?limit=1&offset=0`),
        flags.subjects ? pages<Subject>(request, `${base}/subjects`, 'subjects') : null,
        flags.resources
          ? pages<Resource>(request, `/resources?classId=${encodeURIComponent(id)}`, 'resources')
          : null,
        flags.announcements
          ? pages<Announcement>(
              request,
              `/announcements?classId=${encodeURIComponent(id)}`,
              'announcements',
            )
          : null,
        flags.timetable ? request<Record<string, unknown>>(`${base}/timetable`) : null,
        flags.timetable
          ? pages<{ id: string; [key: string]: unknown }>(
              request,
              `${base}/schedule-exceptions?all=true`,
              'exceptions',
            )
          : null,
        flags.deadlines
          ? pages<{ id: string; [key: string]: unknown }>(request, `${base}/deadlines`, 'deadlines')
          : null,
      ]);
    snapshot.classDetails[id] = safeOfflineClass(detail);
    snapshot.subjects.push(...(subjects?.items ?? []));
    snapshot.resources.push(...(resources?.items ?? []));
    snapshot.announcements.push(...(announcements?.items ?? []));
    if (resources)
      snapshot.resourceLimits = resources.extra.limits as OfflineSnapshot['resourceLimits'];
    if (timetable) snapshot.timetables[id] = { ...timetable, canManage: false };
    if (exceptions) snapshot.exceptions[id] = exceptions.items;
    if (deadlines) snapshot.deadlines[id] = deadlines.items;
  }
  snapshot.subjects = unique(snapshot.subjects).map((item) => ({ ...item, canManage: false }));
  snapshot.resources = unique(snapshot.resources).map((item) => ({ ...item, canManage: false }));
  snapshot.announcements = unique(snapshot.announcements).map((item) => ({
    ...item,
    canManage: false,
    resources: item.resources.map((resource) => ({ ...resource, canManage: false })),
  }));
  // Repeat authoritative identity + scope validation after all reads, before the atomic write.
  const afterMe = await request<MeResponse>('/me');
  const after = await request<OfflineAccess>('/offline/access');
  if (
    afterMe.user.id !== expectedUserId ||
    afterMe.user.status !== 'active' ||
    afterMe.user.role !== me.user.role ||
    scopeFingerprint(before) !== scopeFingerprint(after) ||
    !sameIds(
      after.classes.map((item) => item.id),
      afterMe.classes.map((item) => item.id).filter((id) => classIds.has(id)),
    ) ||
    !sameIds(
      snapshot.resources.map((item) => item.id),
      after.resources.map((item) => item.id),
    ) ||
    !sameIds(
      snapshot.subjects.map((item) => item.id),
      after.subjectIds,
    ) ||
    !sameIds(
      snapshot.announcements.map((item) => item.id),
      after.announcementIds,
    )
  )
    throw changed();
  return pruneSnapshot(snapshot, after, afterMe);
}

function notSaved(): never {
  throw new OfflineStorageError(
    'OFFLINE_VIEW_UNAVAILABLE',
    'This view is not available offline. Reconnect to load it.',
  );
}
function assertParams(params: URLSearchParams, allowed: string[]) {
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length > 1) notSaved();
}
function pagination(params: URLSearchParams, total: number, defaultLimit = 50) {
  const limit = Number(params.get('limit') ?? defaultLimit),
    offset = Number(params.get('offset') ?? 0);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100_000
  )
    notSaved();
  return { limit, offset, total };
}
function paginate<T>(items: T[], params: URLSearchParams) {
  const page = pagination(params, items.length);
  return { values: items.slice(page.offset, page.offset + page.limit), pagination: page };
}
const priority = { normal: 0, important: 1, urgent: 2 };
const byCreated = (a: { id: string; createdAt: string }, b: { id: string; createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
function search(params: URLSearchParams, values: unknown[]) {
  const needle = (params.get('q') ?? '').trim().toLocaleLowerCase();
  return (
    !needle ||
    values.some((value) =>
      String(value ?? '')
        .toLocaleLowerCase()
        .includes(needle),
    )
  );
}
function bool(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (value !== null && value !== 'true' && value !== 'false') notSaved();
  return value === 'true';
}
function scoped(
  params: URLSearchParams,
  item: { classId: string | null; subjectId: string | null; scope?: string },
) {
  return (
    (!params.get('classId') || item.classId === params.get('classId') || item.scope === 'global') &&
    (!params.get('subjectId') || item.subjectId === params.get('subjectId')) &&
    (!params.get('scope') || item.scope === params.get('scope'))
  );
}

/** An explicit dataset responder lets existing read pages use their own safe filters and page sizes. */
export function offlineResponse<T>(snapshot: OfflineSnapshot, path: string, now = Date.now()): T {
  if (snapshot.schemaVersion !== 2)
    throw new OfflineStorageError(
      'OFFLINE_UPGRADE_REQUIRED',
      'Reconnect and prepare offline access again to apply your current section and subjects.',
    );
  if (snapshot.me.user.role === 'master')
    throw new OfflineStorageError(
      'OFFLINE_OWNER_DISABLED',
      'Master Admin requires a connection. Sign in online to manage ZabSync.',
    );
  if (Date.parse(snapshot.expiresAt) <= now)
    throw new OfflineStorageError(
      'OFFLINE_EXPIRED',
      'Your offline information is more than seven days old. Reconnect and refresh it.',
    );
  if (!path.startsWith('/') || path.startsWith('//')) notSaved();
  const url = new URL(path, 'https://offline.invalid');
  const params = url.searchParams,
    pathname = url.pathname,
    flags = snapshot.settings.features;
  let result: unknown;
  if (pathname === '/me' && !url.search) result = snapshot.me;
  else if (pathname === '/site' && !url.search) result = { settings: snapshot.settings };
  else if (/^\/classes\/[^/]+$/.test(pathname)) {
    assertParams(params, ['limit', 'offset']);
    const id = decodeURIComponent(pathname.split('/')[2]);
    const detail = snapshot.classDetails[id];
    if (!detail) notSaved();
    result = { ...detail, pagination: { ...detail.pagination, ...pagination(params, 0) } };
  } else if (/^\/classes\/[^/]+\/subjects$/.test(pathname)) {
    if (!flags.subjects) notSaved();
    assertParams(params, ['limit', 'offset', 'q', 'deleted']);
    if (bool(params, 'deleted')) notSaved();
    const classId = decodeURIComponent(pathname.split('/')[2]);
    if (!snapshot.classDetails[classId]) notSaved();
    const list = snapshot.subjects
      .filter(
        (item) =>
          item.classId === classId && search(params, [item.name, item.code, item.instructor]),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const page = paginate(list, params);
    result = { subjects: page.values, pagination: page.pagination } satisfies SubjectList;
  } else if (/^\/subjects\/[^/]+$/.test(pathname) && !url.search) {
    if (!flags.subjects) notSaved();
    const subject = snapshot.subjects.find(
      (item) => item.id === decodeURIComponent(pathname.split('/')[2]),
    );
    if (!subject) notSaved();
    result = { subject };
  } else if (pathname === '/resources') {
    if (!flags.resources) notSaved();
    assertParams(params, ['classId', 'subjectId', 'q', 'saved', 'deleted', 'limit', 'offset']);
    if (bool(params, 'deleted')) notSaved();
    const list = snapshot.resources
      .filter(
        (item) =>
          scoped(params, item) &&
          (!bool(params, 'saved') || item.saved) &&
          search(params, [item.title, item.description, item.filename]),
      )
      .sort(byCreated);
    const page = paginate(list, params);
    result = {
      resources: page.values,
      pagination: page.pagination,
      limits: snapshot.resourceLimits,
      storageUsedBytes: null,
    } satisfies ResourceListData & { storageUsedBytes: null };
  } else if (/^\/resources\/[^/]+$/.test(pathname) && !url.search) {
    if (!flags.resources) notSaved();
    const resource = snapshot.resources.find(
      (item) => item.id === decodeURIComponent(pathname.split('/')[2]),
    );
    if (!resource) notSaved();
    result = { resource };
  } else if (pathname === '/announcements') {
    if (!flags.announcements) notSaved();
    assertParams(params, [
      'classId',
      'subjectId',
      'scope',
      'q',
      'saved',
      'deleted',
      'limit',
      'offset',
    ]);
    if (bool(params, 'deleted')) notSaved();
    const list = snapshot.announcements
      .filter(
        (item) =>
          scoped(params, item) &&
          (!bool(params, 'saved') || item.saved) &&
          search(params, [item.title, item.body]),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          priority[b.priority] - priority[a.priority] ||
          byCreated(a, b),
      );
    const page = paginate(list, params);
    result = {
      announcements: page.values,
      pagination: page.pagination,
    } satisfies AnnouncementListData;
  } else if (/^\/announcements\/[^/]+$/.test(pathname) && !url.search) {
    if (!flags.announcements) notSaved();
    const announcement = snapshot.announcements.find(
      (item) => item.id === decodeURIComponent(pathname.split('/')[2]),
    );
    if (!announcement) notSaved();
    result = { announcement };
  } else if (pathname === '/notifications') {
    if (!flags.announcements) notSaved();
    assertParams(params, ['unread', 'limit', 'offset']);
    const list = snapshot.notifications.filter((item) => !bool(params, 'unread') || !item.read);
    const page = paginate(list, params);
    result = {
      notifications: page.values,
      pagination: page.pagination,
      unreadCount: snapshot.notifications.filter((item) => !item.read).length,
    } satisfies NotificationsData;
  } else if (/^\/classes\/[^/]+\/timetable$/.test(pathname)) {
    if (!flags.timetable) notSaved();
    assertParams(params, ['week']);
    const classId = decodeURIComponent(pathname.split('/')[2]),
      data = snapshot.timetables[classId];
    if (!data) notSaved();
    const date = params.get('week') ?? karachiDate(new Date(now));
    if (!isCalendarDate(date)) notSaved();
    const weekStart = mondayFor(date),
      weekEnd = addCalendarDays(weekStart, 6);
    const entries = data.entries as TimetableEntry[];
    const exceptions = (snapshot.exceptions[classId] ?? []) as unknown as ScheduleException[];
    result = {
      entries,
      exceptions: exceptions.filter(
        (item) =>
          (item.date >= weekStart && item.date <= weekEnd) ||
          (item.originalDate && item.originalDate >= weekStart && item.originalDate <= weekEnd),
      ),
      sessions: resolveSchedule(entries, exceptions, date),
      weekStart,
      weekEnd,
      timezone: 'Asia/Karachi',
      canManage: false,
    };
  } else if (/^\/classes\/[^/]+\/schedule-exceptions$/.test(pathname)) {
    if (!flags.timetable) notSaved();
    assertParams(params, ['all', 'from', 'to', 'limit', 'offset']);
    const classId = decodeURIComponent(pathname.split('/')[2]);
    if (!snapshot.exceptions[classId]) notSaved();
    const all = bool(params, 'all'),
      today = karachiDate(new Date(now));
    const from = params.get('from') ?? addCalendarDays(today, -30),
      to = params.get('to') ?? addCalendarDays(today, 180);
    if (!isCalendarDate(from) || !isCalendarDate(to)) notSaved();
    const list = snapshot.exceptions[classId].filter(
      (item) =>
        all ||
        (String(item.date) >= from && String(item.date) <= to) ||
        (item.originalDate && String(item.originalDate) >= from && String(item.originalDate) <= to),
    );
    const page = paginate(list, params);
    result = {
      exceptions: page.values,
      pagination: page.pagination,
      from: all ? null : from,
      to: all ? null : to,
      timezone: 'Asia/Karachi',
      canManage: false,
    };
  } else if (/^\/classes\/[^/]+\/deadlines$/.test(pathname)) {
    if (!flags.deadlines) notSaved();
    assertParams(params, ['from', 'to', 'kind', 'completed', 'subjectId', 'limit', 'offset']);
    const classId = decodeURIComponent(pathname.split('/')[2]);
    if (!snapshot.deadlines[classId]) notSaved();
    if (
      params.get('subjectId') &&
      !snapshot.subjects.some(
        (subject) => subject.id === params.get('subjectId') && subject.classId === classId,
      )
    )
      notSaved();
    const list = snapshot.deadlines[classId]
      .filter(
        (item) =>
          (!params.get('from') || String(item.dueDate) >= params.get('from')!) &&
          (!params.get('to') || String(item.dueDate) <= params.get('to')!) &&
          (!params.get('kind') || item.kind === params.get('kind')) &&
          (!params.get('subjectId') || item.subjectId === params.get('subjectId')) &&
          (!params.has('completed') || item.completed === bool(params, 'completed')),
      )
      .sort(
        (a, b) =>
          String(a.dueAt).localeCompare(String(b.dueAt)) ||
          String(a.id).localeCompare(String(b.id)),
      );
    const page = paginate(list, params);
    result = {
      deadlines: page.values,
      pagination: page.pagination,
      timezone: 'Asia/Karachi',
      canManage: false,
    };
  } else notSaved();
  // Return detached values: a component must not mutate the stored snapshot in memory.
  return structuredClone(result) as T;
}
