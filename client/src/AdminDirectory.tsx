import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  GraduationCap,
  LoaderCircle,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth, errorMessage } from './auth';
import { useApi, contentChanged } from './hooks';
import { EmptyState, ErrorNotice, Modal, Pagination, Spinner, useToast } from './components';
import type { AdminOverview, ClassFields } from './types';
import { isMaster } from './permissions';
interface Semester {
  semester: number;
  classCount: number;
  memberCount: number;
  studentCount: number;
  adminCount: number;
}
interface SemesterClass extends ClassFields {
  id: string;
  memberCount: number;
  studentCount: number;
  adminCount: number;
}
export function SemesterDirectory() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const rawSemester = Number(params.get('semester'));
  const semester =
    params.has('semester') && Number.isInteger(rawSemester) && rawSemester >= 1 && rawSemester <= 20
      ? rawSemester
      : null;
  const setSemester = (value: number | null) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', 'semesters');
      if (value === null) next.delete('semester');
      else next.set('semester', String(value));
      return next;
    });
  const [offset, setOffset] = useState(0);
  const allowed = isMaster(auth.me) && !auth.offline;
  const overview = useApi<{ semesters: Semester[]; totals: Omit<Semester, 'semester'> }>(
    allowed ? '/admin/semesters' : null,
  );
  const sections = useApi<{
    semester: number;
    classes: SemesterClass[];
    pagination: { limit: number; offset: number; total: number };
  }>(
    !allowed || semester === null
      ? null
      : `/admin/semesters/${semester}/classes?limit=50&offset=${offset}`,
  );
  if (!allowed)
    return (
      <ErrorNotice message="An online owner account is required to view the section directory." />
    );
  if (overview.loading) return <Spinner label="Loading semesters…" />;
  if (overview.error) return <ErrorNotice message={overview.error} retry={overview.reload} />;
  const all = new Map((overview.data?.semesters ?? []).map((s) => [s.semester, s]));
  const numbers = Array.from(
    new Set([...Array.from({ length: 8 }, (_, i) => i + 1), ...all.keys()]),
  ).sort((a, b) => a - b);
  return (
    <section className="semester-directory">
      {semester === null ? (
        <>
          <div className="section-heading">
            <div>
              <h2>Find a section</h2>
              <p>Choose a semester to see its classes and enrolled students.</p>
            </div>
            <span className="directory-total">
              <Users size={17} />
              {overview.data?.totals.memberCount ?? 0} enrollments
            </span>
          </div>
          <div className="semester-grid">
            {numbers.map((number) => {
              const item = all.get(number);
              return (
                <button
                  key={number}
                  className={`semester-card semester-tone-${number % 4}`}
                  onClick={() => {
                    setSemester(number);
                    setOffset(0);
                  }}
                >
                  <div className="semester-card-top">
                    <span className="semester-number">{String(number).padStart(2, '0')}</span>
                    <ArrowUpRight size={21} />
                  </div>
                  <h3>Semester {number}</h3>
                  <div className="semester-counts">
                    <span>
                      <BookOpen size={15} />
                      {item?.classCount ?? 0} sections
                    </span>
                    <span>
                      <Users size={15} />
                      {item?.memberCount ?? 0} enrolled
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="page-hint">
            Each student has one active section. Older accounts with conflicting sections stay
            private until you resolve their section using Enroll or transfer a student.
          </p>
        </>
      ) : (
        <>
          <button className="back-link" onClick={() => setSemester(null)}>
            <ArrowLeft size={16} />
            All semesters
          </button>
          <div className="section-heading">
            <div>
              <span className="eyebrow">MASTER ADMIN / SEMESTER {semester}</span>
              <h2>Sections</h2>
            </div>
            <span className="count-pill">{all.get(semester)?.classCount ?? 0} sections</span>
          </div>
          {sections.loading ? (
            <Spinner label="Loading sections…" />
          ) : sections.error ? (
            <ErrorNotice message={sections.error} retry={sections.reload} />
          ) : sections.data?.classes.length ? (
            <div className="section-directory-list">
              {sections.data.classes.map((c) => (
                <Link
                  key={c.id}
                  className="section-directory-row"
                  to={`/admin/classes/${c.id}?view=people`}
                >
                  <span className="section-tile">{c.section || c.name.slice(0, 3)}</span>
                  <div className="section-directory-copy">
                    <h3>{c.name}</h3>
                    <p>
                      {c.program} · Section {c.section}
                    </p>
                    <span className="account-id">Class ID: {c.id}</span>
                  </div>
                  <div className="section-students">
                    <strong>{c.memberCount}</strong>
                    <span>enrolled</span>
                  </div>
                  <div className="section-admins">
                    <ShieldCheck size={17} />
                    {c.adminCount} admins
                  </div>
                  <ChevronRight size={20} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<GraduationCap size={28} />}
              title="No sections in this semester yet."
            >
              Use Create section to add the first section.
            </EmptyState>
          )}
          {sections.data && (
            <Pagination
              offset={offset}
              limit={sections.data.pagination.limit}
              total={sections.data.pagination.total}
              onChange={setOffset}
            />
          )}
        </>
      )}
    </section>
  );
}
export function AddEnrolledStudent({
  classId,
  onChanged,
}: {
  classId: string;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  if (!isMaster(auth.me) || auth.offline) return null;
  return (
    <div className="enroll-action">
      <p>
        Enroll an unassigned account, or explicitly transfer it from an older section. Then choose
        its class role below.
      </p>
      <button className="button button-secondary button-small" onClick={() => setOpen(true)}>
        <UserPlus size={17} />
        Enroll or transfer a student
      </button>
      {open && (
        <EnrollModal classId={classId} onClose={() => setOpen(false)} onChanged={onChanged} />
      )}
    </div>
  );
}
function EnrollModal({
  classId,
  onClose,
  onChanged,
}: {
  classId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [transfer, setTransfer] = useState<{ id: string; displayName: string } | null>(null);
  const state = useApi<AdminOverview>(`/admin/overview?limit=50&offset=${offset}`);
  const users =
    state.data?.users.filter(
      (u) =>
        u.status === 'active' &&
        u.role === 'student' &&
        `${u.displayName} ${u.email} ${u.id}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  if (transfer)
    return (
      <SectionTransferDialog
        user={transfer}
        classId={classId}
        onClose={() => setTransfer(null)}
        onChanged={() => {
          onChanged();
          onClose();
        }}
      />
    );
  return (
    <Modal
      title="Enroll a registered student"
      description="The account must already have signed in with a verified university email."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <label className="search-field">
        <Search size={18} />
        <input
          aria-label="Filter students to enroll"
          placeholder="Filter this page by name, roll number, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ErrorNotice message={error || state.error} />
      {state.loading ? (
        <Spinner />
      ) : (
        <div className="enrollment-list">
          {users.map((u) => (
            <div className="enrollment-row" key={u.id}>
              <div>
                <strong>{u.displayName}</strong>
                <span>{u.email}</span>
              </div>
              <button
                className="button button-secondary button-small"
                disabled={!!busy}
                aria-label={`Enroll ${u.displayName}`}
                onClick={async () => {
                  setBusy(u.id);
                  setError('');
                  try {
                    await auth.request(`/admin/classes/${classId}/members`, {
                      method: 'POST',
                      body: JSON.stringify({ userId: u.id }),
                    });
                    toast('Student enrolled. You can now assign their class role.');
                    onChanged();
                    onClose();
                  } catch (e) {
                    setError(errorMessage(e));
                    setBusy('');
                  }
                }}
              >
                {busy === u.id ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <UserPlus size={16} />
                )}
                Enroll
              </button>
              <button className="text-button" disabled={!!busy} onClick={() => setTransfer(u)}>
                Transfer / resolve
              </button>
            </div>
          ))}
          {!users.length && <p className="muted">No active matching accounts on this page.</p>}
        </div>
      )}
      {state.data && (
        <Pagination
          limit={50}
          offset={offset}
          total={state.data.pagination.usersTotal}
          onChange={(n) => {
            setOffset(n);
            setQuery('');
          }}
        />
      )}
    </Modal>
  );
}

function SectionTransferDialog({
  user,
  classId,
  onClose,
  onChanged,
}: {
  user: { id: string; displayName: string };
  classId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const auth = useAuth(),
    toast = useToast();
  const state = useApi<{
    section: {
      classId: string | null;
      pendingClassId: string | null;
      needsResolution: boolean;
      version: number;
    };
    memberships: { classId: string; className: string; role: string; status: string }[];
  }>(`/admin/users/${encodeURIComponent(user.id)}/section`);
  const subjects = useApi<{ subjects: { id: string; name: string }[] }>(
    `/classes/${classId}/subjects?limit=100`,
  );
  const [reason, setReason] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title={`Confirm section for ${user.displayName}`}
      description="This is an explicit owner transfer. Historical records remain; previous section access and admin authority are removed."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {state.loading ? (
        <Spinner />
      ) : (
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!state.data) return;
            setBusy(true);
            setError('');
            try {
              await auth.request(`/admin/users/${encodeURIComponent(user.id)}/section`, {
                method: 'PUT',
                body: JSON.stringify({
                  classId,
                  version: state.data.section.version,
                  reason,
                  subjectIds: selected,
                }),
              });
              contentChanged();
              toast('Section assignment saved. Appoint an admin separately if needed.');
              onChanged();
            } catch (e) {
              setError(errorMessage(e));
              state.reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            {state.data?.section.needsResolution
              ? 'This older account has conflicting section records.'
              : 'Review the current section history before saving.'}
          </p>
          <ul>
            {state.data?.memberships.map((m) => (
              <li key={m.classId}>
                {m.className} — {m.status} · {m.role}
              </li>
            ))}
          </ul>
          <p>
            The destination is the section you opened. The student will have a Student role here.
            Existing subject enrollment in this section is retained; optionally add the subjects
            below.
          </p>
          <fieldset>
            <legend>Enroll in subjects in this section</legend>
            {subjects.data?.subjects.map((s) => (
              <label className="checkbox-row" key={s.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked ? [...v, s.id] : v.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </fieldset>
          <label>
            Reason for this assignment
            <textarea
              value={reason}
              required
              minLength={5}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: confirmed semester 5 section D with the student."
            />
          </label>
          <ErrorNotice message={error || state.error || subjects.error} />
          <div className="modal-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={busy || !state.data || !!state.error}
            >
              Confirm section assignment
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
