import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookMarked,
  BookOpen,
  Bookmark,
  Check,
  CheckCheck,
  CheckSquare2,
  MessageCircle,
  KeyRound,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  Globe2,
  Inbox,
  LoaderCircle,
  Megaphone,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import {
  ActionHeading,
  EmptyState,
  ErrorNotice,
  Modal,
  CopyButton,
  Pagination,
  Spinner,
  formatDate,
  useToast,
} from './components';
import { contentChanged, queryString, useApi, useDebounced } from './hooks';
import { useSite } from './site';
import { OfflineSaveButton } from './OfflinePage';
import { ChatPanel } from './ChatPanel';
import { DeadlinesPanel } from './PlanningPages';
import { canManageAcademic, isMaster } from './permissions';
import type {
  Announcement,
  AnnouncementListData,
  NotificationsData,
  Resource,
  ResourceListData,
  Subject,
  SubjectColor,
  SubjectList,
} from './academic-types';

const SUBJECT_COLORS: SubjectColor[] = ['blue', 'teal', 'purple', 'amber', 'rose'];
function useAcademicPermission(classId?: string | null, global = false) {
  const auth = useAuth(),
    site = useSite(),
    location = useLocation();
  const ownerContext = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  return (
    (!!classId || global) &&
    canManageAcademic(auth.me, classId, {
      offline: auth.offline,
      maintenance: site.settings?.maintenance.enabled === true,
      ownerContext,
    }) &&
    (!global || isMaster(auth.me))
  );
}
function subjectPath(owner: boolean, classId: string, subjectId: string) {
  return owner ? `/admin/classes/${classId}/subjects/${subjectId}` : `/subjects/${subjectId}`;
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FilterBar({
  query,
  setQuery,
  placeholder,
  onRefresh,
  children,
}: {
  query: string;
  setQuery: (v: string) => void;
  placeholder: string;
  onRefresh: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="content-toolbar">
      <label className="search-field">
        <Search size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <X size={16} />
          </button>
        )}
      </label>
      <div className="toolbar-actions">
        {children}
        <button
          className="icon-button"
          title="Refresh"
          aria-label="Refresh content"
          onClick={onRefresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
    </div>
  );
}

function FeatureUnavailable({ name }: { name: string }) {
  return (
    <div className="panel">
      <EmptyState icon={<FolderOpen size={26} />} title={`${name} are paused.`}>
        The app administrator has temporarily turned this feature off. Your saved content has not
        been deleted.
      </EmptyState>
    </div>
  );
}

