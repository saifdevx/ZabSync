import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { useAuth, errorMessage } from './auth';
import { useApi, contentChanged, queryString } from './hooks';
import {
  ActionHeading,
  EmptyState,
  ErrorNotice,
  Modal,
  Pagination,
  Spinner,
  useToast,
} from './components';
import { useSite } from './site';
import type { SubjectList } from './academic-types';
import type { ClassDetail } from './types';
import { canManageAcademic, enrolledClasses, isMaster } from './permissions';
import { isCalendarDate } from '../../server/schedule';

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export function campusDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return shiftDate(date, -((d.getUTCDay() + 6) % 7));
}
export function displayDay(date: string, full = false) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: full ? 'long' : 'short',
    year: full ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}
export function displayTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
export interface WeeklyEntry {
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
  updatedAt: string;
}
export interface ScheduleException extends Omit<WeeklyEntry, 'weekday'> {
  entryId: string | null;
  originalDate: string | null;
  date: string;
  kind: 'extra' | 'cancelled' | 'rescheduled';
}
export interface Session extends Omit<WeeklyEntry, 'weekday' | 'version'> {
  date: string;
  entryId: string | null;
  exceptionId: string | null;
  originalDate: string | null;
  source: 'weekly' | 'extra' | 'rescheduled' | 'cancelled';
  movedToDate?: string | null;
  cancelled: boolean;
  conflict: boolean;
  startAt: string;
  endAt: string;
}
export interface TimetableData {
  entries: WeeklyEntry[];
  exceptions: ScheduleException[];
  sessions: Session[];
  weekStart: string;
  weekEnd: string;
  timezone: string;
  canManage: boolean;
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
  completed: boolean;
  completedAt: string | null;
  updatedAt: string;
}
interface DeadlineData {
  deadlines: Deadline[];
  pagination: { total: number; limit: number; offset: number };
  timezone: string;
  canManage: boolean;
}

type Editor =
  | { kind: 'weekly'; value?: WeeklyEntry }
  | { kind: 'exception'; value?: ScheduleException }
  | { kind: 'deadline'; value?: Deadline };
