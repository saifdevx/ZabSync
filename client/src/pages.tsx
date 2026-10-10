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
  const me = auth.me!;
  const firstName = me.user.displayName.split(' ')[0];
  const pending =
    me.pendingMemberships.filter((item) => item.status === 'pending').length +
    me.classRequests.filter((item) => item.status === 'pending').length;
  const reps = me.classes.filter((item) => item.role === 'cr' || item.role === 'gr');
  const date = new Intl.DateTimeFormat('en-PK', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(new Date());
  return (
    <>
      <ActionHeading
        eyebrow={date}
        title={`Welcome, ${firstName}.`}
        subtitle="A space for your class. A simpler campus day."
      >
        <WorkspaceActions />
      </ActionHeading>
      <section className="welcome-panel">
        <div className="welcome-content">
          <span className="welcome-kicker">
            <span className="welcome-dot" /> YOUR CAMPUS COMMUNITY
          </span>
          <h2>
            Good things happen
            <br />
            when your class is together.
          </h2>
          <p>
            {me.classes.length
              ? 'Open your class space and keep your community connected.'
              : 'Your next chapter starts with a class. Ask your representative for a join code.'}
          </p>
          <Link className="welcome-link" to="/classes">
            {me.classes.length ? 'Go to my classes' : 'Find your class'}
            <ArrowRight size={18} />
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="art-ring ring-one" />
          <div className="art-ring ring-two" />
          <div className="art-tile tile-back">
            <Users size={32} />
          </div>
          <div className="art-tile tile-front">
            <GraduationCap size={48} />
            <span>Better together</span>
            <div className="art-line" />
            <div className="art-line short" />
          </div>
          <span className="art-star">
            <Sparkles size={26} />
          </span>
          <span className="art-dot" />
        </div>
      </section>
      <div className="stats-grid">
        <Link to="/classes" className="stat-card">
          <span className="stat-icon blue">
            <LayoutGrid size={21} />
          </span>
          <div>
            <strong>{me.classes.length.toString().padStart(2, '0')}</strong>
            <span>My classes</span>
          </div>
          <ChevronRight size={17} />
        </Link>
        <Link to="/requests" className="stat-card">
          <span className="stat-icon amber">
            <Clock3 size={21} />
          </span>
          <div>
            <strong>{pending.toString().padStart(2, '0')}</strong>
            <span>Pending requests</span>
          </div>
          <ChevronRight size={17} />
        </Link>
        <Link to={me.user.role === 'master' ? '/admin' : '/account'} className="stat-card">
          <span className="stat-icon green">
            <ShieldCheck size={21} />
          </span>
          <div>
            <strong className="stat-word">
              {me.user.role === 'master'
                ? 'Master Admin'
                : reps.length
                  ? 'Representative'
                  : auth.config?.authMode === 'demo'
                    ? 'Demo member'
                    : 'Verified'}
            </strong>
            <span>
              {me.user.role === 'master'
                ? 'Manage your campus'
                : reps.length
                  ? `For ${reps.length} ${reps.length === 1 ? 'class' : 'classes'}`
                  : 'University account'}
            </span>
          </div>
          <ChevronRight size={17} />
        </Link>
      </div>
      <div className="dashboard-grid">
        <section>
          <div className="section-heading">
            <h2>
              Your class spaces <span className="count-pill">{me.classes.length}</span>
            </h2>
            <Link className="text-button" to="/classes">
              View all <ArrowRight size={15} />
            </Link>
          </div>
          {me.classes.length ? (
            <div className="class-grid dashboard-classes">
              {me.classes.slice(0, 4).map((value) => (
                <ClassCard key={value.id} value={value} />
              ))}
            </div>
          ) : (
            <div className="panel">
              <EmptyState title="Your class belongs here." action={<WorkspaceActions compact />}>
                Join with a code, or request a new space if you’re your class representative.
              </EmptyState>
            </div>
          )}
          <div className="community-note">
            <div className="note-icon">
              <Users size={23} />
            </div>
            <div>
              <h3>A familiar class. A shared space.</h3>
              <p>
                Your CR and GR manage membership and class details. You stay in control of your own
                profile.
              </p>
            </div>
          </div>
        </section>
        <aside className="dashboard-aside">
          <section className="panel campus-links">
            <div className="section-heading">
              <h2>Campus shortcuts</h2>
              <ArrowUpRight size={18} />
            </div>
            <a href={ZABDESK_URL} target="_blank" rel="noopener noreferrer">
              <span className="shortcut-icon">
                <GraduationCap size={22} />
              </span>
              <span>
                <strong>ZABDESK portal</strong>
                <small>Open your student portal</small>
              </span>
              <ExternalLink size={16} />
            </a>
            <a href={auth.config?.universityUrl} target="_blank" rel="noopener noreferrer">
              <span className="shortcut-icon">
                <Globe2 size={21} />
              </span>
              <span>
                <strong>University website</strong>
                <small>SZABIST Islamabad</small>
              </span>
              <ExternalLink size={16} />
            </a>
          </section>
          <section className="panel getting-started">
            <span className="eyebrow">A GOOD PLACE TO START</span>
            <h2>Make yourself at home.</h2>
            <div className="check-step">
              <span className="step-done">
                <Check size={15} />
              </span>
              <div>
                <strong>
                  {auth.config?.authMode === 'demo'
                    ? 'Explore with a demo account'
                    : 'Verify your university email'}
                </strong>
                <p>
                  {auth.config?.authMode === 'demo'
                    ? 'Try all four roles from the bar above.'
                    : 'Your account is ready to use.'}
                </p>
              </div>
            </div>
            <div className="check-step">
              <span className={me.classes.length ? 'step-done' : 'step-number'}>
                {me.classes.length ? <Check size={15} /> : '2'}
              </span>
              <div>
                <strong>Join your class space</strong>
                <p>
                  {me.classes.length
                    ? 'Your community is one tap away.'
                    : 'Use a code from your CR or GR.'}
                </p>
              </div>
            </div>
            <Link className="check-step step-link" to="/account">
              <span className="step-number">3</span>
              <div>
                <strong>Check your profile</strong>
                <p>Help your classmates recognize you.</p>
              </div>
              <ChevronRight size={17} />
            </Link>
          </section>
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
  const [tab, setTab] = useState<'people' | 'requests' | 'settings'>('people');
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
    setTab('people');
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
      </div>
      <ErrorNotice message={actionError} />
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
                <Avatar name={member.displayName} />
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
                  <Avatar name={member.displayName} />
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

export function AccountPage() {
  const auth = useAuth();
  const user = auth.me!.user;
  const toast = useToast();
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(user.displayName), [user.id, user.displayName]);
  return (
    <>
      <ActionHeading
        eyebrow="A LITTLE ABOUT YOU"
        title="My account"
        subtitle="Help your classmates put a name to your profile."
      />
      <div className="account-grid">
        <section className="panel profile-summary">
          <Avatar name={user.displayName} size="large" />
          <h2>{user.displayName}</h2>
          <p className="profile-email">{user.email}</p>
          <RoleBadge role={user.role === 'master' ? 'master' : 'active'} />
          <div className="identity-divider" />
          <p>
            <ShieldCheck size={18} />
            {auth.config?.authMode === 'demo' ? 'Local demo identity' : 'University email verified'}
          </p>
          <p>
            <LayoutGrid size={17} />
            Member of {auth.me!.classes.length}{' '}
            {auth.me!.classes.length === 1 ? 'class' : 'classes'}
          </p>
        </section>
        <div className="account-main">
          <section className="panel">
            <div className="section-heading">
              <h2>Profile details</h2>
              <UserPlus size={19} />
            </div>
            <form
              className="form-stack"
              onSubmit={async (event: FormEvent) => {
                event.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await auth.request('/me', {
                    method: 'PATCH',
                    body: JSON.stringify({ displayName: name.trim() }),
                  });
                  await auth.refreshMe();
                  toast('Your profile is updated.');
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Display name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <small>This name appears in your class member list.</small>
              </label>
              <label>
                University email
                <div className="readonly-field">
                  <Mail size={17} />
                  <span>{user.email}</span>
                  <LockKeyhole size={15} />
                </div>
                <small>Your email is linked to your verified identity.</small>
              </label>
              <ErrorNotice message={error} />
              <div className="form-footer">
                <button
                  className="button button-primary"
                  disabled={busy || name.trim() === user.displayName}
                >
                  {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Save
                  changes
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Your class roles</h2>
            </div>
            {auth.me!.classes.length ? (
              auth.me!.classes.map((value) => (
                <Link to={`/classes/${value.id}`} className="account-class-row" key={value.id}>
                  <span>
                    <strong>{value.name}</strong>
                    <small>{value.program}</small>
                  </span>
                  <RoleBadge role={value.role} />
                  <ChevronRight size={16} />
                </Link>
              ))
            ) : (
              <p className="muted">Your roles appear here once you join a class.</p>
            )}
            <p className="panel-note">
              Representative access belongs to a specific class. The Master Admin manages these
              assignments.
            </p>
          </section>
          <section className="panel signout-panel">
            <div>
              <h2>Finished for now?</h2>
              <p>Sign out when you’re using a shared device.</p>
            </div>
            <button
              className="button button-secondary"
              onClick={() => void auth.logout().catch((e) => toast(errorMessage(e)))}
            >
              <LogOut size={17} />
              Sign out
            </button>
          </section>
        </div>
      </div>
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
  const [tab, setTab] = useState<'requests' | 'classes' | 'users' | 'activity'>('requests');
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
        title="A well-connected campus."
        subtitle="Manage class spaces and the people who look after them."
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
          <p>Class approvals and representative appointments are managed here.</p>
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
        {(['requests', 'classes', 'users', 'activity'] as const).map((value) => (
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
            ) : (
              <Clock3 size={17} />
            )}
            {value === 'requests'
              ? 'Class requests'
              : value === 'classes'
                ? 'All classes'
                : value === 'users'
                  ? 'Members'
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
              <p>Accounts that have accessed CampusDesk.</p>
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
                  <Avatar name={user.displayName} />
                  <div className="person-info">
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                  </div>
                  <RoleBadge role={user.role === 'master' ? 'master' : user.status} />
                </div>
              ))}
          </div>
        </section>
      )}
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
