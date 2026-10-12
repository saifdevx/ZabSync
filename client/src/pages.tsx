import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  Code2,
  CheckSquare2,
  WifiOff,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ExternalLink,
  Fingerprint,
  Globe2,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Megaphone,
  FolderOpen,
  Settings2,
  Smartphone,
  Bookmark,
  Bell,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import {
  ActionHeading,
  AddButton,
  Avatar,
  ClassCard,
  ClassForm,
  CopyButton,
  EmptyState,
  ErrorNotice,
  Modal,
  Pagination,
  RoleBadge,
  Spinner,
  StatusBadge,
  formatDate,
  useToast,
} from './components';
import type { AdminOverview, ClassDetail, ClassFields, ClassRequest } from './types';
import { AnnouncementBoard, ClassAcademic, TrashPanel } from './AcademicPages';
import { AdminDeveloperPanel, AdminSettingsPanel, UserStatusControl } from './OperationsPages';
import { useSite } from './site';
import { contentChanged } from './hooks';
import { TodayCard, TimetablePanel, DeadlinesPanel } from './PlanningPages';
import { SemesterDirectory, AddEnrolledStudent } from './AdminDirectory';
import { canManageAcademic, enrolledClasses, isMaster as isOwnerAccount } from './permissions';

// This stable campus portal is linked by the university's official ZABDESK page.
const ZABDESK_URL = 'https://zabdesk.szabist-isb.edu.pk/';

