import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
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
import { ProfilePage, TutorPage } from './OperationsPages';
import { InstallBanner, InstallPage, InstallProvider } from './InstallPage';
import { SiteProvider, useSite } from './site';
import { useApi } from './hooks';
import type { NotificationsData } from './academic-types';
import type { Persona } from './types';

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
  const [online, setOnline] = useState(navigator.onLine);
  const [switching, setSwitching] = useState(false);
  const nav = [
    { to: '/', label: 'Overview', mobile: 'Home', icon: Home },
    { to: '/classes', label: 'My classes', mobile: 'Classes', icon: LayoutGrid },
    ...(site.settings?.features.announcements === false
      ? []
      : [{ to: '/announcements', label: 'Noticeboard', mobile: 'Updates', icon: Bell }]),
    { to: '/saved', label: 'Saved for later', mobile: 'Saved', icon: Bookmark },
    { to: '/search', label: 'Search', mobile: 'Search', icon: Search },
    { to: '/requests', label: 'My requests', mobile: 'Requests', icon: ClipboardList },
    ...(site.settings?.features.tutor === false
      ? []
      : [{ to: '/tutor', label: 'Tutor', mobile: 'Tutor', icon: Users }]),
    { to: '/install', label: 'Get the app', mobile: 'Install', icon: Smartphone },
  ];
  const mobileNav = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/classes', label: 'Classes', icon: LayoutGrid },
    site.settings?.features.announcements === false
      ? { to: '/search', label: 'Search', icon: Search }
      : { to: '/announcements', label: 'Updates', icon: Bell },
    { to: '/saved', label: 'Saved', icon: Bookmark },
    { to: '/more', label: 'More', icon: Menu },
  ];
  const notifications = useApi<NotificationsData>(
    site.settings?.features.announcements === false ? null : '/notifications?limit=1',
  );
  useEffect(() => {
    const refresh = () => notifications.reload();
    window.addEventListener('xvia:content-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('xvia:content-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [notifications.reload]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
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
        <Link className="app-brand" to="/" aria-label="XVIA home">
          <img className="brand-logo" src="/icons/xvia-icon.png" alt="" width="44" height="44" />
          <span>
            <strong>{auth.config?.appName ?? 'XVIA'}</strong>
            <small>NODE COMPASS TASK</small>
          </span>
        </Link>
        <div className="nav-section-label">YOUR CAMPUS</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              <item.icon size={20} />
              <span>{item.label}</span>
              {item.to === '/classes' && <span className="nav-count">{me.classes.length}</span>}
            </NavLink>
          ))}
          {me.user.role === 'master' && (
            <>
              <div className="nav-section-label admin-label">ADMINISTRATION</div>
              <NavLink to="/admin">
                <ShieldCheck size={20} />
                <span>Master Admin</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-campus">
          <img src="/branding/szabist-emblem.png" alt="SZABIST" />
          <span>
            Connected by campus.
            <br />
            Organized by you.
          </span>
          <a href={auth.config?.universityUrl} target="_blank" rel="noopener noreferrer">
            University website <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="sidebar-profile">
          <Link to="/account">
            <Avatar
              name={me.user.displayName}
              userId={me.user.id}
              avatarVersion={me.user.avatarVersion}
              size="small"
            />
            <span>
              <strong>{me.user.displayName}</strong>
              <small>{me.user.role === 'master' ? 'Master Admin' : 'University member'}</small>
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
          <Link className="mobile-brand" to="/">
            <img src="/icons/xvia-icon.png" alt="" width="30" height="30" />
            <strong>XVIA</strong>
          </Link>
          <span className="campus-location">
            <span className="green-dot" /> Islamabad campus
          </span>
          <div className="topbar-right">
            <Link
              className="icon-button topbar-search"
              to="/search"
              aria-label="Search your campus space"
            >
              <Search size={20} />
            </Link>
            {site.settings?.features.announcements !== false && (
              <Link
                className="icon-button notification-button"
                to="/notifications"
                aria-label={`Notifications${notifications.data?.unreadCount ? `, ${notifications.data.unreadCount} unread` : ''}`}
              >
                <Bell size={20} />
                {!!notifications.data?.unreadCount && (
                  <span className="unread-count">
                    {notifications.data.unreadCount > 99 ? '99+' : notifications.data.unreadCount}
                  </span>
                )}
              </Link>
            )}
            {me.user.role === 'master' && (
              <Link
                className="icon-button topbar-admin"
                to="/admin"
                aria-label="Master Admin dashboard"
              >
                <ShieldCheck size={21} />
              </Link>
            )}
            <a
              className="topbar-university"
              href={auth.config?.universityUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              University website <ExternalLink size={14} />
            </a>
            <Link to="/account" aria-label="Open your account">
              <Avatar
                name={me.user.displayName}
                userId={me.user.id}
                avatarVersion={me.user.avatarVersion}
                size="small"
              />
            </Link>
          </div>
        </header>
        {auth.config?.authMode === 'demo' && (
          <div className="demo-bar">
            <span>
              <strong>Local demo</strong>
              <span className="demo-detail">
                Fictional accounts · Your changes are saved locally
              </span>
            </span>
            <label className="demo-role-label">
              <span>Explore as</span>
              <select
                aria-label="Switch demo role"
                value={
                  me.user.role === 'master'
                    ? 'master'
                    : me.user.email.includes('.gr@')
                      ? 'gr'
                      : me.user.email.includes('.cr@')
                        ? 'cr'
                        : 'student'
                }
                disabled={switching}
                onChange={async (e) => {
                  const role = e.target.value as Persona;
                  setSwitching(true);
                  try {
                    await auth.demoLogin(role);
                    navigate('/');
                  } catch (error) {
                    toast(errorMessage(error));
                  } finally {
                    setSwitching(false);
                  }
                }}
              >
                <option value="student">Student</option>
                <option value="cr">CR</option>
                <option value="gr">GR</option>
                <option value="master">Master Admin</option>
              </select>
            </label>
          </div>
        )}
        {!online && (
          <div className="offline-banner" role="status">
            <WifiOff size={18} />
            You’re offline. Reconnect to load class data or make changes.
          </div>
        )}
        <main id="main-content" className="page-content">
          {site.settings?.maintenance.enabled && (
            <div className="maintenance-banner" role="status">
              <Wrench size={21} />
              <div>
                <strong>
                  {me.user.role === 'master'
                    ? 'Maintenance is on · Owner controls remain available'
                    : 'Read-only maintenance'}
                </strong>
                <p>{site.settings.maintenance.message}</p>
              </div>
              {me.user.role === 'master' && (
                <Link className="text-button" to="/admin">
                  Manage
                  <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
          )}
          {site.error && <ErrorNotice message={site.error} retry={site.reload} />}
          <InstallBanner />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/classes" element={<ClassesPage />} />
            <Route
              path="/classes/:classId"
              element={<ClassPage key={`${location.pathname}:${me.user.id}`} />}
            />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/account" element={<ProfilePage />} />
            <Route path="/subjects/:subjectId" element={<SubjectPage key={location.pathname} />} />
            <Route path="/announcements" element={<AnnouncementsPage />} />
            <Route
              path="/announcements/:id"
              element={<AnnouncementPage key={location.pathname} />}
            />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/tutor" element={<TutorPage />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route
              path="/admin"
              element={me.user.role === 'master' ? <AdminPage /> : <Navigate to="/" replace />}
            />
            <Route
              path="*"
              element={
                <EmptyState
                  title="This page isn’t here."
                  action={
                    <Link className="button button-primary" to="/">
                      Go to overview
                    </Link>
                  }
                >
                  It may have moved, or the address may be incomplete.
                </EmptyState>
              }
            />
          </Routes>
        </main>
        <footer className="workspace-footer">
          <span>
            XVIA <span className="footer-divider">/</span> Node Compass Task
          </span>
          <span>SZABIST Islamabad</span>
        </footer>
      </div>
      <nav className="mobile-nav mobile-nav-five" aria-label="Mobile navigation">
        {mobileNav.map((item) => (
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
  const items = [
    {
      to: '/account',
      title: 'My profile',
      text: 'Your name, username, and photo',
      icon: UserRound,
    },
    {
      to: '/requests',
      title: 'My requests',
      text: 'Class creation and membership status',
      icon: ClipboardList,
    },
    ...(site.settings?.features.tutor === false
      ? []
      : [{ to: '/tutor', title: 'Tutor', text: 'Meet your tutor and find support', icon: Users }]),
    {
      to: '/install',
      title: 'Get XVIA',
      text: 'Install on your phone or share the web link',
      icon: Smartphone,
    },
    {
      to: '/search',
      title: 'Search',
      text: 'Find a lecture file or an announcement',
      icon: Search,
    },
    ...(auth.me?.user.role === 'master'
      ? [
          {
            to: '/admin',
            title: 'Master Admin',
            text: 'Your app controls in one dashboard',
            icon: ShieldCheck,
          },
        ]
      : []),
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">XVIA / YOUR CAMPUS</span>
          <h1>Make it yours.</h1>
          <p>Your profile, useful shortcuts, and a little help.</p>
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
    </>
  );
}
