/** Pure shared planning code. Safe to import in the browser: no Node APIs, database, or server dependencies. */
export const SCHEDULE_TIMEZONE = 'Asia/Karachi' as const;

export interface TimetableEntry {
  id: string;
  classId: string;
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: string;
  room: string;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleException {
  id: string;
  classId: string;
  entryId: string | null;
  originalDate: string | null;
  date: string;
  kind: 'extra' | 'rescheduled' | 'cancelled';
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  startTime: string;
  endTime: string;
  teacher: string;
  room: string;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Deadline {
  id: string;
  classId: string;
  subjectId: string | null;
  subjectName: string | null;
  kind: 'quiz' | 'assignment' | 'event';
  title: string;
  description: string;
  dueDate: string;
  dueTime: string;
  dueAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  completed: boolean;
  completedAt: string | null;
}

export interface ResolvedSession {
  id: string;
  classId: string;
  entryId: string | null;
  exceptionId: string | null;
  date: string;
  originalDate: string | null;
  movedToDate: string | null;
  source: 'weekly' | 'extra' | 'rescheduled' | 'cancelled';
  cancelled: boolean;
  conflict: boolean;
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  teacher: string;
  room: string;
  notes: string;
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const instantFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1970 || year > 2199) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function karachiDate(now = new Date()): string {
  const parts = Object.fromEntries(
    dayFormatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(date: string, amount: number): string {
  if (!isCalendarDate(date) || !Number.isInteger(amount))
    throw new RangeError('Use a valid calendar date.');
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function weekdayFor(date: string): number {
  if (!isCalendarDate(date)) throw new RangeError('Use a valid calendar date.');
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
}

export function mondayFor(date: string): string {
  return addCalendarDays(date, 1 - weekdayFor(date));
}

/** Convert a Karachi wall-clock value with the runtime's timezone data, independent of server/device TZ. */
export function localDateTimeISO(date: string, time: string): string {
  if (!isCalendarDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new RangeError('Use a valid Karachi date and time.');
  const target = Date.parse(`${date}T${time}:00.000Z`);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(
      instantFormatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const local = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`,
    );
    const difference = target - local;
    if (!difference) return new Date(guess).toISOString();
    guess += difference;
  }
  throw new RangeError('This local date/time does not occur in Asia/Karachi.');
}

/** One resolver is used online and with the complete cached recurring entries/exceptions offline. */
export function resolveSchedule(
  entries: TimetableEntry[],
  exceptions: ScheduleException[],
  selectedDate: string,
): ResolvedSession[] {
  const weekStart = mondayFor(selectedDate),
    weekEnd = addCalendarDays(weekStart, 6);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const visibleExceptions = exceptions.filter(
    (exception) => !exception.entryId || entryMap.has(exception.entryId),
  );
  const overrides = new Map(
    visibleExceptions
      .filter((exception) => exception.entryId && exception.originalDate)
      .map((exception) => [`${exception.entryId}:${exception.originalDate}`, exception]),
  );
  const result: ResolvedSession[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = addCalendarDays(weekStart, offset);
    for (const entry of entries) {
      if (entry.weekday !== offset + 1) continue;
      const change = overrides.get(`${entry.id}:${date}`);
      result.push({
        id: `weekly:${entry.id}:${date}`,
        classId: entry.classId,
        entryId: entry.id,
        exceptionId: change?.id || null,
        date,
        originalDate: change ? date : null,
        movedToDate: change?.kind === 'rescheduled' ? change.date : null,
        source: change ? 'cancelled' : 'weekly',
        cancelled: Boolean(change),
        conflict: false,
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        title: entry.title,
        startTime: entry.startTime,
        endTime: entry.endTime,
        startAt: localDateTimeISO(date, entry.startTime),
        endAt: localDateTimeISO(date, entry.endTime),
        teacher: entry.teacher,
        room: entry.room,
        notes: change?.notes || entry.notes,
      });
    }
  }
  for (const exception of visibleExceptions) {
    if (exception.kind === 'cancelled' || exception.date < weekStart || exception.date > weekEnd)
      continue;
    result.push({
      id: `exception:${exception.id}`,
      classId: exception.classId,
      entryId: exception.entryId,
      exceptionId: exception.id,
      date: exception.date,
      originalDate: exception.originalDate,
      movedToDate: null,
      source: exception.kind,
      cancelled: false,
      conflict: false,
      subjectId: exception.subjectId,
      subjectName: exception.subjectName,
      title: exception.title,
      startTime: exception.startTime,
      endTime: exception.endTime,
      startAt: localDateTimeISO(exception.date, exception.startTime),
      endAt: localDateTimeISO(exception.date, exception.endTime),
      teacher: exception.teacher,
      room: exception.room,
      notes: exception.notes,
    });
  }
  result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.endTime.localeCompare(b.endTime) ||
      a.id.localeCompare(b.id),
  );
  let furthest: ResolvedSession | undefined;
  for (const session of result) {
    if (session.cancelled) continue;
    if (!furthest || furthest.date !== session.date) {
      furthest = session;
      continue;
    }
    if (session.startTime < furthest.endTime) {
      session.conflict = true;
      furthest.conflict = true;
    }
    if (session.endTime > furthest.endTime) furthest = session;
  }
  return result;
}