function useResource<T>(path: string | null) {
  const { request, me, offline, lastSyncedAt } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener('zabsync:content-updated', changed);
    return () => window.removeEventListener('zabsync:content-updated', changed);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(!!path);
    setError('');
    setData(null);
    if (path)
      request<T>(path)
        .then((value) => {
          if (active) setData(value);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [path, request, revision, me?.user.id, offline, lastSyncedAt]);
  return { data, error, loading, reload: useCallback(() => setRevision((value) => value + 1), []) };
}

function WorkspaceActions({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const site = useSite();
  const [params] = useSearchParams();
  const owner = isOwnerAccount(auth.me);
  const paused = site.settings?.maintenance.enabled === true && !owner;
  const selectedSemester =
    owner && params.has('semester') ? Number(params.get('semester')) : undefined;
  const canCreate =
    !auth.offline &&
    !paused &&
    auth.me?.user.status === 'active' &&
    (owner ||
      (auth.me.user.role === 'student' &&
        auth.me.canCreateClass === true &&
        enrolledClasses(auth.me).some((entry) => entry.role === 'admin')));
  const [dialog, setDialog] = useState<'join' | 'create' | null>(null);
  return (
    <>
      <div className={`workspace-actions ${compact ? 'actions-compact' : ''}`}>
        {!owner && (
          <button
            className="button button-secondary"
            disabled={auth.offline || paused}
            onClick={() => setDialog('join')}
          >
            <KeyRound size={17} />
            Join a class
          </button>
        )}
        {canCreate && (
          <button className="button button-primary" onClick={() => setDialog('create')}>
            <Plus size={18} />
            Create class
          </button>
        )}
      </div>
      {dialog === 'join' && !owner && !auth.offline && !paused && (
        <JoinModal onClose={() => setDialog(null)} />
      )}
      {dialog === 'create' && canCreate && (
        <CreateModal initialSemester={selectedSemester} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
function JoinModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Join your class"
      description="Ask your class admin for a current join code."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await auth.request<{ membership: { status: string }; message?: string }>(
              '/join',
              { method: 'POST', body: JSON.stringify({ code: code.trim() }) },
            );
            await auth.refreshMe();
            toast(
              result.membership.status === 'active'
                ? 'You’re already a member of this class. Open it from My classes.'
                : 'Join request sent. Your class admin will review it.',
            );
            onClose();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Class join code
          <input
            className="code-input"
            autoFocus
            required
            minLength={6}
            maxLength={64}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Enter your code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        <div className="info-box">
          <ShieldCheck size={20} />
          <p>Your class admin approves your membership before you can enter the class.</p>
        </div>
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
            {busy ? <LoaderCircle className="spin" size={17} /> : <UserPlus size={17} />}Request to
            join
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CreateModal({
  onClose,
  initialSemester,
}: {
  onClose: () => void;
  initialSemester?: number;
}) {
  const auth = useAuth();
  const navigate = useNavigate();
  const owner = isOwnerAccount(auth.me);
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Create a class space"
      description={
        owner
          ? 'Add a section to the university directory, then enroll students and appoint its class admins.'
          : 'Create a class space and start organizing it immediately. You will be its class admin.'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ClassForm
        initial={
          initialSemester &&
          Number.isInteger(initialSemester) &&
          initialSemester >= 1 &&
          initialSemester <= 20
            ? { name: '', program: '', semester: initialSemester, section: '', description: '' }
            : undefined
        }
        submitLabel="Create class"
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async (fields) => {
          setBusy(true);
          setError('');
          try {
            const result = await auth.request<{ class: { id: string } }>('/classes', {
              method: 'POST',
              body: JSON.stringify({ ...fields, semester: Number(fields.semester) }),
            });
            await auth.refreshMe();
            toast(
              owner
                ? 'Class created. Manage this section from the owner console.'
                : 'Class created. Open it from My classes.',
            );
            contentChanged();
            onClose();
            if (owner) navigate(`/admin/classes/${result.class.id}?view=people`);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Modal>
  );
}

export function Dashboard() {
  const auth = useAuth();
  const site = useSite();
  const me = { ...auth.me!, classes: enrolledClasses(auth.me) };
  const [classId, setClassId] = useState(me.classes[0]?.id ?? '');
  const current = me.classes.find((c) => c.id === classId) ?? me.classes[0];
  const firstName = me.user.displayName.split(' ')[0];
  const date = new Intl.DateTimeFormat('en-PK', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(new Date());
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Karachi',
    }).format(new Date()),
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const shortcuts = [
    { to: '/timetable', label: 'Timetable', icon: CalendarDays, tone: 'blue' },
    { to: '/deadlines', label: 'Deadlines', icon: CheckSquare2, tone: 'purple' },
    { to: '/classes', label: 'My classes', icon: BookOpen, tone: 'teal' },
    { to: '/offline', label: 'Offline', icon: WifiOff, tone: 'amber' },
  ]
    .filter((x) => x.to !== '/timetable' || site.settings?.features.timetable !== false)
    .filter((x) => x.to !== '/deadlines' || site.settings?.features.deadlines !== false);
  return (
    <>
      <div className="dashboard-greeting">
        <div>
          <p className="eyebrow">{date}</p>
          <h1>
            {greeting}, {firstName}
            <span className="greeting-dot">.</span>
          </h1>
          <p>Built for Students. Designed for Success</p>
        </div>
        <WorkspaceActions compact />
      </div>
      <div className="dashboard-top">
        <div className="dashboard-main-card">
          {me.classes.length > 1 && (
            <label className="home-class-select">
              Your space
              <select
                aria-label="Home class"
                value={current?.id}
                onChange={(e) => setClassId(e.target.value)}
              >
                {me.classes.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {current && site.settings?.features.timetable !== false ? (
            <TodayCard classId={current.id} />
          ) : (
            <section className="today-card welcome-class-card">
              <div className="today-card-top">
                <span>YOUR CAMPUS, CONNECTED</span>
                <BookOpen size={24} />
              </div>
              <div className="today-card-body">
                <span className="today-time">Welcome to ZabSync</span>
                <h2>
                  A space for your class.
                  <br />A clearer day for you.
                </h2>
                <p>
                  Use your class admin’s join code to bring your subjects, updates, and timetable
                  together.
                </p>
              </div>
              <Link to="/classes" className="today-card-footer">
                <span>Find your class space</span>
                <ArrowRight size={18} />
              </Link>
            </section>
          )}
        </div>
        <section className="quick-panel" aria-label="Quick actions">
          <div className="section-heading">
            <h2>Quick access</h2>
            <span className="subtle-label">A tap away</span>
          </div>
          <div className="quick-actions">
            {shortcuts.map((s) => (
              <Link
                key={s.to}
                to={
                  current && (s.to === '/timetable' || s.to === '/deadlines')
                    ? `${s.to}?class=${current.id}`
                    : s.to
                }
                className="quick-action"
              >
                <span className={`quick-icon tone-${s.tone}`}>
                  <s.icon size={26} />
                </span>
                <strong>{s.label}</strong>
              </Link>
            ))}
          </div>
          <a className="portal-strip" href={ZABDESK_URL} target="_blank" rel="noopener noreferrer">
            <span>
              <GraduationCap size={22} />
              <span>
                <strong>ZABDESK</strong>
                <small>Results, registration & more</small>
              </span>
            </span>
            <ArrowUpRight size={20} />
          </a>
        </section>
      </div>
      <div className="campus-home-grid">
        <div className="home-feed">
          <AnnouncementBoard compact />
        </div>
        <aside className="campus-side-stack">
          {current && site.settings?.features.deadlines !== false && (
            <DeadlinesPanel classId={current.id} compact />
          )}
          <section className="panel compact-classes">
            <div className="section-heading">
              <h2>
                Your spaces <span className="count-pill">{me.classes.length}</span>
              </h2>
              <Link className="text-button" to="/classes">
                View all
                <ChevronRight size={15} />
              </Link>
            </div>
            {me.classes.length ? (
              me.classes.slice(0, 5).map((item, index) => (
                <Link className="class-shortcut" to={`/classes/${item.id}`} key={item.id}>
                  <span
                    className={`mini-section tone-${['blue', 'teal', 'purple', 'amber', 'rose'][index % 5]}`}
                  >
                    {item.section || item.name.slice(0, 2)}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.program} · Semester {item.semester}
                      {item.role === 'admin' ? ' · Class Admin' : ''}
                    </small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              ))
            ) : (
              <p className="muted">Your approved class will appear here.</p>
            )}
          </section>
          <Link className="install-note" to="/install">
            <span className="install-note-icon">
              <Smartphone size={25} />
            </span>
            <div>
              <strong>Your campus, one tap away.</strong>
              <p>Add ZabSync to your home screen.</p>
              <span>
                Get the app
                <ArrowRight size={15} />
              </span>
            </div>
          </Link>
        </aside>
      </div>
    </>
  );
}

export function ClassesPage() {
  const auth = useAuth();
  const [query, setQuery] = useState('');
  const toast = useToast();
  const classes = enrolledClasses(auth.me).filter((item) =>
    `${item.name} ${item.program} ${item.section}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <ActionHeading
        eyebrow="YOUR WORKSPACE"
        title="My classes"
        subtitle="Every class has a place of its own."
      >
        <WorkspaceActions />
      </ActionHeading>
      <div className="toolbar">
        <label className="search-field">
          <Search size={19} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find one of your classes"
            aria-label="Search your classes"
          />
          {query && (
            <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={17} />
            </button>
          )}
        </label>
        <button
          className="button button-secondary"
          onClick={() =>
            void auth
              .refreshMe()
              .then(() => toast('Your classes are up to date.'))
              .catch((e) => toast(errorMessage(e)))
          }
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      {classes.length ? (
        <div className="class-grid">
          {classes.map((value) => (
            <ClassCard key={value.id} value={value} />
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title={query ? 'No matching classes.' : 'You’re ready for your first class.'}
            action={!query && <WorkspaceActions compact />}
          >
            {query
              ? 'Try a different name or clear your search.'
              : 'Get a join code from your class admin to enter your class space.'}
          </EmptyState>
        </div>
      )}
      <p className="page-hint">
        <LockKeyhole size={15} />
        Only approved members can enter a class space.
      </p>
    </>
  );
}

export function RequestsPage() {
  const auth = useAuth();
  const requests = auth.me!.pendingMemberships;
  return (
    <>
      <ActionHeading
        eyebrow="YOUR MEMBERSHIPS"
        title="Join requests"
        subtitle="See the status of your requests to join a class."
      />
      <section className="panel">
        {requests.length ? (
          <div className="request-list">
            {requests.map((item) => (
              <article className="request-row" key={item.id}>
                <span className="request-icon">
                  <KeyRound size={22} />
                </span>
                <div>
                  <h3>{item.className}</h3>
                  <p>
                    {item.status === 'pending'
                      ? 'Your class admin will review this request.'
                      : item.status === 'approved'
                        ? 'Your membership has been approved.'
                        : item.status === 'removed'
                          ? 'You are no longer enrolled in this class.'
                          : 'This request was not approved.'}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No join requests yet."
            action={
              <Link className="button button-primary" to="/classes">
                My classes
              </Link>
            }
          >
            Use a current class code to request membership.
          </EmptyState>
        )}
      </section>
    </>
  );
}

export function ClassPage({ ownerWorkspace = false }: { ownerWorkspace?: boolean }) {
  const site = useSite();
  const { classId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const owner = isOwnerAccount(auth.me);
  const canView = ownerWorkspace
    ? owner && !auth.offline
    : !owner && enrolledClasses(auth.me).some((entry) => entry.id === classId);
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useResource<ClassDetail>(
    canView ? `/classes/${encodeURIComponent(classId)}?limit=50&offset=${offset}` : null,
  );
  const [tab, setTab] = useState<
    | 'announcements'
    | 'subjects'
    | 'resources'
    | 'people'
    | 'requests'
    | 'settings'
    | 'trash'
    | 'timetable'
    | 'deadlines'
  >('announcements');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [edit, setEdit] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [removeUser, setRemoveUser] = useState<ClassDetail['members'][number] | null>(null);
  const [representative, setRepresentative] = useState<ClassDetail['members'][number] | null>(null);
  const [newRole, setNewRole] = useState<'admin' | 'student'>('admin');
  useEffect(() => {
    setInvite(null);
    setRotate(false);
    setEdit(false);
    setRemoveUser(null);
    setRepresentative(null);
    setTab(searchParams.get('view') === 'people' && !auth.offline ? 'people' : 'announcements');
    setActionError('');
    setQuery('');
    setOffset(0);
  }, [classId, auth.me?.user.id, searchParams, auth.offline]);
  const enabledViews = (
    ['announcements', 'subjects', 'resources', 'timetable', 'deadlines'] as const
  ).filter((view) => site.settings?.features[view] !== false);
  const visibility = enabledViews.join(',');
  useEffect(() => {
    if (
      (['announcements', 'subjects', 'resources', 'timetable', 'deadlines'] as string[]).includes(
        tab,
      ) &&
      !visibility.split(',').includes(tab)
    )
      setTab(enabledViews[0] ?? 'settings');
  }, [tab, visibility]);
  if (!canView)
    return (
      <EmptyState
        icon={<ShieldCheck size={28} />}
        title={
          ownerWorkspace
            ? 'Owner section tools need an online owner account.'
            : 'This class is not in your enrolled classes.'
        }
        action={
          <Link className="button button-secondary" to={owner ? '/admin' : '/classes'}>
            {owner ? 'Owner dashboard' : 'My classes'}
          </Link>
        }
      >
        {ownerWorkspace
          ? 'Reconnect to manage this section.'
          : 'Request membership with a current class code, then wait for approval.'}
      </EmptyState>
    );
  if (loading) return <Spinner label="Opening your class…" />;
  if (error || !data)
    return (
      <>
        <Link className="back-link" to={ownerWorkspace ? '/admin' : '/classes'}>
          <ArrowLeft size={16} />
          {ownerWorkspace ? 'Owner dashboard' : 'My classes'}
        </Link>
        <ErrorNotice message={error || 'Class not found.'} retry={reload} />
      </>
    );
  const canManage =
    canManageAcademic(auth.me, classId, {
      offline: auth.offline,
      maintenance: site.settings?.maintenance.enabled === true,
      ownerContext: ownerWorkspace,
    }) && (ownerWorkspace ? data.myRole === 'master' : data.myRole === 'admin');
  const isMaster = owner && ownerWorkspace && data.myRole === 'master' && !auth.offline;
  const members = data.members.filter((member) =>
    `${member.displayName} ${member.email ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const perform = async (
    id: string,
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) => {
    if (!canManage) {
      setActionError('Only an authorized class admin can make this change.');
      return false;
    }
    setBusy(id);
    setActionError('');
    try {
      await auth.request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      await auth.refreshMe();
      reload();
      contentChanged();
      toast(success);
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      {ownerWorkspace ? (
        <nav className="owner-breadcrumb" aria-label="Owner section breadcrumb">
          <Link to="/admin">Owner dashboard</Link>
          <ChevronRight size={15} />
          <Link to={`/admin?semester=${data.class.semester}`}>Semester {data.class.semester}</Link>
          <ChevronRight size={15} />
          <span>Section {data.class.section}</span>
        </nav>
      ) : (
        <Link className="back-link" to="/classes">
          <ArrowLeft size={16} />
          My classes
        </Link>
      )}
      <section className="class-banner">
        <div className="class-banner-icon">{data.class.name.slice(0, 3)}</div>
        <div className="class-banner-copy">
          <span className="eyebrow">
            {data.class.program} · Semester {data.class.semester}
          </span>
          <h1>{data.class.name}</h1>
          <p>{data.class.description || 'Welcome to your class community.'}</p>
          <div className="class-banner-meta">
            <span>
              <Users size={16} />
              {data.class.memberCount} members
            </span>
            <span>Section {data.class.section}</span>
            <RoleBadge role={data.myRole} />
          </div>
        </div>
        {canManage && (
          <button
            className="button button-white"
            onClick={() => {
              setRotate(true);
              setActionError('');
            }}
          >
            <UserPlus size={17} />
            Invite classmates
          </button>
        )}
      </section>
      <div className="class-tabs" role="group" aria-label="Class sections">
        {site.settings?.features.announcements !== false && (
          <button
            className={tab === 'announcements' ? 'active' : ''}
            onClick={() => setTab('announcements')}
          >
            <Megaphone size={17} />
            Announcements
          </button>
        )}
        {site.settings?.features.subjects !== false && (
          <button className={tab === 'subjects' ? 'active' : ''} onClick={() => setTab('subjects')}>
            <BookOpen size={17} />
            Subjects
          </button>
        )}
        {site.settings?.features.resources !== false && (
          <button
            className={tab === 'resources' ? 'active' : ''}
            onClick={() => setTab('resources')}
          >
            <FolderOpen size={17} />
            Resources
          </button>
        )}
        {site.settings?.features.timetable !== false &&
          (ownerWorkspace ? (
            <Link to={`/admin/classes/${classId}/timetable`} className="owner-class-tab">
              <CalendarDays size={17} />
              Timetable
            </Link>
          ) : (
            <button
              className={tab === 'timetable' ? 'active' : ''}
              onClick={() => setTab('timetable')}
            >
              <CalendarDays size={17} />
              Timetable
            </button>
          ))}
        {site.settings?.features.deadlines !== false &&
          (ownerWorkspace ? (
            <Link to={`/admin/classes/${classId}/deadlines`} className="owner-class-tab">
              <CheckSquare2 size={17} />
              Deadlines
            </Link>
          ) : (
            <button
              className={tab === 'deadlines' ? 'active' : ''}
              onClick={() => setTab('deadlines')}
            >
              <CheckSquare2 size={17} />
              Deadlines
            </button>
          ))}
        {!auth.offline && (
          <button
            className={tab === 'people' ? 'active' : ''}
            onClick={() => {
              setTab('people');
              setOffset(0);
              setQuery('');
            }}
          >
            <Users size={17} />
            People <span>{data.class.memberCount}</span>
          </button>
        )}
        {canManage && (
          <button
            className={tab === 'requests' ? 'active' : ''}
            onClick={() => {
              setTab('requests');
              setOffset(0);
              setQuery('');
            }}
          >
            <ClipboardCheck size={17} />
            Join requests <span>{data.pagination.pendingMembersTotal}</span>
          </button>
        )}
        <button
          className={tab === 'settings' ? 'active' : ''}
          onClick={() => {
            setTab('settings');
            setOffset(0);
          }}
        >
          <Fingerprint size={17} />
          Class details
        </button>
        {canManage && (
          <button className={tab === 'trash' ? 'active' : ''} onClick={() => setTab('trash')}>
            <Trash2 size={17} />
            Recycle bin
          </button>
        )}
      </div>
      <ErrorNotice message={actionError} />
      {(['announcements', 'subjects', 'resources', 'trash'] as const).includes(
        tab as 'announcements' | 'subjects' | 'resources' | 'trash',
      ) &&
        (tab !== 'trash' || canManage) && (
          <ClassAcademic
            key={`${classId}:${tab}`}
            classId={classId}
            canManage={canManage}
            tab={tab as 'announcements' | 'subjects' | 'resources' | 'trash'}
          />
        )}
      {tab === 'timetable' && <TimetablePanel classId={classId} compact />}
      {tab === 'deadlines' && <DeadlinesPanel classId={classId} />}
      {tab === 'people' && isMaster && (
        <AddEnrolledStudent
          classId={classId}
          onChanged={() => {
            reload();
            void auth.refreshMe();
          }}
        />
      )}
      {tab === 'people' && !auth.offline && (
        <section className="panel people-panel">
          <div className="section-heading">
            <div>
              <h2>Your class community</h2>
              <p>Get to know the people in your space.</p>
            </div>
            <button className="icon-button" aria-label="Refresh class members" onClick={reload}>
              <RefreshCw size={18} />
            </button>
          </div>
          <label className="search-field member-search">
            <Search size={18} />
            <input
              placeholder="Filter members on this page"
              aria-label="Filter members on this page"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="people-list">
            {members.map((member) => (
              <div className="person-row" key={member.userId}>
                <Avatar
                  name={member.displayName}
                  userId={member.userId}
                  avatarVersion={
                    site.settings?.features.profilePhotos === false
                      ? null
                      : 'avatarVersion' in member
                        ? (member.avatarVersion as string | null)
                        : null
                  }
                />
                <div className="person-info">
                  <strong>
                    {member.displayName}
                    {member.userId === auth.me!.user.id && <span className="you-label">You</span>}
                  </strong>
                  {member.email && <span>{member.email}</span>}
                  {isMaster && (
                    <>
                      <span>Roll number: {member.rollNumber || 'Not available'}</span>
                      <span className="account-id">ID: {member.userId}</span>
                    </>
                  )}
                </div>
                <RoleBadge
                  role={owner && member.userId === auth.me?.user.id ? 'master' : member.role}
                />
                {canManage && member.userId !== auth.me!.user.id && (
                  <div className="person-actions">
                    {isMaster && (
                      <button
                        className="icon-button"
                        title="Change class admin role"
                        aria-label={`Change role for ${member.displayName}`}
                        onClick={() => {
                          setRepresentative(member);
                          setNewRole(member.role === 'student' ? 'admin' : member.role);
                          setActionError('');
                        }}
                      >
                        <ShieldCheck size={18} />
                      </button>
                    )}
                    {(isMaster || member.role === 'student') && (
                      <button
                        className="icon-button danger-icon"
                        title="Remove from class"
                        aria-label={`Remove ${member.displayName} from class`}
                        onClick={() => {
                          setRemoveUser(member);
                          setActionError('');
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!members.length && (
            <EmptyState title="No classmates found.">Try another name.</EmptyState>
          )}
          {!canManage && (
            <p className="panel-note">
              <ShieldCheck size={16} />
              Your class admins look after this class.
            </p>
          )}
        </section>
      )}
      {tab === 'requests' && canManage && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Join requests</h2>
              <p>Approve students you recognize as members of this class.</p>
            </div>
            <button className="icon-button" aria-label="Refresh join requests" onClick={reload}>
              <RefreshCw size={18} />
            </button>
          </div>
          {data.pendingMembers.length ? (
            <div className="people-list">
              {data.pendingMembers.map((member) => (
                <div className="person-row request-person" key={member.id}>
                  <Avatar
                    name={member.displayName}
                    userId={member.userId}
                    avatarVersion={
                      site.settings?.features.profilePhotos === false
                        ? null
                        : 'avatarVersion' in member
                          ? (member.avatarVersion as string | null)
                          : null
                    }
                  />
                  <div className="person-info">
                    <strong>{member.displayName}</strong>
                    <span>{member.email}</span>
                    <small>Requested {formatDate(member.createdAt)}</small>
                  </div>
                  <div className="request-actions">
                    <button
                      className="button button-secondary button-small"
                      disabled={!!busy}
                      onClick={() =>
                        void perform(
                          member.id,
                          `/classes/${classId}/memberships/${member.id}/decision`,
                          'POST',
                          { decision: 'reject' },
                          'Membership request declined.',
                        )
                      }
                    >
                      <X size={15} />
                      Decline
                    </button>
                    <button
                      className="button button-primary button-small"
                      disabled={!!busy}
                      onClick={() =>
                        void perform(
                          member.id,
                          `/classes/${classId}/memberships/${member.id}/decision`,
                          'POST',
                          { decision: 'approve' },
                          'Classmate approved.',
                        )
                      }
                    >
                      <Check size={16} />
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ClipboardCheck size={28} />} title="No requests to review.">
              New join requests will appear here when classmates use your code.
            </EmptyState>
          )}
        </section>
      )}
      {tab === 'settings' && (
        <div className="class-details-grid">
          <section className="panel">
            <div className="section-heading">
              <h2>About this class</h2>
              {canManage && (
                <button
                  className="text-button"
                  onClick={() => {
                    setEdit(true);
                    setActionError('');
                  }}
                >
                  <Pencil size={16} />
                  Edit details
                </button>
              )}
            </div>
            <dl className="detail-list">
              <div>
                <dt>Class name</dt>
                <dd>{data.class.name}</dd>
              </div>
              <div>
                <dt>Program</dt>
                <dd>{data.class.program}</dd>
              </div>
              <div>
                <dt>Semester / section</dt>
                <dd>
                  {data.class.semester} / {data.class.section}
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(data.class.createdAt)}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{data.class.description || 'No description added.'}</dd>
              </div>
            </dl>
          </section>
          <section className="panel class-identity">
            <div className="identity-icon">
              <Fingerprint size={26} />
            </div>
            <h2>One class. One identity.</h2>
            <p>This Class ID stays the same, even when your join code changes.</p>
            <code className="class-id-value">{data.class.id}</code>
            <CopyButton value={data.class.id} label="Copy Class ID" />
            <div className="identity-divider" />
            <p>
              <KeyRound size={16} />
              Classmates need a join code to request access.
            </p>
            {canManage && (
              <button
                className="button button-primary"
                onClick={() => {
                  setRotate(true);
                  setActionError('');
                }}
              >
                <UserPlus size={17} />
                {data.invite?.active ? 'Create a new join code' : 'Create join code'}
              </button>
            )}
          </section>
        </div>
      )}
      {(tab === 'people' || tab === 'requests') && !auth.offline && (
        <Pagination
          offset={offset}
          limit={50}
          total={
            tab === 'people' ? data.pagination.membersTotal : data.pagination.pendingMembersTotal
          }
          onChange={(next) => {
            setOffset(next);
            setQuery('');
          }}
        />
      )}
      {edit && canManage && (
        <Modal
          title="Edit class details"
          description="Keep your class name and information up to date."
          onClose={() => {
            if (!busy) setEdit(false);
          }}
        >
          <ClassForm
            initial={{ ...data.class, semester: String(data.class.semester) }}
            submitLabel="Save changes"
            busy={!!busy}
            error={actionError}
            onCancel={() => setEdit(false)}
            onSubmit={async (fields) => {
              if (
                await perform(
                  'edit',
                  `/classes/${classId}`,
                  'PATCH',
                  { ...fields, semester: Number(fields.semester) },
                  'Class details updated.',
                )
              )
                setEdit(false);
            }}
          />
        </Modal>
      )}
      {rotate && canManage && (
        <Modal
          title={invite ? 'Your class join code' : 'Invite your classmates'}
          description={
            invite
              ? 'Share this code with students in your class.'
              : 'A new code replaces the previous code. Students still need your approval to enter.'
          }
          onClose={() => {
            if (!busy) {
              setRotate(false);
              setInvite(null);
            }
          }}
        >
          {invite ? (
            <div className="invite-result">
              <div className="invite-code">{invite.code}</div>
              <CopyButton value={invite.code} label="Copy join code" />
              <p>Expires {formatDate(invite.expiresAt, true)} (Pakistan time).</p>
              <div className="info-box">
                <LockKeyhole size={19} />
                <p>Copy it before closing. The full code is only shown when it is created.</p>
              </div>
              <button
                className="button button-primary button-full"
                onClick={() => {
                  setRotate(false);
                  setInvite(null);
                }}
              >
                Done
              </button>
            </div>
          ) : (
            <div className="form-stack">
              <div className="info-box">
                <Clock3 size={20} />
                <p>
                  Codes expire after 7 days. Create another whenever you need one. Existing class
                  members are unaffected.
                </p>
              </div>
              <ErrorNotice message={actionError} />
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  disabled={!!busy}
                  onClick={() => {
                    setRotate(false);
                    setInvite(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy('invite');
                    setActionError('');
                    try {
                      const result = await auth.request<{ code: string; expiresAt: string }>(
                        `/classes/${classId}/invite`,
                        { method: 'POST' },
                      );
                      setInvite(result);
                      toast('New join code created.');
                    } catch (e) {
                      setActionError(errorMessage(e));
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  {busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
                  Create join code
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
      {removeUser && canManage && (
        <Modal
          title="Remove class member?"
          description={`${removeUser.displayName} will lose access to this class. They can request to join again with a valid code.`}
          onClose={() => {
            if (!busy) setRemoveUser(null);
          }}
        >
          <ErrorNotice message={actionError} />
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={!!busy}
              onClick={() => setRemoveUser(null)}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              disabled={!!busy}
              onClick={async () => {
                if (
                  await perform(
                    'remove',
                    `/classes/${classId}/members/${removeUser.userId}`,
                    'DELETE',
                    null,
                    'Member removed from this class.',
                  )
                )
                  setRemoveUser(null);
              }}
            >
              <Trash2 size={16} />
              Remove member
            </button>
          </div>
        </Modal>
      )}
      {representative && isMaster && (
        <Modal
          title="Assign a class role"
          description={`Update ${representative.displayName}’s role in ${data.class.name}.`}
          onClose={() => {
            if (!busy) setRepresentative(null);
          }}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await perform(
                  'role',
                  `/admin/classes/${classId}/members/${representative.userId}/role`,
                  'PATCH',
                  { role: newRole },
                  'Class role updated.',
                )
              )
                setRepresentative(null);
            }}
          >
            <label>
              Class role
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as typeof newRole)}
              >
                <option value="admin">Class Admin</option>
                <option value="student">Student</option>
              </select>
            </label>
            <div className="info-box">
              <ShieldCheck size={20} />
              <p>
                Class Admins manage this class’s subjects, announcements, timetable, and membership
                requests. Only you can assign or remove this role.
              </p>
            </div>
            <ErrorNotice message={actionError} />
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={!!busy}
                onClick={() => setRepresentative(null)}
              >
                Cancel
              </button>
              <button className="button button-primary" disabled={!!busy}>
                Save role
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AdminPage() {
  const site = useSite();
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  type AdminTab =
    'semesters' | 'users' | 'announcements' | 'settings' | 'developer' | 'activity' | 'trash';
  const rawTab = params.get('tab');
  const tab: AdminTab = [
    'users',
    'announcements',
    'settings',
    'developer',
    'activity',
    'trash',
  ].includes(rawTab ?? '')
    ? (rawTab as AdminTab)
    : 'semesters';
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const state = useResource<AdminOverview>(
    isOwnerAccount(auth.me) && !auth.offline ? `/admin/overview?limit=50&offset=${offset}` : null,
  );
  if (!isOwnerAccount(auth.me)) return <Navigate to="/" replace />;
  if (auth.offline)
    return (
      <EmptyState icon={<WifiOff size={28} />} title="Master Admin needs a connection.">
        Reconnect to view student information and manage access.
      </EmptyState>
    );
  if (state.loading) return <Spinner label="Opening Master Admin…" />;
  if (state.error || !state.data)
    return (
      <ErrorNotice message={state.error || 'Administration is unavailable.'} retry={state.reload} />
    );
  const data = state.data;
  const tabs = [
    { id: 'semesters', label: 'Semesters & sections', icon: LayoutGrid },
    { id: 'users', label: 'All students', icon: Users },
    { id: 'announcements', label: 'Global notices', icon: Megaphone },
    { id: 'settings', label: 'App controls', icon: Settings2 },
    { id: 'developer', label: 'Developer', icon: Code2 },
    { id: 'activity', label: 'Activity', icon: Clock3 },
    { id: 'trash', label: 'Recycle bin', icon: Trash2 },
  ] as const;
  return (
    <>
      <ActionHeading
        eyebrow="MASTER ADMIN"
        title="Your campus. Your control."
        subtitle="Open a semester, choose a section, and manage its students and class admins."
      >
        {tab === 'semesters' && <WorkspaceActions compact />}
      </ActionHeading>
      <div className="master-summary">
        <div>
          <Users size={23} />
          <strong>{data.stats.users}</strong>
          <span>Registered accounts</span>
        </div>
        <div>
          <LayoutGrid size={23} />
          <strong>{data.stats.classes}</strong>
          <span>Class spaces</span>
        </div>
        <div>
          <ShieldCheck size={23} />
          <strong>Owner</strong>
          <span>Global permissions</span>
        </div>
      </div>
      <div className="class-tabs admin-tabs" role="group" aria-label="Administration sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set('tab', t.id);
                return next;
              });
              setOffset(0);
              setQuery('');
            }}
          >
            <t.icon size={17} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'semesters' && <SemesterDirectory />}
      {tab === 'users' && (
        <section className="panel">
          <div className="section-heading">
            <h2>Registered accounts</h2>
            <button className="icon-button" aria-label="Refresh accounts" onClick={state.reload}>
              <RefreshCw size={18} />
            </button>
          </div>
          <label className="search-field">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter this page by name, email, or ID"
              aria-label="Filter registered accounts"
            />
          </label>
          <div className="people-list">
            {data.users
              .filter((u) =>
                `${u.displayName} ${u.email} ${u.id}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((u) => (
                <div className="person-row" key={u.id}>
                  <Avatar
                    name={u.displayName}
                    userId={u.id}
                    avatarVersion={
                      site.settings?.features.profilePhotos === false ? null : u.avatarVersion
                    }
                  />
                  <div className="person-info">
                    <strong>{u.displayName}</strong>
                    <span>{u.email}</span>
                    <span className="account-id">ID: {u.id}</span>
                  </div>
                  {u.role === 'master' && <RoleBadge role="master" />}
                  <UserStatusControl user={u} onChanged={state.reload} />
                </div>
              ))}
          </div>
          <Pagination
            limit={50}
            offset={offset}
            total={data.pagination.usersTotal}
            onChange={setOffset}
          />
          <p className="page-hint">
            To assign a Class Admin, open Semesters & sections, then open the class’s People tab.
          </p>
        </section>
      )}
      {tab === 'announcements' && <AnnouncementBoard globalOnly allowCreate />}
      {tab === 'settings' && <AdminSettingsPanel />}
      {tab === 'developer' && <AdminDeveloperPanel />}
      {tab === 'activity' && (
        <section className="panel">
          <div className="section-heading">
            <h2>Recent activity</h2>
            <button className="icon-button" onClick={state.reload} aria-label="Refresh activity">
              <RefreshCw size={18} />
            </button>
          </div>
          <div className="audit-list">
            {data.audit.map((a) => (
              <div className="audit-row" key={a.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{a.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
                  <span>
                    {a.actorEmail || 'System'} · {formatDate(a.createdAt, true)}
                  </span>
                  <small className="account-id">{a.targetId}</small>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            limit={50}
            offset={offset}
            total={data.pagination.auditTotal}
            onChange={setOffset}
          />
        </section>
      )}
      {tab === 'trash' && <TrashPanel globalOnly />}
    </>
  );
}
