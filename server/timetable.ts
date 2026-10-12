import { randomUUID } from 'node:crypto';
import type { Client, InValue } from '@libsql/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, type CurrentUser } from './auth.js';
import {
  first,
  inWriteTransaction,
  numberValue,
  rows,
  stringValue,
  type Database,
  type SqlRow,
} from './db.js';
import { DEMO_CLASS_ID, DEMO_USERS } from './demo.js';
import { ApiError, requireCondition } from './errors.js';
import { classAccess, routeId, type RouteContext } from './routes.js';
import { getSettings, requireFeature, requireWritable } from './site-settings.js';
import {
  addCalendarDays,
  isCalendarDate,
  karachiDate,
  localDateTimeISO,
  mondayFor,
  resolveSchedule,
  SCHEDULE_TIMEZONE,
  weekdayFor,
  type Deadline,
  type ScheduleException,
  type TimetableEntry,
} from './schedule.js';

export { resolveSchedule } from './schedule.js';
export const MAX_WEEKLY_ENTRIES = 100;
export const MAX_CLASS_EXCEPTIONS = 2000;
export const MAX_CLASS_DEADLINES = 2000;

const uuid = z.uuid();
const dateSchema = z
  .string()
  .refine(isCalendarDate, 'Use a real date in YYYY-MM-DD format (1970–2199).');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time in HH:mm format.');
const versionSchema = z.coerce.number().int().min(1).max(2_147_483_647);
const optionalSubject = z.preprocess(
  (value) => (value === '' ? null : value),
  uuid.nullable().optional(),
);
const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      'Remove control characters.',
    );
const weeklyForm = z
  .object({
    title: shortText(120).min(1),
    subjectId: optionalSubject,
    weekday: z.coerce.number().int().min(1).max(7),
    startTime: timeSchema,
    endTime: timeSchema,
    teacher: shortText(100).default(''),
    room: shortText(80).default(''),
    notes: shortText(2000).default(''),
  })
  .strict();
const exceptionForm = z
  .object({
    kind: z.enum(['extra', 'rescheduled', 'cancelled']),
    entryId: uuid.nullable().optional(),
    originalDate: dateSchema.nullable().optional(),
    date: dateSchema.optional(),
    title: shortText(120).min(1).optional(),
    subjectId: optionalSubject,
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    teacher: shortText(100).optional(),
    room: shortText(80).optional(),
    notes: shortText(2000).default(''),
  })
  .strict();
const deadlineForm = z
  .object({
    kind: z.enum(['quiz', 'assignment', 'event']),
    title: shortText(160).min(1),
    description: shortText(4000).default(''),
    subjectId: optionalSubject,
    dueDate: dateSchema,
    dueTime: timeSchema,
  })
  .strict();
const pageFields = {
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
};
const boolQuery = z.enum(['true', 'false']).transform((value) => value === 'true');
const exceptionsQuery = z
  .object({
    ...pageFields,
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    all: boolQuery.default(false),
  })
  .strict();
const deadlinesQuery = z
  .object({
    ...pageFields,
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    kind: z.enum(['quiz', 'assignment', 'event']).optional(),
    completed: boolQuery.optional(),
  })
  .strict();
type DeadlineQuery = z.infer<typeof deadlinesQuery>;

function checkTimes(start: string, end: string) {
  requireCondition(
    start < end,
    400,
    'invalid_time_range',
    'End time must be later than start time on the same day.',
  );
}
function instant(date: string, time: string) {
  try {
    return localDateTimeISO(date, time);
  } catch {
    throw new ApiError(
      400,
      'invalid_local_time',
      'That date and time do not occur in Asia/Karachi. Choose another time.',
    );
  }
}
function checkRange(from: string, to: string) {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  requireCondition(
    days >= 1 && days <= 366,
    400,
    'invalid_date_range',
    'Choose an ordered date range of at most 366 days.',
  );
}
function checkVersion(row: SqlRow, version: number) {
  requireCondition(
    numberValue(row.version) === version,
    409,
    'record_changed',
    'This item changed since you opened it. Refresh, review the latest version, and try again.',
  );
}
function activeSubjectSql(alias: string, enabled: boolean) {
  return `(${alias}.subject_id IS NULL OR (${enabled ? '1=1' : '0=1'} AND EXISTS(SELECT 1 FROM subjects parent WHERE parent.id=${alias}.subject_id AND parent.class_id=${alias}.class_id AND parent.deleted_at IS NULL)))`;
}
function activeExceptionSql(enabled: boolean) {
  return `${activeSubjectSql('x', enabled)} AND (x.entry_id IS NULL OR EXISTS(SELECT 1 FROM timetable_entries parent_entry WHERE parent_entry.id=x.entry_id AND parent_entry.class_id=x.class_id AND parent_entry.deleted_at IS NULL AND ${activeSubjectSql('parent_entry', enabled)}))`;
}
const entrySelect =
  'SELECT t.*,s.name AS subject_name FROM timetable_entries t LEFT JOIN subjects s ON s.id=t.subject_id';
