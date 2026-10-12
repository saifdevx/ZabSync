import { useEffect, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  CalendarDays,
  Code2,
  CheckSquare2,
  ArrowUpRight,
  Bell,
  Bookmark,
  BookOpen,
  Menu,
  Search,
  Settings2,
  Smartphone,
  Users,
  Wrench,
  ClipboardList,
  ExternalLink,
  GraduationCap,
  Home,
  LayoutGrid,
  LogOut,
  ShieldCheck,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import { AuthScreen, VerificationScreen } from './AuthScreen';
import { Avatar, EmptyState, ErrorNotice, Spinner, useToast } from './components';
import { AdminPage, ClassPage, ClassesPage, Dashboard, RequestsPage } from './pages';
import {
  AnnouncementPage,
  AnnouncementsPage,
  NotificationsPage,
  SavedPage,
  SearchPage,
  SubjectPage,
} from './AcademicPages';
import { DeveloperPage, ProfilePage } from './OperationsPages';
import { PlanningPage } from './PlanningPages';
import { OfflinePage } from './OfflinePage';
import { InstallBanner, InstallPage, InstallProvider } from './InstallPage';
import { SiteProvider, useSite } from './site';
import { useApi } from './hooks';
import type { NotificationsData } from './academic-types';
import type { Persona } from './types';
import { enrolledClasses, isMaster } from './permissions';

export default function App() {
  return (
    <InstallProvider>
      <AuthenticatedApp />
    </InstallProvider>
  );
}

function AuthenticatedApp() {
  const auth = useAuth();
  if (auth.configError)
    return (
      <main className="center-screen">
        <div className="verification-card">
          <div className="brand-symbol">
            <GraduationCap size={30} />
          </div>
          <h1>Let’s reconnect.</h1>
          <ErrorNotice message={auth.configError} />
          <p className="muted">
            If you’re running locally, check that both the API and web app started successfully in
            your terminal.
          </p>
          <button className="button button-primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  if (auth.loading)
    return (
      <main className="center-screen">
        <Spinner label="Opening your campus…" />
      </main>
    );
  if (!auth.signedIn) return <AuthScreen />;
  if (!auth.verified) return <VerificationScreen />;
  if (!auth.me)
    return (
      <main className="center-screen">
        <div className="verification-card">
          <ShieldCheck size={36} />
          <h1>Unable to open your account.</h1>
          <ErrorNotice message={auth.meError} retry={() => void auth.refreshMe().catch(() => {})} />
          <button className="button button-secondary" onClick={() => void auth.logout()}>
            Back to sign in
          </button>
        </div>
      </main>
    );
  if (!['student', 'master'].includes(auth.me.user.role) || auth.me.user.status !== 'active')
    return (
      <main className="center-screen">
        <div className="verification-card">
          <ShieldCheck size={36} />
          <h1>Account access is unavailable.</h1>
          <ErrorNotice message="Your account permissions could not be confirmed. Reconnect and sign in again." />
          <button className="button button-secondary" onClick={() => void auth.logout()}>
            Back to sign in
          </button>
        </div>
      </main>
    );
  return (
    <SiteProvider key={auth.me.user.id}>
      <AppShell />
    </SiteProvider>
  );
}

function AppShell() {
  const auth = useAuth();
  const me = auth.me!;
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const site = useSite();
  const owner = isMaster(me);
  const homePath = owner ? '/admin' : '/';
  const [switching, setSwitching] = useState(false);
  const nav = owner
    ? [
        { to: '/admin', label: 'Owner dashboard', icon: ShieldCheck },
        { to: '/developer', label: 'Meet the Developer', icon: Code2 },
        { to: '/install', label: 'Get the App', icon: Smartphone },
        { to: '/account', label: 'My profile', icon: UserRound },
      ]
    : [
        { to: '/', label: 'Home', icon: Home },
        { to: '/classes', label: 'My classes', icon: BookOpen },
        ...(site.settings?.features.timetable === false
          ? []
          : [{ to: '/timetable', label: 'Timetable', icon: CalendarDays }]),
        ...(site.settings?.features.deadlines === false
          ? []
          : [{ to: '/deadlines', label: 'Deadlines', icon: CheckSquare2 }]),
        ...(site.settings?.features.announcements === false
          ? []
          : [{ to: '/announcements', label: 'Noticeboard', icon: Bell }]),
        { to: '/saved', label: 'Saved items', icon: Bookmark },
        { to: '/offline', label: 'Offline access', icon: WifiOff },
        { to: '/install', label: 'Get the App', icon: Smartphone },
      ];
  const mobile = owner
    ? [
        { to: '/admin', label: 'Console', icon: ShieldCheck },
        { to: '/developer', label: 'Developer', icon: Code2 },
        { to: '/install', label: 'Get the App', icon: Smartphone },
        { to: '/more', label: 'More', icon: LayoutGrid },
      ]
    : [
        { to: '/', label: 'Home', icon: Home },
        site.settings?.features.timetable === false
          ? { to: '/classes', label: 'Classes', icon: BookOpen }
          : { to: '/timetable', label: 'Timetable', icon: CalendarDays },
        site.settings?.features.announcements === false
          ? { to: '/saved', label: 'Saved', icon: Bookmark }
          : { to: '/announcements', label: 'Updates', icon: Bell },
        { to: '/more', label: 'More', icon: LayoutGrid },
      ];
  const notifications = useApi<NotificationsData>(
    owner || auth.offline || site.settings?.features.announcements !== true
      ? null
      : '/notifications?limit=1',
  );
  useEffect(() => {
    const refresh = () => notifications.reload();
    window.addEventListener('zabsync:content-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('zabsync:content-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [notifications.reload]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  const signout = async () => {
    try {
      await auth.logout();
      navigate('/');
    } catch (e) {
      toast(errorMessage(e));
    }
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link
          className="app-brand"
          to={homePath}
          aria-label={owner ? 'ZabSync owner dashboard' : 'ZabSync home'}
        >
          <img className="brand-logo" src="/icons/zabsync-icon.png" alt="" width="44" height="44" />
          <span>
            <strong>
              Zab<span className="brand-sync">Sync</span>
            </strong>
            <small>YOUR CAMPUS, CONNECTED</small>
          </span>
        </Link>
        <div className="nav-section-label">{owner ? 'OWNER WORKSPACE' : 'YOUR EVERYDAY'}</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              <item.icon size={20} />
              <span>{item.label}</span>
              {item.to === '/classes' && (
                <span className="nav-count">{enrolledClasses(me).length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <Link className="sidebar-developer" to="/developer">
          <span className="sidebar-developer-icon">
            <Code2 size={21} />
          </span>
          <strong>Meet the Developer</strong>
          <p>The person behind ZabSync, their updates and other apps.</p>
          <span className="sidebar-developer-link">
            Open developer page <ArrowUpRight size={15} />
          </span>
        </Link>
        <div className="sidebar-profile">
          <Link to="/account">
            <Avatar
              name={me.user.displayName}
              userId={me.user.id}
              avatarVersion={
                site.settings?.features.profilePhotos === false ? null : me.user.avatarVersion
              }
              size="small"
            />
            <span>
              <strong>{me.user.displayName}</strong>
              <small>
                {me.user.role === 'master'
                  ? 'Master Admin'
                  : me.canCreateClass
                    ? 'Class Admin'
                    : 'Student'}
              </small>
            </span>
          </Link>
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void signout()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link className="mobile-brand" to={homePath}>
            <img src="/icons/zabsync-icon.png" alt="" width="32" height="32" />
            <strong>
              Zab<span className="brand-sync">Sync</span>
            </strong>
          </Link>
          <div className="campus-location">
            <span className="green-dot" />
            Islamabad campus
            <span className="campus-term">
              {owner ? 'Owner administration' : 'Your everyday, organized.'}
            </span>
          </div>
          <div className="topbar-right">
            {!owner && (
              <Link
                className="icon-button topbar-search"
                to="/search"
                aria-label="Search class content"
              >
                <Search size={21} />
              </Link>
            )}
            {!owner && site.settings?.features.announcements === true && (
              <Link
                className="icon-button notification-button"
                to="/notifications"
                aria-label={`Notifications${notifications.data?.unreadCount ? `, ${notifications.data.unreadCount} unread` : ''}`}
              >
                <Bell size={21} />
                {!!notifications.data?.unreadCount && (
                  <span className="unread-count">
                    {notifications.data.unreadCount > 99 ? '99+' : notifications.data.unreadCount}
                  </span>
                )}
              </Link>
            )}
            {owner && !auth.offline && (
              <Link
                className="icon-button topbar-admin"
                to="/admin"
                aria-label="Master Admin dashboard"
              >
                <ShieldCheck size={21} />
              </Link>
            )}
            <Link to="/account" aria-label="Open your account">
              <Avatar
                name={me.user.displayName}
                userId={me.user.id}
                avatarVersion={
                  site.settings?.features.profilePhotos === false ? null : me.user.avatarVersion
                }
                size="small"
              />
            </Link>
          </div>
        </header>
        {auth.config?.authMode === 'demo' && (
          <div className="demo-bar">
            <span>
              <strong>Local demo</strong>
              <span className="demo-detail">Fictional accounts · saved on this computer</span>
            </span>
            <label className="demo-role-label">
              <span>Explore as</span>
              <select
                aria-label="Switch demo role"
                value={
                  me.user.role === 'master'
                    ? 'master'
                    : me.user.id === '00000000-0000-4000-8000-000000000002'
                      ? 'admin'
                      : 'student'
                }
                disabled={switching || auth.offline}
                onChange={async (e) => {
                  const persona = e.target.value as Persona;
                  setSwitching(true);
                  try {
                    await auth.demoLogin(persona);
                    navigate('/');
                  } catch (e) {
                    toast(errorMessage(e));
                  } finally {
                    setSwitching(false);
                  }
                }}
              >
                <option value="student">Student</option>
                <option value="admin">Class Admin</option>
                <option value="master">Master Admin</option>
              </select>
            </label>
          </div>
        )}
        {auth.offline && (
          <div className="offline-banner" role="status">
            <WifiOff size={18} />
            <span>
              Offline · showing saved content
              {auth.lastSyncedAt
                ? ` from ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Karachi' }).format(new Date(auth.lastSyncedAt))}`
                : ''}
              . Changes need a connection.
            </span>
            <Link to="/offline">
              Saved on device
              <ArrowUpRight size={15} />
            </Link>
          </div>
        )}
        <main id="main-content" className="page-content">
          {site.settings?.maintenance.enabled && (
            <div className="maintenance-banner" role="status">
              <Wrench size={21} />
              <div>
                <strong>
                  Read-only maintenance
                  {me.user.role === 'master' ? ' · Owner controls remain available' : ''}
                </strong>
                <p>{site.settings.maintenance.message}</p>
              </div>
            </div>
          )}
          {site.error && <ErrorNotice message={site.error} retry={site.reload} />}
          <InstallBanner />
          <Routes>
            <Route path="/" element={owner ? <Navigate to="/admin" replace /> : <Dashboard />} />
            <Route
              path="/classes"
              element={owner ? <Navigate to="/admin" replace /> : <ClassesPage />}
            />
            <Route
              path="/classes/:classId"
              element={
                owner ? (
                  <OwnerClassAlias />
                ) : (
                  <ClassPage key={`${location.pathname}:${me.user.id}`} />
                )
              }
            />
            <Route
              path="/timetable"
              element={owner ? <Navigate to="/admin" replace /> : <PlanningPage />}
            />
            <Route
              path="/deadlines"
              element={owner ? <Navigate to="/admin" replace /> : <PlanningPage view="deadlines" />}
            />
            <Route
              path="/requests"
              element={owner ? <Navigate to="/admin" replace /> : <RequestsPage />}
            />
            <Route path="/account" element={<ProfilePage />} />
            <Route path="/subjects/:subjectId" element={<SubjectPage key={location.pathname} />} />
            <Route
              path="/announcements"
              element={
                owner ? <Navigate to="/admin?tab=announcements" replace /> : <AnnouncementsPage />
              }
            />
            <Route
              path="/announcements/:id"
              element={
                owner ? <OwnerAnnouncementAlias /> : <AnnouncementPage key={location.pathname} />
              }
            />
            <Route
              path="/notifications"
              element={
                owner ? <Navigate to="/admin?tab=announcements" replace /> : <NotificationsPage />
              }
            />
            <Route
              path="/saved"
              element={owner ? <Navigate to="/admin" replace /> : <SavedPage />}
            />
            <Route
              path="/search"
              element={owner ? <Navigate to="/admin" replace /> : <SearchPage />}
            />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/developer" element={<DeveloperPage />} />
            <Route
              path="/offline"
              element={owner ? <Navigate to="/admin" replace /> : <OfflinePage />}
            />
            <Route path="/more" element={<MorePage />} />
            <Route path="/admin" element={owner ? <AdminPage /> : <Navigate to="/" replace />} />
            <Route
              path="/admin/classes/:classId"
              element={
                owner ? (
                  <ClassPage key={`${location.pathname}:${me.user.id}`} ownerWorkspace />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/admin/classes/:classId/timetable"
              element={owner ? <PlanningPage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/admin/classes/:classId/deadlines"
              element={owner ? <PlanningPage view="deadlines" /> : <Navigate to="/" replace />}
            />
            <Route
              path="/admin/classes/:classId/subjects/:subjectId"
              element={
                owner ? <SubjectPage key={location.pathname} /> : <Navigate to="/" replace />
              }
            />
            <Route
              path="/admin/announcements/:id"
              element={
                owner ? <AnnouncementPage key={location.pathname} /> : <Navigate to="/" replace />
              }
            />
            <Route path="/tutor" element={<Navigate to="/developer" replace />} />
            <Route
              path="*"
              element={
                <EmptyState
                  title="This page isn’t here."
                  action={
                    <Link className="button button-primary" to={homePath}>
                      {owner ? 'Back to owner dashboard' : 'Back to Home'}
                    </Link>
                  }
                >
                  Check the address or return to your campus home.
                </EmptyState>
              }
            />
          </Routes>
        </main>
        <footer className="workspace-footer">
          <span>
            <strong>ZabSync</strong> · Built for Students. Designed for Success
          </span>
          <Link to="/developer">
            Meet the Developer
            <ArrowUpRight size={13} />
          </Link>
        </footer>
      </div>
      <nav className="mobile-nav mobile-nav-four" aria-label="Mobile navigation">
        {mobile.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <item.icon size={21} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
function MorePage() {
  const auth = useAuth();
  const site = useSite();
  const owner = isMaster(auth.me);
  const items = [
    ...(owner
      ? [
          {
            to: '/admin',
            title: 'Owner dashboard',
            text: 'Semesters, sections, students and application controls',
            icon: ShieldCheck,
          },
        ]
      : [
          {
            to: '/classes',
            title: 'My classes',
            text: 'Your section and subject spaces',
            icon: BookOpen,
          },
          ...(site.settings?.features.deadlines === false
            ? []
            : [
                {
                  to: '/deadlines',
                  title: 'Deadlines',
                  text: 'Quizzes, assignments, and events',
                  icon: CheckSquare2,
                },
              ]),
          {
            to: '/saved',
            title: 'Saved items',
            text: 'Bookmarked notices and resources',
            icon: Bookmark,
          },
          {
            to: '/offline',
            title: 'Offline access',
            text: 'Your timetable and files on this device',
            icon: WifiOff,
          },
          {
            to: '/account',
            title: 'My profile',
            text: 'Your name, username, and photo',
            icon: UserRound,
          },
          {
            to: '/requests',
            title: 'Join requests',
            text: 'Class membership status',
            icon: ClipboardList,
          },
          { to: '/search', title: 'Search', text: 'Find a file or announcement', icon: Search },
        ]),
    {
      to: '/developer',
      title: 'Meet the Developer',
      text: 'Introduction, updates, portfolio and other apps',
      icon: Code2,
    },
    ...(owner
      ? [
          {
            to: '/account',
            title: 'My profile',
            text: 'Your name, username and photo',
            icon: UserRound,
          },
        ]
      : []),
    {
      to: '/install',
      title: 'Get the App',
      text: 'Home-screen installation and about ZabSync',
      icon: Smartphone,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR ZABSYNC</span>
          <h1>A little more, all in one place.</h1>
          <p>Useful shortcuts, your profile, and help with the app.</p>
        </div>
      </div>
      <div className="more-grid">
        {items.map((item) => (
          <Link className="more-card" key={item.to} to={item.to}>
            <span>
              <item.icon size={25} />
            </span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </div>
            <ArrowUpRight size={20} />
          </Link>
        ))}
      </div>
      <button className="button button-secondary mobile-signout" onClick={() => void auth.logout()}>
        <LogOut size={17} />
        Sign out
      </button>
    </>
  );
}

function OwnerClassAlias() {
  const { classId = '' } = useParams();
  const location = useLocation();
  return (
    <Navigate to={`/admin/classes/${encodeURIComponent(classId)}${location.search}`} replace />
  );
}
function OwnerAnnouncementAlias() {
  const { id = '' } = useParams();
  return <Navigate to={`/admin/announcements/${encodeURIComponent(id)}`} replace />;
}
