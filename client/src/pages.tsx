import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
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
import { AdminSettingsPanel, UserStatusControl } from './OperationsPages';
import { useSite } from './site';

// This stable campus portal is linked by the university's official ZABDESK page.
const ZABDESK_URL = 'https://zabdesk.szabist-isb.edu.pk/';

function useResource<T>(path: string) {
  const { request, me } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
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
  }, [path, request, revision, me?.user.id]);
  return { data, error, loading, reload: useCallback(() => setRevision((value) => value + 1), []) };
}

function WorkspaceActions({ compact = false }: { compact?: boolean }) {
  const [dialog, setDialog] = useState<'join' | 'create' | null>(null);
  return (
    <>
      <div className={`workspace-actions ${compact ? 'actions-compact' : ''}`}>
        <button className="button button-secondary" onClick={() => setDialog('join')}>
          <KeyRound size={17} />
          Join a class
        </button>
        <button className="button button-primary" onClick={() => setDialog('create')}>
          <Plus size={18} />
          Create class
        </button>
      </div>
      {dialog === 'join' && <JoinModal onClose={() => setDialog(null)} />}
      {dialog === 'create' && <CreateModal onClose={() => setDialog(null)} />}
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
      description="Ask your CR or GR for a current join code."
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
                : 'Join request sent. Your representative will review it.',
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
          <p>Your representative approves your membership before you can enter the class.</p>
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
function CreateModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Create a class space"
      description="Your request goes to the Master Admin. If approved, you become the class representative."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ClassForm
        submitLabel="Send request"
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async (fields) => {
          setBusy(true);
          setError('');
          try {
            await auth.request('/class-requests', {
              method: 'POST',
              body: JSON.stringify({ ...fields, semester: Number(fields.semester) }),
            });
            await auth.refreshMe();
            toast('Class request sent to the Master Admin.');
            onClose();
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
  const me = auth.me!;
  const firstName = me.user.displayName.split(' ')[0];
  const pending =
    me.pendingMemberships.filter((item) => item.status === 'pending').length +
    me.classRequests.filter((item) => item.status === 'pending').length;
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
  return (
    <>
      <ActionHeading
        eyebrow={date}
        title={`${greeting}, ${firstName}.`}
        subtitle="Your class updates and course materials, within reach."
      >
        <WorkspaceActions />
      </ActionHeading>
      <section className="campus-digest" aria-label="Your workspace shortcuts">
        <div className="digest-intro">
          <span className="digest-compass" aria-hidden="true">
            ✦
          </span>
          <div>
            <span className="eyebrow">XVIA / CAMPUS DESK</span>
            <h2>
              A little less scrolling.
              <br />A little more clarity.
            </h2>
          </div>
        </div>
        <Link to="/classes" className="digest-item digest-blue">
          <span>
            <LayoutGrid size={20} />
            <strong>{me.classes.length}</strong>
          </span>
          <div>
            Class spaces
            <ArrowUpRight size={17} />
          </div>
        </Link>
        <Link to="/saved" className="digest-item digest-teal">
          <span>
            <Bookmark size={20} />
          </span>
          <div>
            Saved for later
            <ArrowUpRight size={17} />
          </div>
        </Link>
        <Link to="/requests" className="digest-item digest-amber">
          <span>
            <ClipboardCheck size={20} />
            <strong>{pending}</strong>
          </span>
          <div>
            Pending requests
            <ArrowUpRight size={17} />
          </div>
        </Link>
      </section>
      <div className="campus-home-grid">
        <div className="home-feed">
          <AnnouncementBoard compact />
        </div>
        <aside className="campus-side-stack">
          <section className="panel compact-classes">
            <div className="section-heading">
              <h2>
                My classes <span className="count-pill">{me.classes.length}</span>
              </h2>
              <Link className="text-button" to="/classes">
                All
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
                      {item.program} · Sem {item.semester}
                    </small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              ))
            ) : (
              <EmptyState icon={<BookOpen size={25} />} title="Your class belongs here.">
                Ask your CR for a join code, or request a class space.
              </EmptyState>
            )}
          </section>
          <section className="panel campus-links">
            <div className="section-heading">
              <h2>Campus shortcuts</h2>
              <ArrowUpRight size={18} />
            </div>
            <a href={ZABDESK_URL} target="_blank" rel="noopener noreferrer">
              <span className="shortcut-icon tone-blue">
                <GraduationCap size={22} />
              </span>
              <span>
                <strong>ZABDESK portal</strong>
                <small>Results, registration & more</small>
              </span>
              <ExternalLink size={16} />
            </a>
            <a href={auth.config?.universityUrl} target="_blank" rel="noopener noreferrer">
              <span className="shortcut-icon tone-teal">
                <Globe2 size={21} />
              </span>
              <span>
                <strong>University website</strong>
                <small>SZABIST Islamabad</small>
              </span>
              <ExternalLink size={16} />
            </a>
            {site.settings?.features.tutor !== false && (
              <Link to="/tutor">
                <span className="shortcut-icon tone-purple">
                  <Users size={21} />
                </span>
                <span>
                  <strong>Meet your tutor</strong>
                  <small>Support beyond the lecture</small>
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
          </section>
          <Link className="install-note" to="/install">
            <span className="install-note-icon">
              <Smartphone size={25} />
            </span>
            <div>
              <strong>Your campus, one tap away.</strong>
              <p>Add XVIA to your home screen.</p>
              <span>
                How to install <ArrowRight size={15} />
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
  const classes = auth.me!.classes.filter((item) =>
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
              : 'Get a join code from your representative, or create a request for a new class space.'}
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
  const toast = useToast();
  const me = auth.me!;
  return (
    <>
      <ActionHeading
        eyebrow="KEEP TRACK"
        title="My requests"
        subtitle="Follow your class and membership requests."
      >
        <button
          className="button button-secondary"
          onClick={() =>
            void auth
              .refreshMe()
              .then(() => toast('Requests refreshed.'))
              .catch((e) => toast(errorMessage(e)))
          }
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </ActionHeading>
      <div className="requests-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>Class space requests</h2>
            <span className="count-pill">{me.classRequests.length}</span>
          </div>
          {me.classRequests.length ? (
            <div className="request-list">
              {me.classRequests.map((item) => (
                <article key={item.id} className="request-item">
                  <div className="request-title">
                    <span className="request-icon">
                      <LayoutGrid size={20} />
                    </span>
                    <div>
                      <h3>{item.name}</h3>
                      <p>
                        {item.program} · Semester {item.semester}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="request-meta">Requested {formatDate(item.createdAt)}</p>
                  {item.reviewNote && (
                    <div className="review-note">
                      <strong>Admin note</strong>
                      <p>{item.reviewNote}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ClipboardList size={27} />} title="No class requests yet.">
              If you represent your class, request a space from My classes.
            </EmptyState>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>Membership requests</h2>
            <span className="count-pill">{me.pendingMemberships.length}</span>
          </div>
          {me.pendingMemberships.length ? (
            <div className="request-list">
              {me.pendingMemberships.map((item) => (
                <article key={item.id} className="request-item">
                  <div className="request-title">
                    <span className="request-icon">
                      <UserPlus size={20} />
                    </span>
                    <div>
                      <h3>{item.className}</h3>
                      <p>
                        {item.status === 'pending'
                          ? 'Waiting for a CR or GR to review'
                          : item.status === 'approved'
                            ? 'You can now open this class'
                            : item.status === 'removed'
                              ? 'Your membership in this class has ended'
                              : 'Contact your representative for help'}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={<ClipboardCheck size={27} />} title="You’re all caught up.">
              Your join requests and their latest decisions will appear here.
            </EmptyState>
          )}
        </section>
      </div>
      <div className="info-box wide-info">
        <ShieldCheck size={21} />
        <p>
          A join code starts a membership request. It does not grant editing access. The Master
          Admin appoints class representatives.
        </p>
      </div>
    </>
  );
}

export function ClassPage() {
  const { classId = '' } = useParams();
  const auth = useAuth();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useResource<ClassDetail>(
    `/classes/${encodeURIComponent(classId)}?limit=50&offset=${offset}`,
  );
  const [tab, setTab] = useState<
    'announcements' | 'subjects' | 'resources' | 'people' | 'requests' | 'settings' | 'trash'
  >('announcements');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [edit, setEdit] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null);
  const [removeUser, setRemoveUser] = useState<ClassDetail['members'][number] | null>(null);
  const [representative, setRepresentative] = useState<ClassDetail['members'][number] | null>(null);
  const [newRole, setNewRole] = useState<'cr' | 'gr' | 'student'>('cr');
  useEffect(() => {
    setInvite(null);
    setRotate(false);
    setEdit(false);
    setRemoveUser(null);
    setRepresentative(null);
    setTab('announcements');
    setActionError('');
    setQuery('');
    setOffset(0);
  }, [classId, auth.me?.user.id]);
  if (loading) return <Spinner label="Opening your class…" />;
  if (error || !data)
    return (
      <>
        <Link className="back-link" to="/classes">
          <ArrowLeft size={16} />
          My classes
        </Link>
        <ErrorNotice message={error || 'Class not found.'} retry={reload} />
      </>
    );
  const canManage = data.myRole !== 'student';
  const isMaster = data.myRole === 'master';
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
    setBusy(id);
    setActionError('');
    try {
      await auth.request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      await auth.refreshMe();
      reload();
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
      <Link className="back-link" to="/classes">
        <ArrowLeft size={16} />
        My classes
      </Link>
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
        <button
          className={tab === 'announcements' ? 'active' : ''}
          onClick={() => setTab('announcements')}
        >
          <Megaphone size={17} />
          Announcements
        </button>
        <button className={tab === 'subjects' ? 'active' : ''} onClick={() => setTab('subjects')}>
          <BookOpen size={17} />
          Subjects
        </button>
        <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>
          <FolderOpen size={17} />
          Resources
        </button>
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
      {tab === 'people' && (
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
                    'avatarVersion' in member ? (member.avatarVersion as string | null) : null
                  }
                />
                <div className="person-info">
                  <strong>
                    {member.displayName}
                    {member.userId === auth.me!.user.id && <span className="you-label">You</span>}
                  </strong>
                  {member.email && <span>{member.email}</span>}
                </div>
                <RoleBadge role={member.role} />
                {canManage && member.userId !== auth.me!.user.id && (
                  <div className="person-actions">
                    {isMaster && (
                      <button
                        className="icon-button"
                        title="Change representative role"
                        aria-label={`Change role for ${member.displayName}`}
                        onClick={() => {
                          setRepresentative(member);
                          setNewRole(member.role === 'student' ? 'cr' : member.role);
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
              Your CR and GR look after this class.
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
                      'avatarVersion' in member ? (member.avatarVersion as string | null) : null
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
      {tab !== 'settings' && (
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
      {edit && (
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
      {rotate && (
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
      {removeUser && (
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
      {representative && (
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
                  `/admin/classes/${classId}/representatives`,
                  'POST',
                  { userId: representative.userId, role: newRole },
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
                <option value="cr">Class representative (CR)</option>
                <option value="gr">Group representative (GR)</option>
                <option value="student">Student</option>
              </select>
            </label>
            <div className="info-box">
              <ShieldCheck size={20} />
              <p>
                Assigning a new CR or GR returns the previous representative in that role to
                Student. Every class must keep a CR.
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
  const auth = useAuth();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const { data, loading, error, reload } = useResource<AdminOverview>(
    `/admin/overview?limit=50&offset=${offset}`,
  );
  const [tab, setTab] = useState<
    'requests' | 'classes' | 'users' | 'activity' | 'announcements' | 'settings' | 'trash'
  >('requests');
  const [review, setReview] = useState<AdminOverview['requests'][number] | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [query, setQuery] = useState('');
  if (loading) return <Spinner label="Opening administration…" />;
  if (error || !data)
    return <ErrorNotice message={error || 'Admin overview is unavailable.'} retry={reload} />;
  const pending = data.requests.filter((request) => request.status === 'pending');
  return (
    <>
      <ActionHeading
        eyebrow="MASTER ADMINISTRATION"
        title="Master control room"
        subtitle="Manage class spaces, announcements, people, and app settings."
      >
        <button className="button button-secondary" onClick={reload}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </ActionHeading>
      <div className="admin-intro">
        <span className="admin-intro-icon">
          <ShieldCheck size={25} />
        </span>
        <div>
          <strong>You’re the Master Admin.</strong>
          <p>
            Your campus controls, in one dashboard. Open a class to manage its subjects and
            resources.
          </p>
        </div>
        <RoleBadge role="master" />
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-icon blue">
            <Users size={21} />
          </span>
          <div>
            <strong>{data.stats.users}</strong>
            <span>University members</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon green">
            <LayoutGrid size={21} />
          </span>
          <div>
            <strong>{data.stats.classes}</strong>
            <span>Class spaces</span>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon amber">
            <ClipboardCheck size={21} />
          </span>
          <div>
            <strong>{data.stats.pendingRequests}</strong>
            <span>Awaiting your review</span>
          </div>
        </div>
      </div>
      <div className="class-tabs admin-tabs" role="group" aria-label="Administration sections">
        {(
          [
            'requests',
            'classes',
            'users',
            'announcements',
            'settings',
            'activity',
            'trash',
          ] as const
        ).map((value) => (
          <button
            className={tab === value ? 'active' : ''}
            key={value}
            onClick={() => {
              setTab(value);
              setQuery('');
              setOffset(0);
            }}
          >
            {value === 'requests' ? (
              <ClipboardCheck size={17} />
            ) : value === 'classes' ? (
              <LayoutGrid size={17} />
            ) : value === 'users' ? (
              <Users size={17} />
            ) : value === 'announcements' ? (
              <Megaphone size={17} />
            ) : value === 'settings' ? (
              <Settings2 size={17} />
            ) : value === 'trash' ? (
              <Trash2 size={17} />
            ) : (
              <Clock3 size={17} />
            )}
            {value === 'requests'
              ? 'Class requests'
              : value === 'classes'
                ? 'All classes'
                : value === 'users'
                  ? 'Members'
                  : value === 'announcements'
                    ? 'Global notices'
                    : value === 'settings'
                      ? 'Settings & Tutor'
                      : value === 'trash'
                        ? 'Recycle bin'
                        : 'Activity'}
            {value === 'requests' && <span>{pending.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'requests' && (
        <section className="panel">
          <div className="section-heading">
            <h2>Class requests to review</h2>
            <span className="count-pill">{pending.length}</span>
          </div>
          {pending.length ? (
            <div className="admin-request-grid">
              {pending.map((item) => (
                <article className="admin-request-card" key={item.id}>
                  <div className="request-title">
                    <span className="request-icon">
                      <BookOpen size={22} />
                    </span>
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.program}</p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="admin-request-meta">
                    <span>
                      Semester {item.semester} · Section {item.section}
                    </span>
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  {item.description && (
                    <p className="admin-request-description">{item.description}</p>
                  )}
                  <div className="requester">
                    <Avatar name={item.requester.displayName} size="small" />
                    <div>
                      <strong>{item.requester.displayName}</strong>
                      <small>{item.requester.email}</small>
                    </div>
                  </div>
                  <button
                    className="button button-primary button-full"
                    onClick={() => {
                      setReview(item);
                      setDecision('approve');
                      setNote('');
                      setActionError('');
                    }}
                  >
                    Review request
                    <ArrowRight size={17} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={<CheckCircle2 size={29} />} title="All caught up.">
              There are no new class requests to review.
            </EmptyState>
          )}
          {data.requests.some((item) => item.status !== 'pending') && (
            <div className="past-requests">
              <h3>Recently reviewed</h3>
              {data.requests
                .filter((item) => item.status !== 'pending')
                .map((item) => (
                  <div className="account-class-row" key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.requester.displayName}</small>
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                ))}
            </div>
          )}
        </section>
      )}
      {tab === 'classes' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>All class spaces</h2>
              <p>Open a class to review membership and appoint its CR or GR.</p>
            </div>
          </div>
          <label className="search-field member-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter classes on this page"
              placeholder="Filter this page by class name or ID"
            />
          </label>
          <div className="admin-classes">
            {data.classes
              .filter((item) =>
                `${item.name} ${item.id} ${item.program}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((item) => (
                <Link className="admin-class-row" to={`/classes/${item.id}`} key={item.id}>
                  <span className="class-glyph small">{item.section}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.program} · Semester {item.semester}
                    </span>
                    <code>{item.id}</code>
                  </div>
                  <span className="admin-member-count">
                    <Users size={15} />
                    {item.memberCount}
                  </span>
                  <ChevronRight size={18} />
                </Link>
              ))}
          </div>
          {!data.classes.length && (
            <EmptyState title="The first class starts here.">
              Approve a class request to create its workspace.
            </EmptyState>
          )}
        </section>
      )}
      {tab === 'users' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>University members</h2>
              <p>Accounts that have accessed XVIA.</p>
            </div>
          </div>
          <label className="search-field member-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter members on this page"
              placeholder="Filter this page by name or email"
            />
          </label>
          <div className="people-list">
            {data.users
              .filter((user) =>
                `${user.displayName} ${user.email}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((user) => (
                <div className="person-row" key={user.id}>
                  <Avatar
                    name={user.displayName}
                    userId={user.id}
                    avatarVersion={user.avatarVersion}
                  />
                  <div className="person-info">
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                  </div>
                  <RoleBadge role={user.role === 'master' ? 'master' : user.status} />
                  <UserStatusControl user={user} onChanged={reload} />
                </div>
              ))}
          </div>
        </section>
      )}
      {tab === 'announcements' && <AnnouncementBoard globalOnly allowCreate />}
      {tab === 'settings' && <AdminSettingsPanel />}
      {tab === 'trash' && <TrashPanel />}
      {tab === 'activity' && (
        <section className="panel">
          <div className="section-heading">
            <h2>Recent administrative activity</h2>
            <Clock3 size={19} />
          </div>
          {data.audit.length ? (
            <div className="activity-list">
              {data.audit.map((item) => (
                <div className="activity-row" key={item.id}>
                  <span className="activity-dot" />
                  <div>
                    <strong>{item.action.replace(/[._-]/g, ' ')}</strong>
                    <p>{item.actorEmail || 'System'}</p>
                    <code>{item.targetId}</code>
                  </div>
                  <time>{formatDate(item.createdAt, true)}</time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Clock3 size={27} />} title="A fresh start.">
              Class and membership administration will appear here as it happens.
            </EmptyState>
          )}
        </section>
      )}
      {['requests', 'classes', 'users', 'activity'].includes(tab) && (
        <Pagination
          offset={offset}
          limit={50}
          total={
            tab === 'requests'
              ? data.pagination.requestsTotal
              : tab === 'classes'
                ? data.pagination.classesTotal
                : tab === 'users'
                  ? data.pagination.usersTotal
                  : data.pagination.auditTotal
          }
          onChange={(next) => {
            setOffset(next);
            setQuery('');
          }}
        />
      )}
      {review && (
        <Modal
          title={`Review ${review.name}`}
          description="Confirm the class and the representative before approving."
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setActionError('');
              try {
                await auth.request(`/admin/class-requests/${review.id}/decision`, {
                  method: 'POST',
                  body: JSON.stringify({ decision, note }),
                });
                await auth.refreshMe();
                setReview(null);
                reload();
                toast(
                  decision === 'approve'
                    ? 'Class approved. Its requester is now the CR.'
                    : 'Class request declined.',
                );
              } catch (e) {
                setActionError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="review-summary">
              <strong>{review.requester.displayName}</strong>
              <span>{review.requester.email}</span>
              <p>
                {review.program} · Semester {review.semester} · Section {review.section}
              </p>
            </div>
            <label>
              Decision
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as typeof decision)}
              >
                <option value="approve">Approve class and appoint requester as CR</option>
                <option value="reject">Decline class request</option>
              </select>
            </label>
            <label>
              Note to requester <span className="optional">Optional</span>
              <textarea
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add any context they should know"
              />
            </label>
            <ErrorNotice message={actionError} />
            <div className="modal-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Cancel
              </button>
              <button
                className={`button ${decision === 'approve' ? 'button-primary' : 'button-danger'}`}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : decision === 'approve' ? (
                  <Check size={17} />
                ) : (
                  <X size={17} />
                )}
                {decision === 'approve' ? 'Approve class' : 'Decline request'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
