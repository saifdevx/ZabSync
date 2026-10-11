import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  GraduationCap,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import { ErrorNotice } from './components';
import type { Persona } from './types';

const personas: { id: Persona; title: string; subtitle: string; icon: typeof Users }[] = [
  {
    id: 'student',
    title: 'Student',
    subtitle: 'Join a class and meet your community',
    icon: GraduationCap,
  },
  {
    id: 'cr',
    title: 'Class representative',
    subtitle: 'Manage your class and approve members',
    icon: Users,
  },
  {
    id: 'gr',
    title: 'Group representative',
    subtitle: 'Help your CR look after the class',
    icon: Layers3,
  },
  {
    id: 'master',
    title: 'Master Admin',
    subtitle: 'Approve class spaces and appoint reps',
    icon: ShieldCheck,
  },
];

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetCooldown, setResetCooldown] = useState(0);
  const isDemo = auth.config?.authMode === 'demo';
  useEffect(() => {
    if (!resetCooldown) return;
    const timer = setTimeout(() => setResetCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setError('');
    setNotice('');
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy('form');
    try {
      if (mode === 'register') await auth.register(name, email, password);
      else if (mode === 'reset') {
        await auth.resetPassword(email);
        setNotice(
          'If an account exists for this email, a password reset link will arrive in its inbox. Check your spam folder too.',
        );
        setResetCooldown(60);
      } else await auth.login(email, password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="auth-layout">
      <section className="auth-story" aria-label="About XVIA">
        <a
          className="university-logo-wrap"
          href={auth.config?.universityUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="/branding/szabist-horizontal.png"
            alt="SZABIST University Islamabad Campus"
            className="university-logo"
          />
        </a>
        <div className="auth-story-content">
          <div className="brand-symbol">
            <GraduationCap size={32} />
          </div>
          <span className="eyebrow">WELCOME TO XVIA</span>
          <h1>
            Your class.
            <br />
            Your people.
            <br />
            <span>One place.</span>
          </h1>
          <p>
            A little less searching.
            <br />A lot more staying connected.
          </p>
          <div className="story-card">
            <div className="story-card-icon">
              <BookOpen size={25} />
            </div>
            <div>
              <strong>Made for your class</strong>
              <span>A dedicated space, shaped by your representatives.</span>
            </div>
            <Check className="story-check" size={21} />
          </div>
          <div className="story-pills">
            <span>
              <ShieldCheck size={15} />
              University email access
            </span>
            <span>
              <Users size={15} />
              Your class community
            </span>
          </div>
        </div>
        <p className="auth-story-footer">An independent student project for SZABIST Islamabad.</p>
      </section>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <img src="/branding/szabist-horizontal.png" alt="SZABIST University Islamabad Campus" />
        </div>
        <div className="auth-card">
          <span className="auth-kicker">
            <span className="green-dot" /> {isDemo ? 'LOCAL DEMO' : 'YOUR CAMPUS, CONNECTED'}
          </span>
          <h2>
            {isDemo
              ? 'Take a look around.'
              : mode === 'register'
                ? 'Find your class.'
                : mode === 'reset'
                  ? 'Let’s get you back in.'
                  : 'Welcome back.'}
          </h2>
          <p className="auth-intro">
            {isDemo
              ? 'Choose a role to explore a working class space. These are fictional accounts with local practice data.'
              : mode === 'register'
                ? 'Create your XVIA account with your university email.'
                : mode === 'reset'
                  ? 'We’ll send a reset link to your university email.'
                  : 'Sign in to your university community.'}
          </p>
          {isDemo ? (
            <div className="demo-personas">
              {personas.map((persona) => (
                <button
                  key={persona.id}
                  disabled={!!busy}
                  className="persona-button"
                  onClick={async () => {
                    setBusy(persona.id);
                    setError('');
                    try {
                      await auth.demoLogin(persona.id);
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  <span className={`persona-icon persona-${persona.id}`}>
                    <persona.icon size={21} />
                  </span>
                  <span>
                    <strong>{persona.title}</strong>
                    <small>{persona.subtitle}</small>
                  </span>
                  {busy === persona.id ? (
                    <LoaderCircle className="spin" size={20} />
                  ) : (
                    <ChevronRight size={19} />
                  )}
                </button>
              ))}
              <ErrorNotice message={error} />
              <p className="auth-help">
                <LockKeyhole size={15} />
                Real university login is available after Firebase setup.
              </p>
            </div>
          ) : (
            <>
              {mode !== 'reset' && (
                <div className="auth-tabs" role="group" aria-label="Account access">
                  <button
                    className={mode === 'login' ? 'selected' : ''}
                    onClick={() => changeMode('login')}
                  >
                    Sign in
                  </button>
                  <button
                    className={mode === 'register' ? 'selected' : ''}
                    onClick={() => changeMode('register')}
                  >
                    Create account
                  </button>
                </div>
              )}
              <form className="form-stack" onSubmit={submit}>
                {mode === 'register' && (
                  <label>
                    Your name
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="How your class knows you"
                    />
                  </label>
                )}
                <label>
                  University email
                  <div className="input-with-icon">
                    <Mail size={18} />
                    <input
                      required
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@szabist-isb.pk"
                    />
                  </div>
                  <small>
                    Only @{auth.config?.allowedEmailDomain} addresses can access the app.
                  </small>
                </label>
                {mode !== 'reset' && (
                  <label>
                    {mode === 'register' ? 'Create an app password' : 'App password'}
                    <div className="password-input">
                      <input
                        required
                        type={showPassword ? 'text' : 'password'}
                        minLength={mode === 'register' ? 12 : 1}
                        maxLength={128}
                        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {mode === 'register' && (
                      <small>At least 12 characters. Use a new password for this app.</small>
                    )}
                  </label>
                )}
                <ErrorNotice message={error} />
                {notice && (
                  <div className="success-notice" role="status">
                    <Check size={18} />
                    <p>{notice}</p>
                  </div>
                )}
                {mode === 'login' && (
                  <button
                    type="button"
                    className="text-button forgot-password"
                    onClick={() => changeMode('reset')}
                  >
                    Forgot password?
                  </button>
                )}
                <button
                  className="button button-primary button-full"
                  disabled={!!busy || (mode === 'reset' && resetCooldown > 0)}
                >
                  {busy ? <LoaderCircle size={18} className="spin" /> : null}
                  {mode === 'register'
                    ? 'Create account'
                    : mode === 'reset'
                      ? resetCooldown
                        ? `Send again in ${resetCooldown}s`
                        : 'Send reset link'
                      : 'Sign in'}
                  {!busy && <ArrowRight size={18} />}
                </button>
                {mode === 'reset' && (
                  <button type="button" className="text-button" onClick={() => changeMode('login')}>
                    <ArrowLeft size={16} />
                    Back to sign in
                  </button>
                )}
              </form>
              <p className="auth-help">
                <ShieldCheck size={17} />
                Verified email first. Class approval next.
              </p>
            </>
          )}
        </div>
        <footer className="auth-footer">
          <span>
            XVIA <Sparkles size={12} />
          </span>
          <a href={auth.config?.universityUrl} target="_blank" rel="noopener noreferrer">
            University website <ExternalLink size={13} />
          </a>
        </footer>
      </main>
    </div>
  );
}

export function VerificationScreen() {
  const auth = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  return (
    <main className="center-screen">
      <div className="verification-card">
        <div className="verification-icon">
          <Mail size={30} />
        </div>
        <span className="eyebrow">ONE MORE STEP</span>
        <h1>Check your inbox.</h1>
        <p>
          Verify <strong>{auth.email}</strong> using the link in your email. Then come back here to
          continue.
        </p>
        <p className="muted">
          If you just signed in to an unverified account, use “Send verification email” below.
        </p>
        <ErrorNotice message={error} />
        {notice && (
          <p className="inline-notice" role="status">
            {notice}
          </p>
        )}
        <button
          className="button button-primary button-full"
          disabled={!!busy}
          onClick={async () => {
            setBusy('check');
            setError('');
            setNotice('');
            try {
              if (!(await auth.refreshVerification()))
                setNotice(
                  'Your email is not verified yet. Open the verification link, then try again.',
                );
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy('');
            }
          }}
        >
          {busy === 'check' ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}I’ve
          verified my email
        </button>
        <button
          className="button button-secondary button-full"
          disabled={!!busy || cooldown > 0}
          onClick={async () => {
            setBusy('resend');
            setError('');
            try {
              await auth.resendVerification();
              setNotice('Verification email sent. Check your inbox and spam folder.');
              setCooldown(60);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy('');
            }
          }}
        >
          {cooldown ? `Send again in ${cooldown}s` : 'Send verification email'}
        </button>
        <button className="text-button" onClick={() => void auth.logout()}>
          Use another account
        </button>
      </div>
    </main>
  );
}