export function SaveButton({
  kind,
  item,
  onChanged,
}: {
  kind: 'announcement' | 'resource';
  item: { id: string; saved: boolean };
  onChanged?: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(item.saved);
  useEffect(() => setSaved(item.saved), [item.saved, item.id]);
  if (isMaster(auth.me)) return null;
  return (
    <button
      className={`icon-button save-button ${saved ? 'is-saved' : ''}`}
      aria-label={`${saved ? 'Unsave' : 'Save'} ${kind}`}
      aria-pressed={saved}
      disabled={busy || auth.offline}
      title={
        auth.offline
          ? 'Reconnect to change bookmarks'
          : saved
            ? 'Remove from saved'
            : 'Save for later'
      }
      onClick={async () => {
        setBusy(true);
        try {
          const result = await auth.request<{ saved: boolean }>(`/bookmarks/${kind}/${item.id}`, {
            method: saved ? 'DELETE' : 'POST',
          });
          setSaved(result.saved);
          toast(result.saved ? 'Added to your saved items.' : 'Removed from saved items.');
          contentChanged();
          onChanged?.();
        } catch (e) {
          toast(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}

function ConfirmChange({
  title,
  message,
  path,
  method = 'DELETE',
  label = 'Move to trash',
  destructive = false,
  onClose,
  onDone,
}: {
  title: string;
  message: string;
  path: string;
  method?: string;
  label?: string;
  destructive?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="dialog-copy">{message}</p>
      <ErrorNotice message={error} />
      <div className="modal-actions">
        <button className="button button-secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`button ${destructive ? 'button-danger' : 'button-primary'}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await auth.request(path, { method });
              contentChanged();
              toast(
                label === 'Move to trash'
                  ? 'Moved to trash. You can restore it later.'
                  : 'Change saved.',
              );
              onDone();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} {label}
        </button>
      </div>
    </Modal>
  );
}

export function SubjectForm({
  classId,
  initial,
  onClose,
  onDone,
}: {
  classId: string;
  initial?: Subject;
  onClose: () => void;
  onDone: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const canManage = useAcademicPermission(classId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    code: initial?.code ?? '',
    instructor: initial?.instructor ?? '',
    description: initial?.description ?? '',
    color: initial?.color ?? ('blue' as SubjectColor),
  });
  if (!canManage) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth.request(initial ? `/subjects/${initial.id}` : `/classes/${classId}/subjects`, {
        method: initial ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      toast(initial ? 'Subject updated.' : 'Subject added to your class.');
      contentChanged();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={initial ? 'Edit subject' : 'Add a subject'}
      description="Give each course a home for its lectures and updates."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        <label>
          Subject name
          <input
            autoFocus
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Operating Systems Lab"
          />
        </label>
        <div className="form-two">
          <label>
            Course code <span className="optional">Optional</span>
            <input
              maxLength={20}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="e.g. CS-305L"
            />
          </label>
          <label>
            Instructor <span className="optional">Optional</span>
            <input
              maxLength={80}
              value={form.instructor}
              onChange={(e) => setForm({ ...form, instructor: e.target.value })}
              placeholder="Teacher’s name"
            />
          </label>
        </div>
        <label>
          Description <span className="optional">Optional</span>
          <textarea
            maxLength={2000}
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What classmates should know about this course"
          />
        </label>
        <fieldset className="color-fieldset">
          <legend>Subject color</legend>
          <div className="color-options">
            {SUBJECT_COLORS.map((color) => (
              <label key={color} className={`color-option tone-${color}`}>
                <input
                  type="radio"
                  name="subject-color"
                  value={color}
                  checked={form.color === color}
                  onChange={() => setForm({ ...form, color })}
                />
                <span>{color}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorNotice message={error} />
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{' '}
            {initial ? 'Save subject' : 'Add subject'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SubjectsPanel({
  classId,
  canManage: allowedByParent,
  deleted = false,
}: {
  classId: string;
  canManage: boolean;
  deleted?: boolean;
}) {
  const site = useSite();
  const auth = useAuth();
  const toast = useToast();
  const permission = useAcademicPermission(classId);
  const canManage = allowedByParent === true && permission;
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState('');
  const q = useDebounced(query);
  const state = useApi<SubjectList>(
    site.settings?.features.subjects === false
      ? null
      : `/classes/${classId}/subjects?${queryString({ q, deleted, limit: 24, offset })}`,
  );
  if (site.settings?.features.subjects === false) return <FeatureUnavailable name="Subjects" />;
  return (
    <section className="subjects-section">
      <div className="section-heading">
        <div>
          <h2>{deleted ? 'Trashed subjects' : 'Subjects'}</h2>
          <p>
            {deleted
              ? 'Restore a subject to make its active files and notices visible again.'
              : 'Everything for a course, together in one place.'}
          </p>
        </div>
        {canManage && !auth.offline && !deleted && (
          <button className="button button-primary" onClick={() => setCreate(true)}>
            <Plus size={17} />
            Add subject
          </button>
        )}
      </div>
      <FilterBar
        query={query}
        setQuery={(v) => {
          setQuery(v);
          setOffset(0);
        }}
        placeholder="Search subjects"
        onRefresh={state.reload}
      />
      {state.loading ? (
        <Spinner label="Loading subjects…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : state.data?.subjects.length ? (
        <>
          <div className="subject-grid">
            {state.data.subjects.map((subject) => (
              <article key={subject.id} className={`subject-card tone-${subject.color}`}>
                <div className="subject-card-top">
                  <span className="subject-emblem">
                    <BookOpen size={25} />
                  </span>
                  <span className="subject-code">{subject.code || 'COURSE'}</span>
                </div>
                {deleted ? (
                  <h3>{subject.name}</h3>
                ) : (
                  <h3>
                    <Link to={subjectPath(isMaster(auth.me), classId, subject.id)}>
                      {subject.name}
                    </Link>
                  </h3>
                )}
                <p className="subject-instructor">{subject.instructor || 'Instructor not added'}</p>
                {subject.description && (
                  <p className="subject-description">{subject.description}</p>
                )}
                <div className="subject-card-footer">
                  <span>
                    <FileText size={15} />
                    {subject.resourceCount} files
                  </span>
                  <span>
                    <Megaphone size={15} />
                    {subject.announcementCount} updates
                  </span>
                  {deleted ? (
                    canManage &&
                    subject.canManage === true && (
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={async () => {
                          setBusy(subject.id);
                          try {
                            await auth.request(`/subjects/${subject.id}/restore`, {
                              method: 'POST',
                            });
                            state.reload();
                            toast('Subject restored.');
                            contentChanged();
                          } catch (e) {
                            toast(errorMessage(e));
                          } finally {
                            setBusy('');
                          }
                        }}
                      >
                        <RotateCcw size={16} />
                        Restore
                      </button>
                    )
                  ) : (
                    <Link
                      to={subjectPath(isMaster(auth.me), classId, subject.id)}
                      aria-label={`Open ${subject.name}`}
                      className="subject-open"
                    >
                      <ArrowRight size={18} />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
          <Pagination {...state.data.pagination} onChange={setOffset} />
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<BookOpen size={28} />}
            title={
              query
                ? 'No matching subjects.'
                : deleted
                  ? 'No subjects in trash.'
                  : 'Make room for your subjects.'
            }
          >
            {query
              ? 'Try a course name, code, or instructor.'
              : deleted
                ? 'Deleted subjects will appear here.'
                : canManage
                  ? 'Add your first course above. You can choose a name, instructor, and color.'
                  : 'Use Join a subject to enter a code from your class admin.'}
          </EmptyState>
        </div>
      )}
      {create && canManage && (
        <SubjectForm
          classId={classId}
          onClose={() => setCreate(false)}
          onDone={() => {
            setCreate(false);
            state.reload();
          }}
        />
      )}
    </section>
  );
}

function AudienceLabel({
  item,
}: {
  item: Pick<Announcement, 'scope' | 'className' | 'subjectName'>;
}) {
  return (
    <span className={`audience-tag audience-${item.scope}`}>
      {item.scope === 'global' ? (
        <Globe2 size={13} />
      ) : item.scope === 'class' ? (
        <Megaphone size={13} />
      ) : (
        <BookOpen size={13} />
      )}{' '}
      {item.scope === 'global'
        ? 'All classes'
        : item.scope === 'class'
          ? `${item.className} · Whole class`
          : item.subjectName || 'Subject'}
    </span>
  );
}

export function AnnouncementForm({
  classId,
  subjectId,
  globalOnly = false,
  initial,
  onClose,
  onDone,
}: {
  classId?: string;
  subjectId?: string;
  globalOnly?: boolean;
  initial?: Announcement;
  onClose: () => void;
  onDone: () => void;
}) {
  const auth = useAuth();
  const site = useSite();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<Announcement['scope']>(
    initial?.scope ?? (globalOnly ? 'global' : subjectId ? 'subject' : 'class'),
  );
  const [selectedSubject, setSelectedSubject] = useState(initial?.subjectId ?? subjectId ?? '');
  const [selectedClass] = useState(initial?.classId ?? classId ?? '');
  const canManage = useAcademicPermission(selectedClass, scope === 'global');
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    body: initial?.body ?? '',
    priority: initial?.priority ?? 'normal',
    pinned: initial?.pinned ?? false,
  });
  const [resourceIds, setResourceIds] = useState<string[]>(
    initial?.resources.map((r) => r.id) ?? [],
  );
  const subjectsEnabled = site.settings?.features.subjects !== false;
  const resourcesEnabled = site.settings?.features.resources !== false;
  const subjects = useApi<SubjectList>(
    subjectsEnabled && selectedClass && !subjectId && !initial
      ? `/classes/${selectedClass}/subjects?limit=100`
      : null,
  );
  const resources = useApi<ResourceListData>(
    resourcesEnabled && scope !== 'global' && selectedClass
      ? `/resources?${queryString({ classId: selectedClass, subjectId: scope === 'subject' ? selectedSubject : undefined, limit: 100 })}`
      : null,
  );
  if (!canManage || site.settings?.features.announcements !== true) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (scope === 'subject' && !selectedSubject)
        throw new Error('Choose a subject for this announcement.');
      const fields = {
        ...form,
        ...(resourcesEnabled || !initial
          ? { resourceIds: scope === 'global' ? [] : resourceIds }
          : {}),
      };
      await auth.request(initial ? `/announcements/${initial.id}` : '/announcements', {
        method: initial ? 'PATCH' : 'POST',
        body: JSON.stringify(
          initial
            ? fields
            : {
                ...fields,
                scope,
                ...(scope !== 'global' ? { classId: selectedClass } : {}),
                ...(scope === 'subject' ? { subjectId: selectedSubject } : {}),
              },
        ),
      });
      toast(initial ? 'Announcement updated.' : 'Announcement published.');
      contentChanged();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={initial ? 'Edit announcement' : 'Post an announcement'}
      description={
        globalOnly
          ? 'Visible to every signed-in university member.'
          : 'Keep important information easy for your classmates to find.'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="form-stack" onSubmit={submit}>
        {!initial && !globalOnly && !subjectId && (
          <div className="form-two">
            <label>
              Who should see this?
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as Announcement['scope']);
                  setResourceIds([]);
                }}
              >
                <option value="class">Everyone in this class</option>
                {subjectsEnabled && <option value="subject">A subject in this class</option>}
              </select>
            </label>
            {scope === 'subject' && (
              <label>
                Subject
                <select
                  required
                  value={selectedSubject}
                  onChange={(e) => {
                    setSelectedSubject(e.target.value);
                    setResourceIds([]);
                  }}
                >
                  <option value="">Choose a subject</option>
                  {subjects.data?.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ErrorNotice message={subjects.error} />
              </label>
            )}
          </div>
        )}
        <label>
          Title
          <input
            autoFocus
            required
            maxLength={160}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Tomorrow’s quiz: chapters 3 and 4"
          />
        </label>
        <label>
          Details
          <textarea
            required
            rows={6}
            maxLength={10000}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="Include the date, time, venue, and anything students need to prepare."
          />
        </label>
        <div className="form-two">
          <label>
            Priority
            <select
              value={form.priority}
              onChange={(e) =>
                setForm({ ...form, priority: e.target.value as Announcement['priority'] })
              }
            >
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="check-label pinned-option">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
            />
            <span>
              <strong>Pin this announcement</strong>
              <small>Keep it near the top of the board.</small>
            </span>
          </label>
        </div>
        {resourcesEnabled && scope !== 'global' && (
          <div className="attachment-picker">
            <h3>
              <Paperclip size={16} /> Attach uploaded files{' '}
              <span className="optional">Up to 5</span>
            </h3>
            {resources.loading ? (
              <p className="muted">Loading available files…</p>
            ) : resources.error ? (
              <ErrorNotice message={resources.error} />
            ) : resources.data?.resources.length ? (
              <div className="attachment-options">
                {resources.data.resources.map((r) => (
                  <label className="check-label" key={r.id}>
                    <input
                      type="checkbox"
                      checked={resourceIds.includes(r.id)}
                      disabled={!resourceIds.includes(r.id) && resourceIds.length >= 5}
                      onChange={(e) =>
                        setResourceIds((ids) =>
                          e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id),
                        )
                      }
                    />
                    <span>
                      {r.title}
                      <small>{r.filename}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted">
                Upload a file in this {scope === 'subject' ? 'subject' : 'class'} first, then attach
                it here.
              </p>
            )}
          </div>
        )}
        <ErrorNotice message={error} />
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Megaphone size={17} />}{' '}
            {initial ? 'Save announcement' : 'Publish announcement'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AnnouncementCard({
  item,
  onChanged,
  full = false,
  deleted = false,
}: {
  item: Announcement;
  onChanged: () => void;
  full?: boolean;
  deleted?: boolean;
}) {
  const auth = useAuth();
  const toast = useToast();
  const permission = useAcademicPermission(item.classId, item.scope === 'global');
  const canManage = item.canManage === true && permission;
  const detailPath = isMaster(auth.me)
    ? `/admin/announcements/${item.id}`
    : `/announcements/${item.id}`;
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <article
      className={`announcement-card priority-${item.priority} ${item.pinned ? 'pinned' : ''}`}
    >
      <div className="announcement-meta">
        <AudienceLabel item={item} />
        <div className="announcement-flags">
          {item.pinned && (
            <span>
              <Pin size={13} />
              Pinned
            </span>
          )}
          {item.priority !== 'normal' && (
            <span className={`priority-tag ${item.priority}`}>{item.priority}</span>
          )}
        </div>
      </div>
      <div className="announcement-heading">
        <h3>{full || deleted ? item.title : <Link to={detailPath}>{item.title}</Link>}</h3>
        {!deleted && <SaveButton kind="announcement" item={item} />}
      </div>
      <p className={`announcement-body ${full ? 'expanded' : ''}`}>{item.body}</p>
      {!!item.resources.length && (
        <div className="announcement-attachments">
          {item.resources.map((resource) => (
            <ResourceDownload key={resource.id} resource={resource} compact />
          ))}
        </div>
      )}
      <div className="announcement-footer">
        <div className="author-line">
          <span className="author-dot">{item.authorName.slice(0, 1)}</span>
          <span>
            {item.authorName}
            <small>
              <time dateTime={item.createdAt}>{formatDate(item.createdAt, true)}</time>
              {item.updatedAt !== item.createdAt ? ' · Edited' : ''}
            </small>
          </span>
        </div>
        <div className="content-actions">
          {deleted ? (
            canManage && (
              <button
                className="button button-secondary button-small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await auth.request(`/announcements/${item.id}/restore`, { method: 'POST' });
                    onChanged();
                    contentChanged();
                    toast('Announcement restored.');
                  } catch (e) {
                    toast(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RotateCcw size={15} />
                Restore
              </button>
            )
          ) : (
            <>
              {canManage && (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Edit announcement ${item.title}`}
                    onClick={() => setEdit(true)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-button danger-icon"
                    aria-label={`Trash announcement ${item.title}`}
                    onClick={() => setRemove(true)}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
              {!full && (
                <Link className="text-button" to={detailPath}>
                  Read more
                  <ChevronRight size={15} />
                </Link>
              )}
            </>
          )}
        </div>
      </div>
      {edit && canManage && (
        <AnnouncementForm
          initial={item}
          onClose={() => setEdit(false)}
          onDone={() => {
            setEdit(false);
            onChanged();
          }}
        />
      )}
      {remove && canManage && (
        <ConfirmChange
          title="Move this announcement to trash?"
          message="It will disappear from student feeds. A class admin with access can restore it from the recycle bin."
          path={`/announcements/${item.id}`}
          onClose={() => setRemove(false)}
          onDone={() => {
            setRemove(false);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

export function AnnouncementBoard({
  classId,
  subjectId,
  globalOnly = false,
  allowCreate = false,
  compact = false,
  saved = false,
  deleted = false,
  searchQuery,
}: {
  classId?: string;
  subjectId?: string;
  globalOnly?: boolean;
  allowCreate?: boolean;
  compact?: boolean;
  saved?: boolean;
  deleted?: boolean;
  searchQuery?: string;
}) {
  const site = useSite();
  const auth = useAuth();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [create, setCreate] = useState(false);
  const [scope, setScope] = useState('');
  const permission = useAcademicPermission(classId, globalOnly);
  const canCreate = allowCreate === true && permission && !deleted && !saved;
  const q = useDebounced(searchQuery ?? query);
  const state = useApi<AnnouncementListData>(
    site.settings?.features.announcements === false
      ? null
      : `/announcements?${queryString({ classId, subjectId, scope: globalOnly ? 'global' : scope, q, saved, deleted, limit: compact ? 5 : 20, offset })}`,
  );
  useEffect(() => {
    setOffset(0);
  }, [q, scope]);
  if (site.settings?.features.announcements === false)
    return <FeatureUnavailable name="Announcements" />;
  return (
    <section className="announcement-board">
      <div className="section-heading">
        <div>
          <h2>
            {deleted
              ? 'Trashed announcements'
              : saved
                ? 'Saved announcements'
                : globalOnly
                  ? 'University announcements'
                  : compact
                    ? 'On your noticeboard'
                    : 'Announcements'}
          </h2>
          <p>
            {deleted
              ? 'Restore a notice when it needs to be visible again.'
              : globalOnly
                ? 'Only the Master Admin can publish to every class.'
                : compact
                  ? 'Class-wide and university updates, with subject notices alongside.'
                  : 'Important updates without the group-chat scroll.'}
          </p>
        </div>
        {canCreate && (
          <button className="button button-primary" onClick={() => setCreate(true)}>
            <Plus size={17} />
            Post announcement
          </button>
        )}
        {compact && (
          <Link className="text-button" to="/announcements">
            All updates
            <ArrowRight size={15} />
          </Link>
        )}
      </div>
      {!compact && searchQuery === undefined && (
        <FilterBar
          query={query}
          setQuery={(v) => {
            setQuery(v);
            setOffset(0);
          }}
          placeholder="Search announcements"
          onRefresh={state.reload}
        >
          {!subjectId && !globalOnly && (
            <select
              aria-label="Filter announcement audience"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All audiences</option>
              <option value="global">University-wide</option>
              <option value="class">Whole class</option>
              <option value="subject">Subjects</option>
            </select>
          )}
        </FilterBar>
      )}
      {state.loading ? (
        <Spinner label="Loading announcements…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : state.data?.announcements.length ? (
        <>
          <div className="announcement-list">
            {state.data.announcements.map((item) => (
              <AnnouncementCard
                key={item.id}
                item={item}
                deleted={deleted}
                onChanged={state.reload}
              />
            ))}
          </div>
          {!compact && <Pagination {...state.data.pagination} onChange={setOffset} />}
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<Megaphone size={27} />}
            title={
              q
                ? 'No matching announcements.'
                : deleted
                  ? 'The notice recycle bin is empty.'
                  : saved
                    ? 'No saved announcements yet.'
                    : 'A clear noticeboard.'
            }
          >
            {q
              ? 'Try another title or a word from the notice.'
              : saved
                ? 'Tap the bookmark on an announcement to find it here later.'
                : deleted
                  ? 'Announcements moved to trash will appear here.'
                  : 'New updates from your class admins and the Master Admin will appear here.'}
          </EmptyState>
        </div>
      )}
      {create && canCreate && (
        <AnnouncementForm
          classId={classId}
          subjectId={subjectId}
          globalOnly={globalOnly}
          onClose={() => setCreate(false)}
          onDone={() => {
            setCreate(false);
            state.reload();
          }}
        />
      )}
    </section>
  );
}

export function ResourceDownload({
  resource,
  compact = false,
}: {
  resource: Pick<Resource, 'id' | 'title' | 'filename' | 'sizeBytes'>;
  compact?: boolean;
}) {
  const auth = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={compact ? 'file-attachment' : 'button button-secondary button-small'}
      disabled={busy}
      aria-label={`Download ${resource.filename}`}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await auth.requestBlob(`/resources/${resource.id}/download`);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = resource.filename;
          link.rel = 'noopener';
          document.body.appendChild(link);
          link.click();
          link.remove();
          // Give mobile download handlers time to adopt the Blob before releasing it.
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
          toast('Download started. Your browser will save the file.');
        } catch (e) {
          toast(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <LoaderCircle size={16} className="spin" />
      ) : compact ? (
        <Paperclip size={16} />
      ) : (
        <Download size={16} />
      )}
      <span>
        {compact ? resource.title : busy ? 'Downloading…' : 'Download'}
        {compact && <small>{formatBytes(resource.sizeBytes)}</small>}
      </span>
    </button>
  );
}

function ResourceForm({
  classId,
  subjectId,
  initial,
  limits,
  onClose,
  onDone,
}: {
  classId: string;
  subjectId?: string;
  initial?: Resource;
  limits?: ResourceListData['limits'];
  onClose: () => void;
  onDone: () => void;
}) {
  const auth = useAuth();
  const site = useSite();
  const toast = useToast();
  const canManage = useAcademicPermission(classId);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [selectedSubject, setSelectedSubject] = useState(subjectId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const documentBytes =
    limits?.documentBytes ?? Math.min(limits?.fileBytes ?? Infinity, 25 * 1024 * 1024);
  const videoBytes =
    limits?.videoBytes ?? Math.min(limits?.fileBytes ?? Infinity, 100 * 1024 * 1024);
  const subjects = useApi<SubjectList>(
    site.settings?.features.subjects !== false && !subjectId && !initial
      ? `/classes/${classId}/subjects?limit=100`
      : null,
  );
  if (!canManage || site.settings?.features.resources !== true) return null;
  return (
    <Modal
      wide
      title={initial ? 'Edit file details' : 'Upload a lecture resource'}
      description={
        initial
          ? 'Update its title and description. Upload a new file if the document itself has changed.'
          : `PDF, PowerPoint, Word · ${formatBytes(documentBytes)} · MP4/WebM video · ${formatBytes(videoBytes)}`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (initial)
              await auth.request(`/resources/${initial.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ title, description }),
              });
            else {
              if (!file) throw new Error('Choose a lecture file.');
              const video = /\.(mp4|webm)$/i.test(file.name);
              const maximumBytes = video ? videoBytes : documentBytes;
              if (file.size > maximumBytes)
                throw new Error(
                  `Choose a ${video ? 'video' : 'document'} no larger than ${formatBytes(maximumBytes)}.`,
                );
              const form = new FormData();
              form.append('title', title.trim());
              form.append('description', description.trim());
              if (selectedSubject) form.append('subjectId', selectedSubject);
              form.append('file', file);
              await auth.request(`/classes/${classId}/resources`, { method: 'POST', body: form });
            }
            toast(
              initial
                ? 'File details updated.'
                : 'Resource uploaded. Classmates can now download it.',
            );
            contentChanged();
            onDone();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {!initial && (
          <label className="upload-picker">
            <UploadCloud size={32} />
            <strong>{file ? file.name : 'Choose a lecture file'}</strong>
            <span>{file ? formatBytes(file.size) : 'PDF, PowerPoint, Word, MP4, or WebM'}</span>
            <input
              type="file"
              aria-label="Lecture file"
              required
              accept=".pdf,.ppt,.pptx,.doc,.docx,.mp4,.webm,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,video/webm"
              disabled={busy}
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, ''));
              }}
            />
          </label>
        )}
        <label>
          Resource title
          <input
            autoFocus={!!initial}
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lecture 04 — Process scheduling"
          />
        </label>
        {!initial && !subjectId && site.settings?.features.subjects !== false && (
          <label>
            Save to
            <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)}>
              <option value="">Class resources (all subjects)</option>
              {subjects.data?.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ErrorNotice message={subjects.error} />
          </label>
        )}
        <label>
          Description <span className="optional">Optional</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add the lecture date, chapter, or instructions."
          />
        </label>
        {!initial && (
          <div className="info-box">
            <FileText size={19} />
            <p>
              {selectedSubject
                ? 'This file is available to students enrolled in this subject.'
                : 'This file is available to approved members of your section.'}{' '}
              Upload course material you have permission to share. Connect or manage Google Drive in{' '}
              <Link to="/account">Account</Link> when Drive storage is enabled.
            </p>
          </div>
        )}
        <ErrorNotice message={error} />
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : initial ? (
              <Check size={17} />
            ) : (
              <UploadCloud size={17} />
            )}{' '}
            {busy ? 'Saving…' : initial ? 'Save details' : 'Upload resource'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResourceCard({
  item,
  onChanged,
  deleted = false,
}: {
  item: Resource;
  onChanged: () => void;
  deleted?: boolean;
}) {
  const auth = useAuth();
  const toast = useToast();
  const permission = useAcademicPermission(item.classId);
  const canManage = item.canManage === true && permission;
  const [edit, setEdit] = useState(false);
  const [action, setAction] = useState<'trash' | 'purge' | null>(null);
  const [busy, setBusy] = useState(false);
  const extension = item.filename.split('.').pop()?.toUpperCase() || 'FILE';
  return (
    <article className="resource-card">
      <span className={`file-tile file-${extension.toLowerCase()}`}>
        <FileText size={26} />
        <small>{extension}</small>
      </span>
      <div className="resource-copy">
        <div className="resource-heading">
          <h3>{item.title}</h3>
          {!deleted && <SaveButton item={item} kind="resource" />}
        </div>
        <p className="resource-context">
          {item.className}
          {item.subjectName && ` / ${item.subjectName}`}
        </p>
        {item.description && <p className="resource-description">{item.description}</p>}
        <p className="resource-filename">{item.filename}</p>
        <div className="resource-meta">
          <span>{formatBytes(item.sizeBytes)}</span>
          <span>{formatDate(item.createdAt)}</span>
          <span>{item.authorName}</span>
        </div>
      </div>
      <div className="resource-actions">
        {deleted ? (
          canManage && (
            <>
              {item.storageState !== 'deleting' && (
                <button
                  className="button button-secondary button-small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await auth.request(`/resources/${item.id}/restore`, { method: 'POST' });
                      onChanged();
                      contentChanged();
                      toast('Resource restored.');
                    } catch (e) {
                      toast(errorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RotateCcw size={15} />
                  Restore
                </button>
              )}
              <button
                className="button button-danger button-small"
                disabled={busy}
                onClick={() => setAction('purge')}
              >
                <Trash2 size={15} />
                {item.storageState === 'deleting' ? 'Retry removal' : 'Delete permanently'}
              </button>
            </>
          )
        ) : (
          <>
            <ResourceDownload resource={item} />
            {!isMaster(auth.me) && <OfflineSaveButton resource={item} />}
            {canManage && (
              <div className="content-actions">
                <button
                  className="icon-button"
                  aria-label={`Edit resource ${item.title}`}
                  onClick={() => setEdit(true)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button danger-icon"
                  aria-label={`Trash resource ${item.title}`}
                  onClick={() => setAction('trash')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {edit && canManage && (
        <ResourceForm
          initial={item}
          classId={item.classId}
          onClose={() => setEdit(false)}
          onDone={() => {
            setEdit(false);
            onChanged();
          }}
        />
      )}
      {action && canManage && (
        <ConfirmChange
          title={action === 'purge' ? 'Permanently delete this file?' : 'Move this file to trash?'}
          message={
            action === 'purge'
              ? `“${item.filename}” will be removed from storage. This cannot be undone. Students’ previously downloaded copies remain on their devices.`
              : 'Students will no longer see or download this file. It will continue to use storage until it is permanently deleted.'
          }
          path={`/resources/${item.id}${action === 'purge' ? '/purge' : ''}`}
          method={action === 'purge' ? 'POST' : 'DELETE'}
          label={action === 'purge' ? 'Delete permanently' : 'Move to trash'}
          destructive={action === 'purge'}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

export function ResourcesPanel({
  classId,
  subjectId,
  canManage: allowedByParent = false,
  saved = false,
  deleted = false,
  searchQuery,
}: {
  classId?: string;
  subjectId?: string;
  canManage?: boolean;
  saved?: boolean;
  deleted?: boolean;
  searchQuery?: string;
}) {
  const site = useSite();
  const auth = useAuth();
  const permission = useAcademicPermission(classId);
  const canManage = allowedByParent === true && permission;
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [create, setCreate] = useState(false);
  const q = useDebounced(searchQuery ?? query);
  const state = useApi<ResourceListData & { storageUsedBytes?: number }>(
    site.settings?.features.resources === false
      ? null
      : `/resources?${queryString({ classId, subjectId, q, saved, deleted, limit: 20, offset })}`,
  );
  useEffect(() => setOffset(0), [q]);
  if (site.settings?.features.resources === false) return <FeatureUnavailable name="Resources" />;
  return (
    <section className="resources-section">
      <div className="section-heading">
        <div>
          <h2>{deleted ? 'Trashed files' : saved ? 'Saved files' : 'Lecture resources'}</h2>
          <p>
            {deleted
              ? 'Restore files or remove them permanently to free storage.'
              : saved
                ? 'Your bookmarks, available while you have class access.'
                : 'Lectures, slides, and instructions — organized by course.'}
          </p>
        </div>
        {canManage && !auth.offline && classId && !deleted && (
          <button className="button button-primary" onClick={() => setCreate(true)}>
            <UploadCloud size={17} />
            Upload resource
          </button>
        )}
      </div>
      {searchQuery === undefined && (
        <FilterBar
          query={query}
          setQuery={(v) => {
            setQuery(v);
            setOffset(0);
          }}
          placeholder="Search resources"
          onRefresh={state.reload}
        />
      )}
      {canManage && !auth.offline && state.data && classId && (
        <div className="storage-meter">
          <span>
            {formatBytes(state.data.storageUsedBytes ?? 0)} of{' '}
            {formatBytes(state.data.limits.classBytes)} class storage used
          </span>
          <span>Trash counts toward this limit</span>
          <progress
            aria-label="Class storage usage"
            max={state.data.limits.classBytes}
            value={state.data.storageUsedBytes ?? 0}
          />
        </div>
      )}
      {state.loading ? (
        <Spinner label="Loading lecture resources…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : state.data?.resources.length ? (
        <>
          <div className="resource-list">
            {state.data.resources.map((item) => (
              <ResourceCard key={item.id} item={item} deleted={deleted} onChanged={state.reload} />
            ))}
          </div>
          <Pagination {...state.data.pagination} onChange={setOffset} />
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<FolderOpen size={29} />}
            title={
              q
                ? 'No matching resources.'
                : deleted
                  ? 'No files in trash.'
                  : saved
                    ? 'Keep useful files close.'
                    : 'Your course library starts here.'
            }
          >
            {q
              ? 'Search by title, filename, or description.'
              : saved
                ? 'Use the bookmark icon on a file to save it here.'
                : deleted
                  ? 'Files you move to trash will appear here.'
                  : canManage
                    ? 'Upload a document or video for your section or subject.'
                    : 'Your class admins will share lecture files here.'}
          </EmptyState>
        </div>
      )}
      {create && canManage && classId && (
        <ResourceForm
          classId={classId}
          subjectId={subjectId}
          limits={state.data?.limits}
          onClose={() => setCreate(false)}
          onDone={() => {
            setCreate(false);
            state.reload();
          }}
        />
      )}
    </section>
  );
}

export function ClassAcademic({
  classId,
  canManage,
  tab,
}: {
  classId: string;
  canManage: boolean;
  tab: 'announcements' | 'subjects' | 'resources' | 'trash';
}) {
  if (tab === 'subjects') return <SubjectsPanel classId={classId} canManage={canManage} />;
  if (tab === 'resources') return <ResourcesPanel classId={classId} canManage={canManage} />;
  if (tab === 'trash') return <TrashPanel classId={classId} />;
  return <AnnouncementBoard classId={classId} allowCreate={canManage} />;
}

export function TrashPanel({
  classId,
  globalOnly = false,
}: {
  classId?: string;
  globalOnly?: boolean;
}) {
  const canManage = useAcademicPermission(classId, globalOnly);
  const [tab, setTab] = useState<'announcements' | 'resources' | 'subjects'>('announcements');
  if (!canManage)
    return <ErrorNotice message="Only an authorized class admin can open this recycle bin." />;
  return (
    <div className="trash-panel">
      <div className="subnav" role="group" aria-label="Recycle bin content">
        <button
          className={tab === 'announcements' ? 'active' : ''}
          onClick={() => setTab('announcements')}
        >
          Announcements
        </button>
        {!globalOnly && (
          <>
            <button
              className={tab === 'resources' ? 'active' : ''}
              onClick={() => setTab('resources')}
            >
              Files
            </button>
            {classId && (
              <button
                className={tab === 'subjects' ? 'active' : ''}
                onClick={() => setTab('subjects')}
              >
                Subjects
              </button>
            )}
          </>
        )}
      </div>
      {tab === 'announcements' && (
        <AnnouncementBoard classId={classId} globalOnly={globalOnly} deleted />
      )}
      {tab === 'resources' && <ResourcesPanel classId={classId} canManage deleted />}
      {tab === 'subjects' && classId && <SubjectsPanel classId={classId} canManage deleted />}
    </div>
  );
}

function SubjectInvitePanel({ subjectId, onClose }: { subjectId: string; onClose: () => void }) {
  const auth = useAuth(),
    toast = useToast();
  const state = useApi<{ invite: { expiresAt: string; active: boolean } | null }>(
    `/subjects/${subjectId}/invite`,
  );
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function update(method: 'POST' | 'DELETE') {
    setBusy(true);
    setError('');
    try {
      const result = await auth.request<{ code: string; expiresAt: string }>(
        `/subjects/${subjectId}/invite`,
        { method },
      );
      setCode(method === 'POST' ? result : null);
      state.reload();
      toast(method === 'POST' ? 'Subject code created.' : 'Subject code revoked.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Subject join code"
      description="Share this only with students in your section. A first-time request needs section approval."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="form-stack">
        <p>
          Each code expires after seven days. Replacing or revoking it does not remove enrolled
          students.
        </p>
        {code && (
          <div className="invite-result">
            <div className="invite-code">{code.code}</div>
            <CopyButton value={code.code} label="Copy subject code" />
            <p>
              Expires {formatDate(code.expiresAt, true)}. Copy it now; the complete code is shown
              only once.
            </p>
          </div>
        )}
        {!code && state.data?.invite?.active && (
          <p>A code is active until {formatDate(state.data.invite.expiresAt, true)}.</p>
        )}
        <ErrorNotice message={error || state.error} />
        <div className="modal-actions">
          <button
            className="button button-secondary"
            disabled={busy || !state.data?.invite?.active}
            onClick={() => void update('DELETE')}
          >
            Revoke code
          </button>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void update('POST')}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}Create new
            code
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function SubjectPage() {
  const { subjectId = '', classId: routeClassId } = useParams();
  const auth = useAuth();
  const location = useLocation();
  const state = useApi<{ subject: Subject }>(`/subjects/${encodeURIComponent(subjectId)}`);
  const permission = useAcademicPermission(state.data?.subject.classId);
  const [searchParams, setSearchParams] = useSearchParams();
  type SubjectTab = 'announcements' | 'resources' | 'deadlines' | 'chat';
  const requestedTab = searchParams.get('tab');
  const tab: SubjectTab = ['resources', 'deadlines', 'chat'].includes(requestedTab ?? '')
    ? (requestedTab as SubjectTab)
    : 'announcements';
  function setTab(nextTab: SubjectTab) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', nextTab);
      return next;
    });
  }
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [share, setShare] = useState(false);
  if (state.loading) return <Spinner label="Opening subject…" />;
  if (state.error || !state.data)
    return (
      <>
        <Link className="back-link" to={isMaster(auth.me) ? '/admin' : '/subjects'}>
          <ArrowLeft size={16} />
          {isMaster(auth.me) ? 'Owner dashboard' : 'My Subjects'}
        </Link>
        <ErrorNotice message={state.error || 'This subject is unavailable.'} retry={state.reload} />
      </>
    );
  const subject = state.data.subject;
  const owner = isMaster(auth.me);
  if (owner && (!location.pathname.startsWith('/admin/') || routeClassId !== subject.classId))
    return (
      <Navigate
        to={`${subjectPath(true, subject.classId, subject.id)}${location.search}`}
        replace
      />
    );
  const canManage = subject.canManage === true && permission;
  return (
    <>
      <Link className="back-link" to={owner ? `/admin/classes/${subject.classId}` : '/subjects'}>
        <ArrowLeft size={16} />
        {subject.className}
      </Link>
      <section className={`subject-banner tone-${subject.color}`}>
        <span className="subject-emblem">
          <BookOpen size={32} />
        </span>
        <div>
          <span className="eyebrow">
            {subject.className}
            {subject.code && ` / ${subject.code}`}
          </span>
          <h1>{subject.name}</h1>
          <p>{subject.instructor || 'Instructor not added'}</p>
          {subject.description && (
            <p className="subject-banner-description">{subject.description}</p>
          )}
        </div>
        {canManage && (
          <div className="content-actions">
            <button className="button button-secondary button-small" onClick={() => setShare(true)}>
              <KeyRound size={16} />
              Subject code
            </button>
            <button className="button button-secondary button-small" onClick={() => setEdit(true)}>
              <Pencil size={16} />
              Edit subject
            </button>
            <button
              className="icon-button danger-icon"
              aria-label="Move subject to trash"
              onClick={() => setRemove(true)}
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </section>
      <div className="class-tabs" role="group" aria-label="Subject sections">
        <button
          className={tab === 'announcements' ? 'active' : ''}
          onClick={() => setTab('announcements')}
        >
          <Megaphone size={17} />
          Announcements
        </button>
        <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>
          <FolderOpen size={17} />
          Resources
        </button>
        <button className={tab === 'deadlines' ? 'active' : ''} onClick={() => setTab('deadlines')}>
          <CheckSquare2 size={17} />
          Deadlines
        </button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          <MessageCircle size={17} />
          Chat
        </button>
      </div>
      {tab === 'announcements' && (
        <AnnouncementBoard
          classId={subject.classId}
          subjectId={subject.id}
          allowCreate={canManage}
        />
      )}
      {tab === 'resources' && (
        <ResourcesPanel classId={subject.classId} subjectId={subject.id} canManage={canManage} />
      )}
      {tab === 'deadlines' && <DeadlinesPanel classId={subject.classId} subjectId={subject.id} />}
      {tab === 'chat' && <ChatPanel subjectId={subject.id} />}
      {share && canManage && (
        <SubjectInvitePanel subjectId={subject.id} onClose={() => setShare(false)} />
      )}
      {edit && canManage && (
        <SubjectForm
          classId={subject.classId}
          initial={subject}
          onClose={() => setEdit(false)}
          onDone={() => {
            setEdit(false);
            state.reload();
          }}
        />
      )}
      {remove && canManage && (
        <ConfirmChange
          title="Move this subject to trash?"
          message="Its resources and subject announcements will be hidden from students. You can restore the subject from the class recycle bin."
          path={`/subjects/${subject.id}`}
          onClose={() => setRemove(false)}
          onDone={() => {
            setRemove(false);
            state.reload();
          }}
        />
      )}
    </>
  );
}

export function AnnouncementPage() {
  const { id = '' } = useParams();
  const auth = useAuth();
  const owner = isMaster(auth.me);
  const state = useApi<{ announcement: Announcement }>(`/announcements/${encodeURIComponent(id)}`);
  return (
    <>
      <Link
        className="back-link"
        to={
          owner
            ? state.data?.announcement.classId
              ? `/admin/classes/${state.data.announcement.classId}`
              : '/admin?tab=announcements'
            : '/announcements'
        }
      >
        <ArrowLeft size={16} />
        {owner ? 'Back to owner announcements' : 'All announcements'}
      </Link>
      {state.loading ? (
        <Spinner label="Opening announcement…" />
      ) : state.error || !state.data ? (
        <ErrorNotice
          message={state.error || 'This announcement is unavailable.'}
          retry={state.reload}
        />
      ) : (
        <div className="announcement-detail">
          <AnnouncementCard item={state.data.announcement} onChanged={state.reload} full />
          {state.data.announcement.subjectId ? (
            <Link
              className="button button-secondary"
              to={subjectPath(
                owner,
                state.data.announcement.classId!,
                state.data.announcement.subjectId,
              )}
            >
              <BookOpen size={17} />
              Open subject
            </Link>
          ) : state.data.announcement.classId ? (
            <Link
              className="button button-secondary"
              to={`${owner ? '/admin' : ''}/classes/${state.data.announcement.classId}`}
            >
              <BookOpen size={17} />
              Open class
            </Link>
          ) : null}
        </div>
      )}
    </>
  );
}

export function AnnouncementsPage() {
  return (
    <>
      <ActionHeading
        eyebrow="STAY IN THE LOOP"
        title="Your noticeboard"
        subtitle="University, class, and course updates in one place."
      />
      <AnnouncementBoard />
    </>
  );
}

export function SavedPage() {
  const [tab, setTab] = useState<'resources' | 'announcements'>('resources');
  return (
    <>
      <ActionHeading
        eyebrow="PICK UP WHERE YOU LEFT OFF"
        title="Saved for later"
        subtitle="A personal collection of useful files and announcements."
      />
      <div className="subnav" role="group" aria-label="Saved item type">
        <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>
          <BookMarked size={17} />
          Files
        </button>
        <button
          className={tab === 'announcements' ? 'active' : ''}
          onClick={() => setTab('announcements')}
        >
          <Megaphone size={17} />
          Announcements
        </button>
      </div>
      {tab === 'resources' ? <ResourcesPanel saved /> : <AnnouncementBoard saved />}
      <p className="page-hint">
        <Bookmark size={15} />A bookmark saves a reference. Use Download to save a file on your
        device.
      </p>
    </>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'resources' | 'announcements'>('resources');
  return (
    <>
      <ActionHeading
        eyebrow="FIND WHAT YOU NEED"
        title="Search your campus space"
        subtitle="Search content from classes you can access."
      />
      <label className="search-field global-search">
        <Search size={22} />
        <input
          autoFocus
          aria-label="Search all accessible content"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try a lecture topic, filename, or announcement"
          maxLength={100}
        />
        {query && (
          <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={18} />
          </button>
        )}
      </label>
      <div className="subnav" role="group" aria-label="Search content type">
        <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>
          <FileText size={17} />
          Resources
        </button>
        <button
          className={tab === 'announcements' ? 'active' : ''}
          onClick={() => setTab('announcements')}
        >
          <Megaphone size={17} />
          Announcements
        </button>
      </div>
      {tab === 'resources' ? (
        <ResourcesPanel searchQuery={query} />
      ) : (
        <AnnouncementBoard searchQuery={query} />
      )}
    </>
  );
}

export function NotificationsPage() {
  const auth = useAuth();
  const site = useSite();
  const toast = useToast();
  const [unread, setUnread] = useState(false);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useApi<NotificationsData>(
    site.settings?.features.announcements === false
      ? null
      : `/notifications?${queryString({ unread, limit: 30, offset })}`,
  );
  if (site.settings?.features.announcements === false)
    return <FeatureUnavailable name="Notifications" />;
  const read = async (id?: string) => {
    setBusy(true);
    try {
      await auth.request(id ? `/notifications/${id}/read` : '/notifications/read-all', {
        method: 'POST',
      });
      state.reload();
      contentChanged();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ActionHeading
        eyebrow="YOUR UPDATES"
        title="Notifications"
        subtitle="A record of announcements you can currently access."
      >
        <button
          className="button button-secondary"
          disabled={busy || auth.offline || !state.data?.unreadCount}
          onClick={() => void read()}
        >
          <CheckCheck size={17} />
          Mark all as read
        </button>
      </ActionHeading>
      <div className="content-toolbar">
        <div className="subnav compact-subnav" role="group" aria-label="Notification filter">
          <button
            className={!unread ? 'active' : ''}
            onClick={() => {
              setUnread(false);
              setOffset(0);
            }}
          >
            All updates
          </button>
          <button
            className={unread ? 'active' : ''}
            onClick={() => {
              setUnread(true);
              setOffset(0);
            }}
          >
            Unread{state.data && <span className="count-pill">{state.data.unreadCount}</span>}
          </button>
        </div>
        <button className="icon-button" aria-label="Refresh notifications" onClick={state.reload}>
          <RefreshCw size={18} />
        </button>
      </div>
      {state.loading ? (
        <Spinner label="Loading notifications…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : state.data?.notifications.length ? (
        <>
          <div className="notification-list">
            {state.data.notifications.map((item) => (
              <article
                key={item.id}
                className={`notification-row ${item.read ? 'is-read' : 'is-unread'}`}
              >
                <span className="notification-glyph">
                  {item.scope === 'global' ? <Globe2 size={21} /> : <Bell size={21} />}
                </span>
                <Link
                  to={`/announcements/${item.announcementId}`}
                  onClick={() => {
                    if (!item.read && !auth.offline)
                      void auth
                        .request(`/notifications/${item.id}/read`, { method: 'POST' })
                        .then(contentChanged)
                        .catch(() => {});
                  }}
                >
                  <span className="notification-scope">
                    {item.scope === 'global'
                      ? 'University-wide'
                      : item.scope === 'class'
                        ? 'Whole class'
                        : 'Subject update'}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt, true)}</time>
                </Link>
                {!item.read && (
                  <button
                    className="icon-button"
                    disabled={busy || auth.offline}
                    title="Mark as read"
                    aria-label={`Mark ${item.title} as read`}
                    onClick={() => void read(item.id)}
                  >
                    <Check size={18} />
                  </button>
                )}
              </article>
            ))}
          </div>
          <Pagination {...state.data.pagination} onChange={setOffset} />
        </>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<Inbox size={28} />}
            title={unread ? 'You’re all caught up.' : 'No notifications yet.'}
          >
            New class and university announcements will appear here.
          </EmptyState>
        </div>
      )}
      <p className="page-hint">
        <Bell size={15} />
        Your announcement updates appear here. Choose personal deadline alerts in Reminders; device
        notifications are optional when enabled by the application owner.
      </p>
    </>
  );
}