function PlanningEditor({
  classId,
  editor,
  entries = [],
  date,
  onClose,
  onSaved,
}: {
  classId: string;
  editor: Editor;
  entries?: WeeklyEntry[];
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const auth = useAuth();
  const site = useSite();
  const toast = useToast();
  const subjects = useApi<SubjectList>(
    site.settings?.features.subjects === false ? null : `/classes/${classId}/subjects?limit=100`,
  );
  const value = editor.value;
  const [form, setForm] = useState({
    title: value?.title ?? '',
    subjectId: value?.subjectId ?? '',
    weekday: String(
      editor.kind === 'weekly' && value && 'weekday' in value
        ? value.weekday
        : ((new Date(`${date}T12:00Z`).getUTCDay() + 6) % 7) + 1,
    ),
    startTime: 'startTime' in (value ?? {}) ? (value as WeeklyEntry).startTime : '09:00',
    endTime: 'endTime' in (value ?? {}) ? (value as WeeklyEntry).endTime : '10:30',
    teacher: 'teacher' in (value ?? {}) ? (value as WeeklyEntry).teacher : '',
    room: 'room' in (value ?? {}) ? (value as WeeklyEntry).room : '',
    notes: 'notes' in (value ?? {}) ? (value as WeeklyEntry).notes : '',
    kind:
      editor.kind === 'exception'
        ? ((value as ScheduleException | undefined)?.kind ?? 'extra')
        : editor.kind === 'deadline'
          ? ((value as Deadline | undefined)?.kind ?? 'assignment')
          : '',
    entryId:
      editor.kind === 'exception'
        ? ((value as ScheduleException | undefined)?.entryId ?? entries[0]?.id ?? '')
        : '',
    originalDate:
      editor.kind === 'exception'
        ? ((value as ScheduleException | undefined)?.originalDate ?? date)
        : date,
    date:
      editor.kind === 'exception' ? ((value as ScheduleException | undefined)?.date ?? date) : date,
    dueDate: editor.kind === 'deadline' ? ((value as Deadline | undefined)?.dueDate ?? date) : date,
    dueTime:
      editor.kind === 'deadline' ? ((value as Deadline | undefined)?.dueTime ?? '23:59') : '23:59',
    description:
      editor.kind === 'deadline' ? ((value as Deadline | undefined)?.description ?? '') : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = (name: keyof typeof form, value: string) =>
    setForm((old) => ({ ...old, [name]: value }));
  const chooseExceptionKind = (kind: string) => {
    setForm((old) => {
      const entry = entries.find((item) => item.id === old.entryId);
      if (!entry || kind === 'extra') return { ...old, kind };
      return {
        ...old,
        kind,
        originalDate: shiftDate(weekOf(old.originalDate), entry.weekday - 1),
        ...(kind === 'rescheduled' && old.kind !== 'rescheduled'
          ? {
              title: entry.title,
              subjectId: entry.subjectId ?? '',
              startTime: entry.startTime,
              endTime: entry.endTime,
              teacher: entry.teacher,
              room: entry.room,
              notes: entry.notes,
            }
          : {}),
      };
    });
  };
  const chooseWeeklyEntry = (entryId: string) => {
    setForm((old) => {
      const entry = entries.find((item) => item.id === entryId);
      if (!entry) return { ...old, entryId };
      return {
        ...old,
        entryId,
        originalDate: shiftDate(weekOf(old.originalDate), entry.weekday - 1),
        ...(old.kind === 'rescheduled'
          ? {
              title: entry.title,
              subjectId: entry.subjectId ?? '',
              startTime: entry.startTime,
              endTime: entry.endTime,
              teacher: entry.teacher,
              room: entry.room,
              notes: entry.notes,
            }
          : {}),
      };
    });
  };
  const cancelled = editor.kind === 'exception' && form.kind === 'cancelled';
  const inherited = editor.kind === 'exception' && form.kind === 'rescheduled';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let body: Record<string, unknown>;
      if (editor.kind === 'weekly')
        body = {
          title: form.title,
          subjectId: form.subjectId || null,
          weekday: Number(form.weekday),
          startTime: form.startTime,
          endTime: form.endTime,
          teacher: form.teacher,
          room: form.room,
          notes: form.notes,
        };
      else if (editor.kind === 'deadline')
        body = {
          kind: form.kind,
          title: form.title,
          subjectId: form.subjectId || null,
          description: form.description,
          dueDate: form.dueDate,
          dueTime: form.dueTime,
        };
      else if (cancelled)
        body = {
          kind: form.kind,
          entryId: form.entryId,
          originalDate: form.originalDate,
          notes: form.notes,
        };
      else
        body = {
          kind: form.kind,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          notes: form.notes,
          ...(inherited
            ? {
                entryId: form.entryId,
                originalDate: form.originalDate,
                ...(form.title ? { title: form.title } : {}),
                subjectId: form.subjectId || null,
                teacher: form.teacher,
                room: form.room,
              }
            : {
                title: form.title,
                subjectId: form.subjectId || null,
                teacher: form.teacher,
                room: form.room,
              }),
        };
      const endpoint =
        editor.kind === 'weekly'
          ? 'timetable'
          : editor.kind === 'exception'
            ? 'schedule-exceptions'
            : 'deadlines';
      await auth.request(value ? `/${endpoint}/${value.id}` : `/classes/${classId}/${endpoint}`, {
        method: value ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...body, ...(value ? { version: value.version } : {}) }),
      });
      toast(editor.kind === 'deadline' ? 'Deadline saved.' : 'Timetable updated.');
      contentChanged();
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${value ? 'Edit' : 'Add'} ${editor.kind === 'weekly' ? 'weekly class' : editor.kind === 'exception' ? 'schedule change' : 'deadline'}`}
      description="All dates and times use Islamabad time (Asia/Karachi)."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        {editor.kind === 'exception' && (
          <label>
            Change type
            <select value={form.kind} onChange={(e) => chooseExceptionKind(e.target.value)}>
              <option value="extra">Extra class</option>
              <option value="cancelled">Cancel one class</option>
              <option value="rescheduled">Reschedule one class</option>
            </select>
          </label>
        )}
        {editor.kind === 'deadline' && (
          <label>
            Type
            <select value={form.kind} onChange={(e) => field('kind', e.target.value)}>
              <option value="assignment">Assignment</option>
              <option value="quiz">Quiz</option>
              <option value="event">Event</option>
            </select>
          </label>
        )}
        {editor.kind === 'exception' && form.kind !== 'extra' && (
          <>
            <label>
              Weekly class
              <select
                required
                value={form.entryId}
                onChange={(e) => chooseWeeklyEntry(e.target.value)}
              >
                {!entries.length && <option value="">Add a weekly class first</option>}
                {entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {WEEKDAYS[e.weekday - 1]} · {e.title} · {e.startTime}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Original class date
              <input
                type="date"
                required
                value={form.originalDate}
                onChange={(e) => field('originalDate', e.target.value)}
              />
            </label>
            <p className="page-hint">
              Choose the date of the normal weekly class. This change applies to that occurrence
              only.
            </p>
          </>
        )}
        {!cancelled && (
          <>
            <label>
              {inherited ? 'Title (optional; uses weekly title)' : 'Title'}
              <input
                required={!inherited}
                maxLength={editor.kind === 'deadline' ? 160 : 120}
                value={form.title}
                onChange={(e) => field('title', e.target.value)}
                placeholder={
                  editor.kind === 'deadline'
                    ? 'e.g. Database assignment 2'
                    : 'e.g. Operating Systems'
                }
              />
            </label>
            {site.settings?.features.subjects !== false && (
              <label>
                Subject (optional)
                <select value={form.subjectId} onChange={(e) => field('subjectId', e.target.value)}>
                  <option value="">General / no subject</option>
                  {subjects.data?.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {editor.kind === 'weekly' && (
          <label>
            Day
            <select value={form.weekday} onChange={(e) => field('weekday', e.target.value)}>
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}
        {editor.kind === 'exception' && !cancelled && (
          <label>
            {inherited ? 'New date' : 'Date'}
            <input
              type="date"
              required
              value={form.date}
              onChange={(e) => field('date', e.target.value)}
            />
          </label>
        )}
        {editor.kind !== 'deadline' && !cancelled && (
          <>
            <div className="form-row">
              <label>
                Start time
                <input
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(e) => field('startTime', e.target.value)}
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  required
                  value={form.endTime}
                  onChange={(e) => field('endTime', e.target.value)}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Teacher
                <input
                  maxLength={100}
                  value={form.teacher}
                  onChange={(e) => field('teacher', e.target.value)}
                  placeholder="Teacher name"
                />
              </label>
              <label>
                Room
                <input
                  maxLength={80}
                  value={form.room}
                  onChange={(e) => field('room', e.target.value)}
                  placeholder="e.g. Lab 2"
                />
              </label>
            </div>
          </>
        )}
        {editor.kind === 'deadline' ? (
          <>
            <div className="form-row">
              <label>
                Due date
                <input
                  type="date"
                  required
                  value={form.dueDate}
                  onChange={(e) => field('dueDate', e.target.value)}
                />
              </label>
              <label>
                Due time
                <input
                  type="time"
                  required
                  value={form.dueTime}
                  onChange={(e) => field('dueTime', e.target.value)}
                />
              </label>
            </div>
            <label>
              Details
              <textarea
                rows={3}
                maxLength={4000}
                value={form.description}
                onChange={(e) => field('description', e.target.value)}
              />
            </label>
          </>
        ) : (
          <label>
            Notes
            <textarea
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => field('notes', e.target.value)}
            />
          </label>
        )}
        <ErrorNotice message={error} />
        <div className="modal-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : value ? 'Save changes' : 'Add to class'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function DeletePlanning({
  item,
  endpoint,
  onClose,
  onDeleted,
}: {
  item: { id: string; title: string; version: number };
  endpoint: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Remove this item?"
      description={item.title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        It will disappear from the current class schedule. Saved offline copies update the next time
        students sync.
      </p>
      <ErrorNotice message={error} />
      <div className="modal-actions">
        <button className="button button-secondary" disabled={busy} onClick={onClose}>
          Keep item
        </button>
        <button
          className="button button-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await auth.request(`/${endpoint}/${item.id}?version=${item.version}`, {
                method: 'DELETE',
              });
              contentChanged();
              onDeleted();
              onClose();
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </Modal>
  );
}

const SESSION_ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose'] as const;
function sessionAccent(session: Session) {
  const key = session.subjectId ?? session.entryId ?? session.title;
  let hash = 0;
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return SESSION_ACCENTS[hash % SESSION_ACCENTS.length];
}

function WeeklySession({ session, onDate }: { session: Session; onDate: (date: string) => void }) {
  return (
    <article
      className={`weekly-session weekly-accent-${sessionAccent(session)} ${session.cancelled ? 'weekly-session-cancelled' : ''}`}
      aria-label={`${session.title}, ${displayTime(session.startTime)} to ${displayTime(session.endTime)}`}
    >
      <div className="weekly-session-time">
        <Clock3 size={17} aria-hidden="true" />
        <div>
          <time dateTime={session.startAt}>{displayTime(session.startTime)}</time>
          <span aria-hidden="true">–</span>
          <time dateTime={session.endAt}>{displayTime(session.endTime)}</time>
        </div>
      </div>
      <div className="weekly-session-course">
        <h4>{session.title}</h4>
        {session.subjectName && session.subjectName !== session.title && (
          <p className="weekly-session-subject">{session.subjectName}</p>
        )}
        {session.source !== 'weekly' && (
          <span className={`weekly-status weekly-status-${session.source}`}>
            {session.source === 'cancelled'
              ? session.movedToDate
                ? 'Moved'
                : 'Cancelled'
              : session.source === 'extra'
                ? 'Extra class'
                : 'Rescheduled'}
          </span>
        )}
      </div>
      <dl className="weekly-session-meta">
        <div>
          <dt>
            <UserRound size={14} aria-hidden="true" />
            Teacher
          </dt>
          <dd>{session.teacher || 'Not set'}</dd>
        </div>
        <div>
          <dt>
            <MapPin size={14} aria-hidden="true" />
            Room
          </dt>
          <dd>{session.room || 'Not set'}</dd>
        </div>
      </dl>
      {(session.notes ||
        session.movedToDate ||
        (session.source === 'rescheduled' && session.originalDate) ||
        session.conflict) && (
        <div className="weekly-session-footnotes">
          {session.notes && <p>{session.notes}</p>}
          {session.movedToDate && (
            <p className="weekly-moved-link">
              Moved to{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => onDate(session.movedToDate!)}
              >
                {displayDay(session.movedToDate, true)}{' '}
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </p>
          )}
          {session.source === 'rescheduled' && session.originalDate && (
            <p className="weekly-moved-link">
              Moved from{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => onDate(session.originalDate!)}
              >
                {displayDay(session.originalDate, true)}{' '}
                <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </p>
          )}
          {session.conflict && !session.cancelled && (
            <p className="weekly-overlap">Time overlap · check with your class admin.</p>
          )}
        </div>
      )}
    </article>
  );
}

export function TimetablePanel({
  classId,
  compact = false,
  sectionName,
}: {
  classId: string;
  compact?: boolean;
  sectionName?: string;
}) {
  const auth = useAuth();
  const site = useSite();
  const location = useLocation();
  const panelId = useId();
  const today = campusDate();
  const [week, setWeek] = useState(weekOf(today));
  const [editorDate, setEditorDate] = useState(today);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const dayHeadings = useRef<Record<string, HTMLHeadingElement | null>>({});
  const [template, setTemplate] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [remove, setRemove] = useState<{
    item: WeeklyEntry | ScheduleException;
    endpoint: string;
  } | null>(null);
  const state = useApi<TimetableData>(
    site.settings?.features.timetable === false
      ? null
      : `/classes/${classId}/timetable?week=${week}`,
  );
  useEffect(() => {
    setEditor(null);
    setRemove(null);
    setTemplate(false);
    setWeek(weekOf(today));
    setEditorDate(today);
    setFocusDate(null);
  }, [classId]);
  const scopedAdmin = canManageAcademic(auth.me, classId, {
    offline: auth.offline,
    maintenance: site.settings?.maintenance.enabled === true,
    ownerContext: location.pathname.startsWith('/admin/'),
  });
  const manage = state.data?.canManage === true && scopedAdmin;
  useEffect(() => {
    if (
      !scopedAdmin ||
      state.data?.canManage === false ||
      site.settings?.features.timetable === false
    ) {
      setEditor(null);
      setRemove(null);
      setTemplate(false);
    }
  }, [scopedAdmin, state.data?.canManage, site.settings?.features.timetable]);
  useEffect(() => {
    if (!focusDate || state.loading || !state.data) return;
    const heading = dayHeadings.current[focusDate];
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }, [focusDate, state.loading, state.data]);
  const entries = state.data?.entries ?? [];
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(week, index));
  const sessionsByDay = useMemo(() => {
    const grouped = new Map<string, Session[]>();
    for (const session of state.data?.sessions ?? []) {
      const items = grouped.get(session.date) ?? [];
      items.push(session);
      grouped.set(session.date, items);
    }
    for (const items of grouped.values())
      items.sort(
        (a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title),
      );
    return grouped;
  }, [state.data]);
  const jumpToDate = (date: string) => {
    setWeek(weekOf(date));
    setEditorDate(date);
    setFocusDate(date);
  };
  const changeWeek = (amount: number) => {
    const next = shiftDate(week, amount);
    setWeek(next);
    setEditorDate(next);
    setFocusDate(null);
  };
  const openEditor = (value: Editor, date = editorDate) => {
    setEditorDate(date);
    setEditor(value);
  };
  if (site.settings?.features.timetable === false)
    return (
      <EmptyState title="Timetable is currently unavailable.">
        Your application owner has turned off this feature.
      </EmptyState>
    );
  return (
    <section
      className={`planning-panel weekly-planner ${compact ? 'planning-compact' : ''}`}
      aria-label="Weekly timetable"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR CLASS ROUTINE</span>
          <h2>{sectionName ? `${sectionName} · Weekly timetable` : 'Weekly timetable'}</h2>
          <p className="weekly-introduction">
            The full week, including extra classes and one-time changes.
          </p>
        </div>
        <div className="planning-actions">
          <button className="icon-button" aria-label="Refresh timetable" onClick={state.reload}>
            <RefreshCw size={18} />
          </button>
          {manage && (
            <>
              <button
                className="button button-secondary button-small"
                onClick={() => openEditor({ kind: 'exception' })}
              >
                One-time change
              </button>
              <button
                className="button button-primary button-small"
                onClick={() => openEditor({ kind: 'weekly' })}
              >
                <Plus size={17} />
                Weekly class
              </button>
            </>
          )}
        </div>
      </div>
      <div className="weekly-navigation">
        <div className="weekly-range-controls" role="group" aria-label="Timetable week">
          <button className="icon-button" aria-label="Previous week" onClick={() => changeWeek(-7)}>
            <ArrowLeft size={18} />
          </button>
          <strong aria-live="polite">
            {displayDay(week)} – {displayDay(shiftDate(week, 6), true)}
          </strong>
          <button className="icon-button" aria-label="Next week" onClick={() => changeWeek(7)}>
            <ArrowRight size={18} />
          </button>
        </div>
        <button className="button button-secondary button-small" onClick={() => jumpToDate(today)}>
          This week
        </button>
        <label className="weekly-date-picker">
          Go to week
          <input
            type="date"
            value={week}
            min="1970-01-05"
            max="2199-12-23"
            onChange={(event) => {
              if (isCalendarDate(event.target.value)) jumpToDate(event.target.value);
            }}
          />
        </label>
        <span className="weekly-timezone">
          <Clock3 size={14} aria-hidden="true" />
          Islamabad time
        </span>
      </div>
      {state.loading ? (
        <Spinner label="Loading your week…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : (
        <div className="weekly-board" aria-label="Monday to Sunday schedule">
          {days.map((day, index) => {
            const sessions = sessionsByDay.get(day) ?? [];
            const count = sessions.filter((session) => !session.cancelled).length;
            const headingId = `${panelId}-day-${index}`;
            return (
              <section
                className={`weekly-day ${day === today ? 'weekly-day-today' : ''} ${day === focusDate ? 'weekly-day-focused' : ''}`}
                key={day}
                aria-labelledby={headingId}
              >
                <header className="weekly-day-header">
                  <div>
                    <h3
                      id={headingId}
                      tabIndex={-1}
                      ref={(node) => {
                        dayHeadings.current[day] = node;
                      }}
                    >
                      {WEEKDAYS[index]}
                    </h3>
                    <time dateTime={day}>{displayDay(day)}</time>
                  </div>
                  {day === today ? (
                    <span className="weekly-today-label">Today</span>
                  ) : (
                    <span className="weekly-day-count">
                      {count} {count === 1 ? 'class' : 'classes'}
                    </span>
                  )}
                </header>
                <div className="weekly-day-sessions">
                  {sessions.length > 0 ? (
                    sessions.map((session) => (
                      <WeeklySession key={session.id} session={session} onDate={jumpToDate} />
                    ))
                  ) : (
                    <div className="weekly-empty-day">
                      <CalendarDays size={22} aria-hidden="true" />
                      <p>No classes scheduled.</p>
                    </div>
                  )}
                </div>
                {manage && (
                  <button
                    className="weekly-add-day"
                    onClick={() => openEditor({ kind: 'weekly' }, day)}
                    aria-label={`Add weekly class on ${WEEKDAYS[index]}`}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Add weekly class
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
      {manage && (
        <div className="schedule-management weekly-management">
          <button
            className="text-button"
            onClick={() => setTemplate(!template)}
            aria-expanded={template}
            aria-controls={`${panelId}-template`}
          >
            <Pencil size={15} />
            Manage weekly template & changes
            <ChevronDown size={16} />
          </button>
          {template && (
            <div id={`${panelId}-template`}>
              <h3 className="minor-heading">Repeating weekly routine</h3>
              <p className="page-hint">
                Set the routine once for this class. These entries repeat every week. Use a one-time
                change for an extra, cancelled, or moved class on a particular date.
              </p>
              <div className="planning-entry-list">
                {[...entries]
                  .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
                  .map((entry) => (
                    <div className="planning-entry-row" key={entry.id}>
                      <div>
                        <strong>{entry.title}</strong>
                        <span id={`${panelId}-entry-${entry.id}`}>
                          {WEEKDAYS[entry.weekday - 1]} · {entry.startTime}–{entry.endTime} ·{' '}
                          {entry.teacher || 'Teacher not set'} · {entry.room || 'Room not set'}
                        </span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Edit weekly ${entry.title}`}
                        aria-describedby={`${panelId}-entry-${entry.id}`}
                        onClick={() => openEditor({ kind: 'weekly', value: entry })}
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        className="icon-button danger-icon"
                        aria-label={`Remove weekly ${entry.title}`}
                        aria-describedby={`${panelId}-entry-${entry.id}`}
                        onClick={() => setRemove({ item: entry, endpoint: 'timetable' })}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                {!entries.length && (
                  <p className="page-hint">
                    No weekly entries yet. Add a weekly class to start the routine.
                  </p>
                )}
              </div>
              <h3 className="minor-heading">One-time changes shown this week</h3>
              <div className="planning-entry-list">
                {state.data?.exceptions.map((entry) => (
                  <div className="planning-entry-row" key={entry.id}>
                    <div>
                      <strong>{entry.title || entry.kind}</strong>
                      <span id={`${panelId}-change-${entry.id}`}>
                        {entry.kind} · {entry.originalDate || entry.date}
                        {entry.kind === 'rescheduled' ? ` → ${entry.date}` : ''}
                      </span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Edit change ${entry.title || entry.kind}`}
                      aria-describedby={`${panelId}-change-${entry.id}`}
                      onClick={() => openEditor({ kind: 'exception', value: entry })}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="icon-button danger-icon"
                      aria-label={`Remove change ${entry.title || entry.kind}`}
                      aria-describedby={`${panelId}-change-${entry.id}`}
                      onClick={() => setRemove({ item: entry, endpoint: 'schedule-exceptions' })}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                {!state.data?.exceptions.length && (
                  <p className="page-hint">No one-time changes in this week.</p>
                )}
              </div>
              <p className="page-hint">
                Use a class announcement if everyone needs to know about a change.
              </p>
            </div>
          )}
        </div>
      )}
      {auth.offline && (
        <p className="page-hint">
          <WifiOff size={15} />
          Saved timetable · changes require a connection.
        </p>
      )}
      {manage && editor && (
        <PlanningEditor
          classId={classId}
          editor={editor}
          entries={entries}
          date={editorDate}
          onClose={() => setEditor(null)}
          onSaved={state.reload}
        />
      )}
      {manage && remove && (
        <DeletePlanning {...remove} onClose={() => setRemove(null)} onDeleted={state.reload} />
      )}
    </section>
  );
}

export function DeadlinesPanel({
  classId,
  compact = false,
}: {
  classId: string;
  compact?: boolean;
}) {
  const auth = useAuth();
  const site = useSite();
  const location = useLocation();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [remove, setRemove] = useState<Deadline | null>(null);
  const [busy, setBusy] = useState('');
  const ownerContext = isMaster(auth.me) && location.pathname.startsWith('/admin/');
  const state = useApi<DeadlineData>(
    site.settings?.features.deadlines === false
      ? null
      : `/classes/${classId}/deadlines?${queryString({ limit: compact ? 5 : 20, offset, from: compact ? campusDate() : undefined, completed: ownerContext ? undefined : compact ? 'false' : filter === 'all' ? undefined : filter === 'done' ? 'true' : 'false' })}`,
  );
  useEffect(() => {
    setOffset(0);
    setEditor(null);
    setRemove(null);
  }, [classId]);
  const scopedAdmin = canManageAcademic(auth.me, classId, {
    offline: auth.offline,
    maintenance: site.settings?.maintenance.enabled === true,
    ownerContext: location.pathname.startsWith('/admin/'),
  });
  const canManage = state.data?.canManage === true && scopedAdmin;
  const readOnly =
    auth.offline || (site.settings?.maintenance.enabled === true && !isMaster(auth.me));
  useEffect(() => {
    if (
      !scopedAdmin ||
      state.data?.canManage === false ||
      site.settings?.features.deadlines === false
    ) {
      setEditor(null);
      setRemove(null);
    }
  }, [scopedAdmin, state.data?.canManage, site.settings?.features.deadlines]);
  if (site.settings?.features.deadlines === false)
    return (
      <EmptyState title="Deadlines are currently unavailable.">
        Your application owner has turned off this feature.
      </EmptyState>
    );
  return (
    <section className="planning-panel deadlines-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {ownerContext ? 'SECTION PLANNING' : 'MAKE ROOM FOR WHAT MATTERS'}
          </span>
          <h2>{ownerContext ? 'Class deadlines' : compact ? 'Coming up' : 'Your deadlines'}</h2>
        </div>
        <div className="planning-actions">
          <button className="icon-button" aria-label="Refresh deadlines" onClick={state.reload}>
            <RefreshCw size={17} />
          </button>
          {canManage && (
            <button
              className="button button-primary button-small"
              onClick={() => setEditor({ kind: 'deadline' })}
            >
              <Plus size={17} />
              Add deadline
            </button>
          )}
        </div>
      </div>
      {!compact && !ownerContext && (
        <div className="segmented-control" role="group" aria-label="Deadline status">
          {['all', 'open', 'done'].map((value) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              onClick={() => {
                setFilter(value);
                setOffset(0);
              }}
            >
              {value === 'all' ? 'All' : value === 'open' ? 'To do' : 'Completed'}
            </button>
          ))}
        </div>
      )}
      {state.loading ? (
        <Spinner label="Loading deadlines…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : state.data?.deadlines.length ? (
        <div className="deadline-list">
          {state.data.deadlines.map((item) => {
            const overdue =
              (ownerContext || !item.completed) && new Date(item.dueAt).getTime() < Date.now();
            return (
              <article
                className={`deadline-row ${!ownerContext && item.completed ? 'is-complete' : ''}`}
                key={item.id}
              >
                {!ownerContext && (
                  <button
                    className="completion-button"
                    aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`}
                    aria-pressed={item.completed}
                    disabled={!!busy || readOnly}
                    onClick={async () => {
                      setBusy(item.id);
                      try {
                        await auth.request(`/deadlines/${item.id}/completion`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            completed: !item.completed,
                            version: item.version,
                          }),
                        });
                        setOffset(0);
                        state.reload();
                        contentChanged();
                      } catch (e) {
                        toast(errorMessage(e));
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    {item.completed ? <CheckCircle2 size={25} /> : <span />}
                  </button>
                )}
                <div className="deadline-copy">
                  <span className={`deadline-kind kind-${item.kind}`}>{item.kind}</span>
                  <h3>{item.title}</h3>
                  <p className={overdue ? 'overdue' : ''}>
                    <Clock3 size={14} />
                    {displayDay(item.dueDate)} · {displayTime(item.dueTime)}
                    {overdue ? (ownerContext ? ' · Past due' : ' · Overdue') : ''}
                  </p>
                  {item.subjectName && <small>{item.subjectName}</small>}
                  {item.description && !compact && (
                    <div className="deadline-description">{item.description}</div>
                  )}
                </div>
                {canManage && (
                  <div className="deadline-actions">
                    <button
                      className="icon-button"
                      aria-label={`Edit deadline ${item.title}`}
                      onClick={() => setEditor({ kind: 'deadline', value: item })}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="icon-button danger-icon"
                      aria-label={`Remove deadline ${item.title}`}
                      onClick={() => setRemove(item)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<CheckCircle2 size={30} />}
          title={
            ownerContext
              ? 'No class deadlines yet.'
              : compact
                ? 'No upcoming deadlines.'
                : filter === 'done'
                  ? 'Nothing completed yet.'
                  : 'You’re all caught up.'
          }
        >
          {ownerContext
            ? 'Add quizzes, assignments, and events for this section.'
            : compact
              ? 'Check all deadlines for earlier work and completed items.'
              : 'Deadlines added by your class admin appear here.'}
        </EmptyState>
      )}
      {!compact && state.data && (
        <Pagination
          limit={state.data.pagination.limit}
          offset={offset}
          total={state.data.pagination.total}
          onChange={setOffset}
        />
      )}
      {compact && (
        <Link
          className="text-button"
          to={
            isMaster(auth.me)
              ? `/admin/classes/${classId}/deadlines`
              : `/deadlines?class=${classId}`
          }
        >
          All deadlines <ArrowUpRight size={15} />
        </Link>
      )}
      {!ownerContext && (
        <p className="page-hint">
          Completion is your personal checklist. It does not submit an assignment.
        </p>
      )}
      {canManage && editor && (
        <PlanningEditor
          classId={classId}
          editor={editor}
          date={campusDate()}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setOffset(0);
            state.reload();
          }}
        />
      )}
      {canManage && remove && (
        <DeletePlanning
          item={remove}
          endpoint="deadlines"
          onClose={() => setRemove(null)}
          onDeleted={() => {
            setOffset(0);
            state.reload();
          }}
        />
      )}
    </section>
  );
}
export function PlanningPage({ view = 'timetable' }: { view?: 'timetable' | 'deadlines' }) {
  const auth = useAuth();
  const location = useLocation();
  const { classId: routeClassId } = useParams<{ classId: string }>();
  const [params, setParams] = useSearchParams();
  const owner = isMaster(auth.me);
  const ownerContext = owner && location.pathname.startsWith('/admin/');
  const ownerSection = useApi<ClassDetail>(
    ownerContext && routeClassId ? `/classes/${encodeURIComponent(routeClassId)}?limit=1` : null,
  );
  const classes = enrolledClasses(auth.me);
  const selected = owner
    ? ownerSection.data?.class
    : routeClassId
      ? classes.find((item) => item.id === routeClassId)
      : (classes.find((item) => item.id === params.get('class')) ?? classes[0]);
  const otherView = view === 'timetable' ? 'deadlines' : 'timetable';
  const panel =
    selected &&
    (view === 'timetable' ? (
      <TimetablePanel key={selected.id} classId={selected.id} sectionName={selected.name} />
    ) : (
      <DeadlinesPanel key={selected.id} classId={selected.id} />
    ));
  return (
    <>
      <ActionHeading
        eyebrow={owner ? 'SECTION PLANNING' : 'CAMPUS, ON YOUR TIME'}
        title={view === 'timetable' ? 'Timetable' : 'Deadlines'}
        subtitle={
          view === 'timetable'
            ? 'One section. The whole week. Keep your regular routine and one-time changes together.'
            : 'Quizzes, assignments, and events. Keep the next step clear.'
        }
      />
      {owner ? (
        !ownerContext || !routeClassId ? (
          <EmptyState
            title="Choose a section to manage its planning."
            action={
              <Link className="button button-primary" to="/admin">
                Owner dashboard
              </Link>
            }
          >
            Open a section from the owner directory to view its timetable and deadlines.
          </EmptyState>
        ) : ownerSection.loading ? (
          <Spinner label="Opening section planning…" />
        ) : ownerSection.error ? (
          <ErrorNotice message={ownerSection.error} retry={ownerSection.reload} />
        ) : selected ? (
          <>
            <div className="weekly-owner-context">
              <Link className="text-button" to={`/admin/classes/${selected.id}`}>
                <ArrowLeft size={16} />
                Back to section
              </Link>
              <div>
                <strong>{selected.name}</strong>
                <span>
                  {selected.program} · Semester {selected.semester} · Section {selected.section}
                </span>
              </div>
              <Link className="text-button" to={`/admin/classes/${selected.id}/${otherView}`}>
                See {otherView}
                <ArrowUpRight size={16} />
              </Link>
            </div>
            {panel}
          </>
        ) : null
      ) : selected ? (
        <>
          <div className="planning-class-picker">
            {routeClassId ? (
              <Link className="text-button" to={`/classes/${selected.id}`}>
                <ArrowLeft size={16} />
                {selected.name}
              </Link>
            ) : (
              <label>
                Your class
                <select
                  value={selected.id}
                  onChange={(event) => setParams({ class: event.target.value })}
                >
                  {classes.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.program}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Link
              className="text-button"
              to={
                routeClassId
                  ? `/classes/${selected.id}/${otherView}`
                  : `/${otherView}?class=${selected.id}`
              }
            >
              See {otherView}
              <ArrowUpRight size={16} />
            </Link>
          </div>
          {panel}
        </>
      ) : (
        <EmptyState
          title={
            routeClassId
              ? 'This class is not in your memberships.'
              : 'Join your class to get started.'
          }
          action={
            <Link className="button button-primary" to="/classes">
              My classes
            </Link>
          }
        >
          Your timetable and deadlines appear after your class membership is approved.
        </EmptyState>
      )}
    </>
  );
}

export function TodayCard({ classId }: { classId: string }) {
  const auth = useAuth();
  const site = useSite();
  const today = campusDate();
  const state = useApi<TimetableData>(
    site.settings?.features.timetable === false
      ? null
      : `/classes/${classId}/timetable?week=${weekOf(today)}`,
  );
  const next = state.data?.sessions
    .filter((s) => s.date === today && !s.cancelled && new Date(s.endAt).getTime() > Date.now())
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  return (
    <Link className="today-card" to={`/timetable?class=${classId}`}>
      <div className="today-card-top">
        <span>
          <span className="live-dot" />
          {auth.offline ? 'SAVED SCHEDULE' : 'YOUR NEXT CLASS'}
        </span>
        <ArrowUpRight size={20} />
      </div>
      <div className="today-card-body">
        <span className="today-time">
          {state.loading
            ? 'Just a moment…'
            : next
              ? `${displayTime(next.startTime)} — ${displayTime(next.endTime)}`
              : 'A little breathing room'}
        </span>
        <h2>
          {next?.title ?? (state.error ? 'Open your timetable' : 'Nothing else scheduled today.')}
        </h2>
        <p>
          {next
            ? [next.room, next.teacher].filter(Boolean).join(' · ')
            : 'Your week is one tap away.'}
        </p>
      </div>
      <div className="today-card-footer">
        <span>
          <CalendarDays size={16} />
          {displayDay(today, true)}
        </span>
        <span>
          View week
          <ArrowRight size={16} />
        </span>
      </div>
    </Link>
  );
}