const exceptionSelect =
  'SELECT x.*,s.name AS subject_name FROM schedule_exceptions x LEFT JOIN subjects s ON s.id=x.subject_id';
const deadlineSelect = `SELECT d.*,s.name AS subject_name,completion.deadline_version AS completion_version,completion.completed_at
  FROM deadlines d LEFT JOIN subjects s ON s.id=d.subject_id LEFT JOIN deadline_completions completion ON completion.deadline_id=d.id AND completion.user_id=?`;

function entryRecord(row: SqlRow): TimetableEntry {
  return {
    id: stringValue(row.id),
    classId: stringValue(row.class_id),
    subjectId: row.subject_id ? stringValue(row.subject_id) : null,
    subjectName: row.subject_name ? stringValue(row.subject_name) : null,
    title: stringValue(row.title),
    weekday: numberValue(row.weekday),
    startTime: stringValue(row.start_time),
    endTime: stringValue(row.end_time),
    teacher: stringValue(row.teacher),
    room: stringValue(row.room),
    notes: stringValue(row.notes),
    version: numberValue(row.version),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}
function exceptionRecord(row: SqlRow): ScheduleException {
  return {
    id: stringValue(row.id),
    classId: stringValue(row.class_id),
    entryId: row.entry_id ? stringValue(row.entry_id) : null,
    originalDate: row.original_date ? stringValue(row.original_date) : null,
    date: stringValue(row.date),
    kind: stringValue(row.kind) as ScheduleException['kind'],
    subjectId: row.subject_id ? stringValue(row.subject_id) : null,
    subjectName: row.subject_name ? stringValue(row.subject_name) : null,
    title: stringValue(row.title),
    startTime: stringValue(row.start_time),
    endTime: stringValue(row.end_time),
    teacher: stringValue(row.teacher),
    room: stringValue(row.room),
    notes: stringValue(row.notes),
    version: numberValue(row.version),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
  };
}
function deadlineRecord(row: SqlRow): Deadline {
  const completed = Boolean(
    row.completed_at && numberValue(row.completion_version) === numberValue(row.version),
  );
  return {
    id: stringValue(row.id),
    classId: stringValue(row.class_id),
    subjectId: row.subject_id ? stringValue(row.subject_id) : null,
    subjectName: row.subject_name ? stringValue(row.subject_name) : null,
    kind: stringValue(row.kind) as Deadline['kind'],
    title: stringValue(row.title),
    description: stringValue(row.description),
    dueDate: stringValue(row.due_date),
    dueTime: stringValue(row.due_time),
    dueAt: stringValue(row.due_at),
    version: numberValue(row.version),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    completed,
    completedAt: completed ? stringValue(row.completed_at) : null,
  };
}

async function requireSubject(db: Database, classId: string, subjectId: string | null | undefined) {
  if (!subjectId) return;
  await requireFeature(db, 'subjects');
  const subject = await first(
    db,
    'SELECT id FROM subjects WHERE id=? AND class_id=? AND deleted_at IS NULL',
    [subjectId, classId],
  );
  requireCondition(
    subject,
    404,
    'subject_not_found',
    'Choose an available subject from this class.',
  );
}
async function requirePlanningWrite(
  db: Database,
  actor: CurrentUser,
  classId: string,
  feature: 'timetable' | 'deadlines',
) {
  await requireWritable(db, actor);
  await requireFeature(db, feature);
  await classAccess(db, actor, classId, true);
}
async function loadEntry(db: Database, actor: CurrentUser, id: string, manage = false) {
  await requireFeature(db, 'timetable');
  const row = await first(db, `${entrySelect} WHERE t.id=? AND t.deleted_at IS NULL`, [id]);
  requireCondition(row, 404, 'entry_not_found', 'This timetable entry is not available to you.');
  await classAccess(db, actor, stringValue(row.class_id), manage);
  await requireSubject(
    db,
    stringValue(row.class_id),
    row.subject_id ? stringValue(row.subject_id) : null,
  );
  return row;
}
async function loadException(db: Database, actor: CurrentUser, id: string, manage = false) {
  await requireFeature(db, 'timetable');
  const row = await first(db, `${exceptionSelect} WHERE x.id=? AND x.deleted_at IS NULL`, [id]);
  requireCondition(
    row,
    404,
    'exception_not_found',
    'This schedule change is not available to you.',
  );
  await classAccess(db, actor, stringValue(row.class_id), manage);
  await requireSubject(
    db,
    stringValue(row.class_id),
    row.subject_id ? stringValue(row.subject_id) : null,
  );
  if (row.entry_id) {
    const entry = await loadEntry(db, actor, stringValue(row.entry_id), manage);
    requireCondition(
      entry.class_id === row.class_id,
      404,
      'exception_not_found',
      'This schedule change is not available.',
    );
  }
  return row;
}
async function loadDeadline(db: Database, actor: CurrentUser, id: string, manage = false) {
  await requireFeature(db, 'deadlines');
  const row = await first(db, `${deadlineSelect} WHERE d.id=? AND d.deleted_at IS NULL`, [
    actor.id,
    id,
  ]);
  requireCondition(row, 404, 'deadline_not_found', 'This deadline is not available to you.');
  await classAccess(db, actor, stringValue(row.class_id), manage);
  await requireSubject(
    db,
    stringValue(row.class_id),
    row.subject_id ? stringValue(row.subject_id) : null,
  );
  return row;
}

export async function readTimetableData(
  db: Database,
  actor: CurrentUser,
  classId: string,
  selectedDate: string,
) {
  await requireFeature(db, 'timetable');
  const access = await classAccess(db, actor, classId);
  const flags = (await getSettings(db)).features;
  const weekStart = mondayFor(dateSchema.parse(selectedDate)),
    weekEnd = addCalendarDays(weekStart, 6);
  const entryRows = await rows(
    db,
    `${entrySelect} WHERE t.class_id=? AND t.deleted_at IS NULL AND ${activeSubjectSql('t', flags.subjects)} ORDER BY t.weekday,t.start_time,t.id LIMIT ?`,
    [classId, MAX_WEEKLY_ENTRIES + 1],
  );
  requireCondition(
    entryRows.length <= MAX_WEEKLY_ENTRIES,
    409,
    'planning_limit',
    'This class exceeds the supported timetable size. Contact the owner.',
  );
  const exceptionRows = await rows(
    db,
    `${exceptionSelect} WHERE x.class_id=? AND x.deleted_at IS NULL AND ${activeExceptionSql(flags.subjects)}
    AND ((x.date>=? AND x.date<=?) OR (x.original_date>=? AND x.original_date<=?)) ORDER BY x.date,x.start_time,x.id LIMIT ?`,
    [classId, weekStart, weekEnd, weekStart, weekEnd, MAX_CLASS_EXCEPTIONS + 1],
  );
  requireCondition(
    exceptionRows.length <= MAX_CLASS_EXCEPTIONS,
    409,
    'planning_limit',
    'This class exceeds the supported schedule size. Contact the owner.',
  );
  const entries = entryRows.map(entryRecord),
    exceptions = exceptionRows.map(exceptionRecord);
  let sessions;
  try {
    sessions = resolveSchedule(entries, exceptions, weekStart);
  } catch {
    throw new ApiError(
      400,
      'invalid_local_time',
      'A session falls in an unavailable historical local time. Choose another week or update the entry.',
    );
  }
  return {
    entries,
    exceptions,
    sessions,
    weekStart,
    weekEnd,
    timezone: SCHEDULE_TIMEZONE,
    canManage: access.role !== 'student',
  };
}

async function normalizeException(
  db: Database,
  actor: CurrentUser,
  classId: string,
  form: z.infer<typeof exceptionForm>,
) {
  let title = form.title,
    subjectId = form.subjectId,
    teacher = form.teacher,
    room = form.room;
  let startTime = form.startTime,
    endTime = form.endTime,
    date = form.date;
  let entryId: string | null = null,
    originalDate: string | null = null;
  if (form.kind === 'extra') {
    requireCondition(
      !form.entryId && !form.originalDate,
      400,
      'invalid_extra_session',
      'An extra class must not replace a weekly occurrence.',
    );
    requireCondition(
      title && date && startTime && endTime,
      400,
      'missing_session_details',
      'Enter a title, date, start time, and end time for the extra class.',
    );
  } else {
    requireCondition(
      form.entryId && form.originalDate,
      400,
      'missing_occurrence',
      'Choose the weekly entry and original occurrence date.',
    );
    const original = await loadEntry(db, actor, form.entryId, true);
    requireCondition(
      original.class_id === classId,
      404,
      'entry_not_found',
      'Choose a weekly entry in this class.',
    );
    requireCondition(
      weekdayFor(form.originalDate) === numberValue(original.weekday),
      400,
      'wrong_occurrence_date',
      'The original date must fall on the weekly entry’s weekday.',
    );
    entryId = form.entryId;
    originalDate = form.originalDate;
    if (form.kind === 'cancelled') {
      requireCondition(
        !form.date || form.date === originalDate,
        400,
        'invalid_cancellation_date',
        'A cancellation uses the original occurrence date.',
      );
      date = originalDate;
      title = stringValue(original.title);
      subjectId = original.subject_id ? stringValue(original.subject_id) : null;
      teacher = stringValue(original.teacher);
      room = stringValue(original.room);
      startTime = stringValue(original.start_time);
      endTime = stringValue(original.end_time);
    } else {
      requireCondition(
        date && startTime && endTime,
        400,
        'missing_session_details',
        'Choose the replacement date, start time, and end time.',
      );
      title ??= stringValue(original.title);
      if (subjectId === undefined)
        subjectId = original.subject_id ? stringValue(original.subject_id) : null;
      teacher ??= stringValue(original.teacher);
      room ??= stringValue(original.room);
    }
  }
  await requireSubject(db, classId, subjectId);
  checkTimes(startTime!, endTime!);
  instant(date!, startTime!);
  instant(date!, endTime!);
  return {
    ...form,
    entryId,
    originalDate,
    date: date!,
    title: title!,
    subjectId: subjectId || null,
    startTime: startTime!,
    endTime: endTime!,
    teacher: teacher || '',
    room: room || '',
  };
}

async function uniqueOccurrence(
  db: Database,
  form: { entryId: string | null; originalDate: string | null },
  excludingId = '',
) {
  if (!form.entryId) return;
  const existing = await first(
    db,
    'SELECT id FROM schedule_exceptions WHERE entry_id=? AND original_date=? AND deleted_at IS NULL AND id!=?',
    [form.entryId, form.originalDate, excludingId],
  );
  requireCondition(
    !existing,
    409,
    'occurrence_already_changed',
    'This occurrence already has a dated change. Edit or remove that change first.',
  );
}

export async function readDeadlineData(
  db: Database,
  actor: CurrentUser,
  classId: string,
  suppliedQuery: Partial<DeadlineQuery> = {},
) {
  await requireFeature(db, 'deadlines');
  const access = await classAccess(db, actor, classId);
  const query = { limit: 100, offset: 0, ...suppliedQuery };
  if (query.from && query.to) checkRange(query.from, query.to);
  const flags = (await getSettings(db)).features;
  const conditions = [
    'd.class_id=?',
    'd.deleted_at IS NULL',
    activeSubjectSql('d', flags.subjects),
  ];
  const args: InValue[] = [classId];
  if (query.from) {
    conditions.push('d.due_date>=?');
    args.push(query.from);
  }
  if (query.to) {
    conditions.push('d.due_date<=?');
    args.push(query.to);
  }
  if (query.kind) {
    conditions.push('d.kind=?');
    args.push(query.kind);
  }
  if (query.completed !== undefined)
    conditions.push(
      query.completed
        ? '(completion.deadline_version=d.version)'
        : '(completion.deadline_version IS NULL OR completion.deadline_version!=d.version)',
    );
  const where = conditions.join(' AND ');
  const list = await rows(
    db,
    `${deadlineSelect} WHERE ${where} ORDER BY d.due_at,d.id LIMIT ? OFFSET ?`,
    [actor.id, ...args, query.limit, query.offset],
  );
  const count = await first(
    db,
    `SELECT COUNT(*) AS n FROM deadlines d LEFT JOIN deadline_completions completion ON completion.deadline_id=d.id AND completion.user_id=? WHERE ${where}`,
    [actor.id, ...args],
  );
  return {
    deadlines: list.map(deadlineRecord),
    pagination: { limit: query.limit, offset: query.offset, total: numberValue(count?.n) },
    timezone: SCHEDULE_TIMEZONE,
    canManage: access.role !== 'student',
  };
}

export function registerTimetableRoutes(app: FastifyInstance, context: RouteContext): void {
  const { db, authenticate, now } = context;

  app.get('/api/classes/:id/timetable', async (request) => {
    const actor = await authenticate(request),
      classId = routeId(request);
    const { week } = z.object({ week: dateSchema.optional() }).strict().parse(request.query);
    return readTimetableData(db, actor, classId, week || karachiDate(now()));
  });

  app.post(
    '/api/classes/:id/timetable',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await authenticate(request),
        classId = routeId(request),
        form = weeklyForm.parse(request.body);
      checkTimes(form.startTime, form.endTime);
      const entry = await inWriteTransaction(db, async (tx) => {
        await requirePlanningWrite(tx, actor, classId, 'timetable');
        await requireSubject(tx, classId, form.subjectId);
        const count = await first(
          tx,
          'SELECT COUNT(*) AS n FROM timetable_entries WHERE class_id=? AND deleted_at IS NULL',
          [classId],
        );
        requireCondition(
          numberValue(count?.n) < MAX_WEEKLY_ENTRIES,
          409,
          'planning_limit',
          'This class already has 100 weekly entries. Remove an unused entry first.',
        );
        const id = randomUUID(),
          stamp = now();
        await tx.execute({
          sql: 'INSERT INTO timetable_entries(id,class_id,subject_id,title,weekday,start_time,end_time,teacher,room,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            classId,
            form.subjectId || null,
            form.title,
            form.weekday,
            form.startTime,
            form.endTime,
            form.teacher,
            form.room,
            form.notes,
            actor.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await audit(tx, actor.id, 'timetable.created', id, stamp, { classId });
        return entryRecord((await first(tx, `${entrySelect} WHERE t.id=?`, [id]))!);
      });
      return reply.code(201).send({ entry });
    },
  );

  app.patch('/api/timetable/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = weeklyForm.extend({ version: versionSchema }).parse(request.body);
    checkTimes(form.startTime, form.endTime);
    return inWriteTransaction(db, async (tx) => {
      const previous = await loadEntry(tx, actor, id, true),
        classId = stringValue(previous.class_id);
      await requirePlanningWrite(tx, actor, classId, 'timetable');
      checkVersion(previous, form.version);
      await requireSubject(tx, classId, form.subjectId);
      if (form.weekday !== numberValue(previous.weekday)) {
        const affected = await first(
          tx,
          'SELECT id FROM schedule_exceptions WHERE entry_id=? AND deleted_at IS NULL LIMIT 1',
          [id],
        );
        requireCondition(
          !affected,
          409,
          'dated_changes_exist',
          'Remove dated changes for this entry before changing its weekly weekday.',
        );
      }
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE timetable_entries SET subject_id=?,title=?,weekday=?,start_time=?,end_time=?,teacher=?,room=?,notes=?,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL',
        args: [
          form.subjectId || null,
          form.title,
          form.weekday,
          form.startTime,
          form.endTime,
          form.teacher,
          form.room,
          form.notes,
          stamp.toISOString(),
          id,
          form.version,
        ],
      });
      await audit(tx, actor.id, 'timetable.updated', id, stamp, { classId });
      return { entry: entryRecord((await first(tx, `${entrySelect} WHERE t.id=?`, [id]))!) };
    });
  });

  app.delete('/api/timetable/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      { version } = z.object({ version: versionSchema }).strict().parse(request.query);
    return inWriteTransaction(db, async (tx) => {
      const entry = await loadEntry(tx, actor, id, true);
      await requirePlanningWrite(tx, actor, stringValue(entry.class_id), 'timetable');
      checkVersion(entry, version);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE timetable_entries SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?',
        args: [stamp.toISOString(), stamp.toISOString(), id, version],
      });
      await audit(tx, actor.id, 'timetable.deleted', id, stamp);
      return { ok: true };
    });
  });

  app.get('/api/classes/:id/schedule-exceptions', async (request) => {
    const actor = await authenticate(request),
      classId = routeId(request),
      query = exceptionsQuery.parse(request.query);
    await requireFeature(db, 'timetable');
    const access = await classAccess(db, actor, classId),
      flags = (await getSettings(db)).features;
    requireCondition(
      !query.all || (!query.from && !query.to),
      400,
      'invalid_date_range',
      'Use all=true or a date range, not both.',
    );
    requireCondition(
      query.all || Boolean(query.from) === Boolean(query.to),
      400,
      'invalid_date_range',
      'Supply both from and to dates.',
    );
    const today = karachiDate(now()),
      from = query.all ? null : query.from || addCalendarDays(today, -30),
      to = query.all ? null : query.to || addCalendarDays(today, 180);
    if (from && to) checkRange(from, to);
    const where = `x.class_id=? AND x.deleted_at IS NULL AND ${activeExceptionSql(flags.subjects)}${from && to ? ' AND ((x.date>=? AND x.date<=?) OR (x.original_date>=? AND x.original_date<=?))' : ''}`;
    const args: InValue[] = [classId, ...(from && to ? [from, to, from, to] : [])];
    const list = await rows(
      db,
      `${exceptionSelect} WHERE ${where} ORDER BY x.date,x.start_time,x.id LIMIT ? OFFSET ?`,
      [...args, query.limit, query.offset],
    );
    const count = await first(
      db,
      `SELECT COUNT(*) AS n FROM schedule_exceptions x WHERE ${where}`,
      args,
    );
    return {
      exceptions: list.map(exceptionRecord),
      pagination: { limit: query.limit, offset: query.offset, total: numberValue(count?.n) },
      from,
      to,
      timezone: SCHEDULE_TIMEZONE,
      canManage: access.role !== 'student',
    };
  });

  app.post(
    '/api/classes/:id/schedule-exceptions',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await authenticate(request),
        classId = routeId(request),
        supplied = exceptionForm.parse(request.body);
      const exception = await inWriteTransaction(db, async (tx) => {
        await requirePlanningWrite(tx, actor, classId, 'timetable');
        const form = await normalizeException(tx, actor, classId, supplied);
        await uniqueOccurrence(tx, form);
        const count = await first(
          tx,
          'SELECT COUNT(*) AS n FROM schedule_exceptions WHERE class_id=? AND deleted_at IS NULL',
          [classId],
        );
        requireCondition(
          numberValue(count?.n) < MAX_CLASS_EXCEPTIONS,
          409,
          'planning_limit',
          'This class already has 2000 dated changes. Remove unused changes first.',
        );
        const id = randomUUID(),
          stamp = now();
        await tx.execute({
          sql: 'INSERT INTO schedule_exceptions(id,class_id,entry_id,original_date,date,kind,subject_id,title,start_time,end_time,teacher,room,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            classId,
            form.entryId,
            form.originalDate,
            form.date,
            form.kind,
            form.subjectId,
            form.title,
            form.startTime,
            form.endTime,
            form.teacher,
            form.room,
            form.notes,
            actor.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await audit(tx, actor.id, 'schedule_exception.created', id, stamp, {
          classId,
          kind: form.kind,
        });
        return exceptionRecord((await first(tx, `${exceptionSelect} WHERE x.id=?`, [id]))!);
      });
      return reply.code(201).send({ exception });
    },
  );

  app.patch('/api/schedule-exceptions/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      supplied = exceptionForm.extend({ version: versionSchema }).parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      const previous = await loadException(tx, actor, id, true),
        classId = stringValue(previous.class_id);
      await requirePlanningWrite(tx, actor, classId, 'timetable');
      checkVersion(previous, supplied.version);
      const form = await normalizeException(tx, actor, classId, supplied);
      await uniqueOccurrence(tx, form, id);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE schedule_exceptions SET entry_id=?,original_date=?,date=?,kind=?,subject_id=?,title=?,start_time=?,end_time=?,teacher=?,room=?,notes=?,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL',
        args: [
          form.entryId,
          form.originalDate,
          form.date,
          form.kind,
          form.subjectId,
          form.title,
          form.startTime,
          form.endTime,
          form.teacher,
          form.room,
          form.notes,
          stamp.toISOString(),
          id,
          supplied.version,
        ],
      });
      await audit(tx, actor.id, 'schedule_exception.updated', id, stamp, {
        classId,
        kind: form.kind,
      });
      return {
        exception: exceptionRecord((await first(tx, `${exceptionSelect} WHERE x.id=?`, [id]))!),
      };
    });
  });

  app.delete('/api/schedule-exceptions/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      { version } = z.object({ version: versionSchema }).strict().parse(request.query);
    return inWriteTransaction(db, async (tx) => {
      const exception = await loadException(tx, actor, id, true);
      await requirePlanningWrite(tx, actor, stringValue(exception.class_id), 'timetable');
      checkVersion(exception, version);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE schedule_exceptions SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?',
        args: [stamp.toISOString(), stamp.toISOString(), id, version],
      });
      await audit(tx, actor.id, 'schedule_exception.deleted', id, stamp);
      return { ok: true };
    });
  });

  app.get('/api/classes/:id/deadlines', async (request) => {
    const actor = await authenticate(request),
      classId = routeId(request),
      query = deadlinesQuery.parse(request.query);
    return readDeadlineData(db, actor, classId, query);
  });

  app.post(
    '/api/classes/:id/deadlines',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await authenticate(request),
        classId = routeId(request),
        form = deadlineForm.parse(request.body),
        dueAt = instant(form.dueDate, form.dueTime);
      const deadline = await inWriteTransaction(db, async (tx) => {
        await requirePlanningWrite(tx, actor, classId, 'deadlines');
        await requireSubject(tx, classId, form.subjectId);
        const count = await first(
          tx,
          'SELECT COUNT(*) AS n FROM deadlines WHERE class_id=? AND deleted_at IS NULL',
          [classId],
        );
        requireCondition(
          numberValue(count?.n) < MAX_CLASS_DEADLINES,
          409,
          'planning_limit',
          'This class already has 2000 active deadlines. Remove unused entries first.',
        );
        const id = randomUUID(),
          stamp = now();
        await tx.execute({
          sql: 'INSERT INTO deadlines(id,class_id,subject_id,kind,title,description,due_date,due_time,due_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            classId,
            form.subjectId || null,
            form.kind,
            form.title,
            form.description,
            form.dueDate,
            form.dueTime,
            dueAt,
            actor.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await audit(tx, actor.id, 'deadline.created', id, stamp, { classId, kind: form.kind });
        return deadlineRecord((await first(tx, `${deadlineSelect} WHERE d.id=?`, [actor.id, id]))!);
      });
      return reply.code(201).send({ deadline });
    },
  );

  app.patch('/api/deadlines/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = deadlineForm.extend({ version: versionSchema }).parse(request.body),
      dueAt = instant(form.dueDate, form.dueTime);
    return inWriteTransaction(db, async (tx) => {
      const previous = await loadDeadline(tx, actor, id, true),
        classId = stringValue(previous.class_id);
      await requirePlanningWrite(tx, actor, classId, 'deadlines');
      checkVersion(previous, form.version);
      await requireSubject(tx, classId, form.subjectId);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE deadlines SET subject_id=?,kind=?,title=?,description=?,due_date=?,due_time=?,due_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL',
        args: [
          form.subjectId || null,
          form.kind,
          form.title,
          form.description,
          form.dueDate,
          form.dueTime,
          dueAt,
          stamp.toISOString(),
          id,
          form.version,
        ],
      });
      await audit(tx, actor.id, 'deadline.updated', id, stamp, { classId });
      return {
        deadline: deadlineRecord(
          (await first(tx, `${deadlineSelect} WHERE d.id=?`, [actor.id, id]))!,
        ),
      };
    });
  });

  app.delete('/api/deadlines/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      { version } = z.object({ version: versionSchema }).strict().parse(request.query);
    return inWriteTransaction(db, async (tx) => {
      const deadline = await loadDeadline(tx, actor, id, true);
      await requirePlanningWrite(tx, actor, stringValue(deadline.class_id), 'deadlines');
      checkVersion(deadline, version);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE deadlines SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?',
        args: [stamp.toISOString(), stamp.toISOString(), id, version],
      });
      await audit(tx, actor.id, 'deadline.deleted', id, stamp);
      return { ok: true };
    });
  });

  app.patch('/api/deadlines/:id/completion', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = z
        .object({ completed: z.boolean(), version: versionSchema.optional() })
        .strict()
        .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const deadline = await loadDeadline(tx, actor, id);
      if (form.version !== undefined) checkVersion(deadline, form.version);
      if (form.completed)
        await tx.execute({
          sql: 'INSERT INTO deadline_completions(user_id,deadline_id,deadline_version,completed_at) VALUES (?,?,?,?) ON CONFLICT(user_id,deadline_id) DO UPDATE SET deadline_version=excluded.deadline_version,completed_at=excluded.completed_at',
          args: [actor.id, id, numberValue(deadline.version), now().toISOString()],
        });
      else
        await tx.execute({
          sql: 'DELETE FROM deadline_completions WHERE user_id=? AND deadline_id=?',
          args: [actor.id, id],
        });
      return {
        deadline: deadlineRecord(
          (await first(tx, `${deadlineSelect} WHERE d.id=?`, [actor.id, id]))!,
        ),
      };
    });
  });
}

