import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
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
import { AccountPage, AdminPage, ClassPage, ClassesPage, Dashboard, RequestsPage } from './pages';
import type { Persona } from './types';

export default function App() {
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
  return <AppShell />;
}

function AppShell() {
  const auth = useAuth();
  const me = auth.me!;
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [online, setOnline] = useState(navigator.onLine);
  const [switching, setSwitching] = useState(false);
  const nav = [
    { to: '/', label: 'Overview', mobile: 'Home', icon: Home },
    { to: '/classes', label: 'My classes', mobile: 'Classes', icon: LayoutGrid },
    { to: '/requests', label: 'My requests', mobile: 'Requests', icon: ClipboardList },
    { to: '/account', label: 'My account', mobile: 'Account', icon: UserRound },
  ];
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
        <Link className="app-brand" to="/" aria-label="CampusDesk home">
          <span className="brand-symbol brand-symbol-small">
            <GraduationCap size={25} />
          </span>
          <span>
            <strong>{auth.config?.appName ?? 'CampusDesk'}</strong>
            <small>SZABIST ISLAMABAD</small>
          </span>
        </Link>
        <div className="nav-section-label">YOUR WORKSPACE</div>
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
            <Avatar name={me.user.displayName} size="small" />
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
            <GraduationCap size={25} />
            <strong>CampusDesk</strong>
          </Link>
          <span className="campus-location">
            <span className="green-dot" /> Islamabad campus
          </span>
          <div className="topbar-right">
            <a
              className="topbar-university"
              href={auth.config?.universityUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              University website <ExternalLink size={14} />
            </a>
            <Link to="/account" aria-label="Open your account">
              <Avatar name={me.user.displayName} size="small" />
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
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/classes" element={<ClassesPage />} />
            <Route
              path="/classes/:classId"
              element={<ClassPage key={`${location.pathname}:${me.user.id}`} />}
            />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/account" element={<AccountPage />} />
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
          <span>CampusDesk · Made for your class</span>
          <span>SZABIST Islamabad</span>
        </footer>
      </div>
      <nav
        className={`mobile-nav ${me.user.role === 'master' ? 'mobile-nav-five' : ''}`}
        aria-label="Mobile navigation"
      >
        {nav.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            <item.icon size={21} />
            <span>{item.mobile}</span>
          </NavLink>
        ))}
        {me.user.role === 'master' && (
          <NavLink to="/admin">
            <ShieldCheck size={21} />
            <span>Admin</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}