export const DEMO_TIMETABLE_IDS = {
  monday: '40000000-0000-4000-8000-000000000001',
  wednesday: '40000000-0000-4000-8000-000000000002',
  extra: '41000000-0000-4000-8000-000000000001',
  quiz: '42000000-0000-4000-8000-000000000001',
  assignment: '42000000-0000-4000-8000-000000000002',
} as const;

/** Idempotent fictional demo examples. Dates are chosen once from the seed's current Karachi week. */
export async function seedTimetableDemo(db: Client, now = new Date()): Promise<void> {
  await inWriteTransaction(db, async (tx) => {
    const mode = await first(tx, "SELECT value FROM app_metadata WHERE key='identity_mode'");
    requireCondition(
      mode?.value === 'demo',
      500,
      'demo_only',
      'Schedule examples are restricted to the local demo.',
    );
    const already = await first(
      tx,
      "SELECT value FROM app_metadata WHERE key='planning_demo_seeded'",
    );
    if (already) return;
    const stamp = now.toISOString(),
      week = mondayFor(karachiDate(now));
    for (const [id, title, weekday, start, end, room] of [
      [DEMO_TIMETABLE_IDS.monday, 'Demo: Operating Systems', 1, '09:00', '10:30', 'Example room A'],
      [DEMO_TIMETABLE_IDS.wednesday, 'Demo: Database Lab', 3, '11:00', '12:30', 'Example lab'],
    ] as const) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO timetable_entries(id,class_id,title,weekday,start_time,end_time,teacher,room,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        args: [
          id,
          DEMO_CLASS_ID,
          title,
          weekday,
          start,
          end,
          'Example instructor',
          room,
          'Fictional local demo — replace with the official section timetable.',
          DEMO_USERS.admin.id,
          stamp,
          stamp,
        ],
      });
    }
    await tx.execute({
      sql: 'INSERT OR IGNORE INTO schedule_exceptions(id,class_id,date,kind,title,start_time,end_time,teacher,room,notes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      args: [
        DEMO_TIMETABLE_IDS.extra,
        DEMO_CLASS_ID,
        addCalendarDays(week, 4),
        'extra',
        'Demo: Extra study session',
        '14:00',
        '15:00',
        'Example instructor',
        'Example room B',
        'Fictional extra class for this demo week only.',
        DEMO_USERS.admin.id,
        stamp,
        stamp,
      ],
    });
    for (const [id, kind, title, day, time] of [
      [DEMO_TIMETABLE_IDS.quiz, 'quiz', 'Demo: OS practice quiz', 2, '10:00'],
      [
        DEMO_TIMETABLE_IDS.assignment,
        'assignment',
        'Demo: Database practice assignment',
        5,
        '23:59',
      ],
    ] as const) {
      const date = addCalendarDays(week, day);
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO deadlines(id,class_id,kind,title,description,due_date,due_time,due_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        args: [
          id,
          DEMO_CLASS_ID,
          kind,
          title,
          'Fictional demo deadline. No real submission or assessment is scheduled.',
          date,
          time,
          localDateTimeISO(date, time),
          DEMO_USERS.admin.id,
          stamp,
          stamp,
        ],
      });
    }
    await tx.execute({
      sql: "INSERT INTO app_metadata(key,value) VALUES ('planning_demo_seeded',?)",
      args: [stamp],
    });
  });
}
