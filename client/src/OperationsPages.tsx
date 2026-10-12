import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Code2,
  ChevronDown,
  Plus,
  Trash2,
  BookOpen,
  Camera,
  Check,
  ExternalLink,
  GraduationCap,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { errorMessage, useAuth } from './auth';
import {
  ActionHeading,
  Avatar,
  EmptyState,
  ErrorNotice,
  Modal,
  RoleBadge,
  Spinner,
  formatDate,
  useToast,
} from './components';
import type { AppUser } from './types';
import { useSite } from './site';
import { isMaster } from './permissions';

export interface FeatureSettings {
  subjects: boolean;
  resources: boolean;
  announcements: boolean;
  developer: boolean;
  timetable: boolean;
  deadlines: boolean;
  profilePhotos: boolean;
}
interface SiteSettings {
  version: number;
  features: FeatureSettings;
  maintenance: { enabled: boolean; message: string };
  updatedAt: string;
}
interface DeveloperProfile {
  version: number;
  published: boolean;
  title: string;
  name: string;
  bio: string;
  portfolioUrl: string;
  updatesText: string;
  apps: { name: string; description: string; url: string }[];
  updatedAt: string;
}

function useOperationResource<T>(path: string | null) {
  const { request, me, offline, lastSyncedAt } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    setLoading(!!path);
    if (path)
      request<T>(path)
        .then((value) => {
          if (active) setData(value);
        })
        .catch((error) => {
          if (active) setError(errorMessage(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [path, request, me?.user.id, offline, lastSyncedAt, revision]);
  return { data, error, loading, reload };
}

export function ProfilePage() {
  const auth = useAuth();
  const user = auth.me!.user;
  // Account-switching mounts a fresh editor, so one student's draft cannot follow another login.
  return <ProfileEditor key={user.id} user={user} />;
}

function ProfileEditor({ user }: { user: AppUser }) {
  const auth = useAuth();
  const toast = useToast();
  const site = useSite();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username ?? '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [removePhoto, setRemovePhoto] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nameChanged =
    displayName.trim() !== user.displayName ||
    username.trim().toLowerCase().replace(/^@/, '') !== (user.username ?? '');
  const readOnly = auth.offline || (site.settings?.maintenance.enabled && user.role !== 'master');
  const photoEnabled = site.settings?.features.profilePhotos !== false;

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const chooseFile = (selected: File | undefined) => {
    setError('');
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      setError('Choose a JPEG, PNG, or WebP photo.');
      setFile(null);
      if (input.current) input.current.value = '';
      return;
    }
    if (selected.size > 2 * 1024 * 1024) {
      setError('Choose a photo smaller than 2 MiB.');
      setFile(null);
      if (input.current) input.current.value = '';
      return;
    }
    setFile(selected);
  };

  const upload = async () => {
    if (!file) return;
    setBusy('photo');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await auth.request('/me/avatar', { method: 'POST', body: form });
      await auth.refreshMe();
      setFile(null);
      if (input.current) input.current.value = '';
      toast('Your profile photo has been updated.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <ActionHeading
        eyebrow="Your space"
        title="Make yourself at home"
        subtitle="Choose how your name and photo appear to your classmates."
      />
      <div className="ops-profile-grid">
        <aside className="panel ops-profile-card">
          <div className="ops-profile-accent" aria-hidden="true" />
          <div className="ops-profile-avatar">
            {preview ? (
              <img src={preview} alt="Selected profile photo preview" />
            ) : (
              <Avatar
                name={user.displayName}
                userId={user.id}
                avatarVersion={photoEnabled ? user.avatarVersion : null}
                size="large"
              />
            )}
          </div>
          <h2>{user.displayName}</h2>
          {user.username && <p className="ops-handle">@{user.username}</p>}
          <RoleBadge role={user.role} />
          <p className="ops-profile-caption">Your name, your class community.</p>
          {photoEnabled ? (
            <div className="ops-photo-actions">
              <input
                ref={input}
                className="ops-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Choose a profile photo"
                disabled={!!busy || !!readOnly}
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              <button
                className="button button-secondary button-full"
                disabled={!!busy || !!readOnly}
                onClick={() => input.current?.click()}
              >
                <ImagePlus size={17} />
                {user.avatarVersion ? 'Choose a new photo' : 'Choose a photo'}
              </button>
              {file && (
                <>
                  <p className="ops-file-name">{file.name}</p>
                  <button
                    className="button button-primary button-full"
                    disabled={!!busy || !!readOnly}
                    onClick={() => void upload()}
                  >
                    {busy === 'photo' ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Camera size={17} />
                    )}
                    Save photo
                  </button>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => {
                      setFile(null);
                      if (input.current) input.current.value = '';
                    }}
                  >
                    Cancel selection
                  </button>
                </>
              )}
              {user.avatarVersion && !file && (
                <button
                  className="text-button ops-danger-text"
                  disabled={!!busy || !!readOnly}
                  onClick={() => setRemovePhoto(true)}
                >
                  <Trash2 size={15} />
                  Remove photo
                </button>
              )}
              <p className="ops-help">
                JPEG, PNG, or WebP · up to 2 MiB
                <br />
                Visible to you, your classmates, and the Master Admin.
              </p>
            </div>
          ) : (
            <p className="ops-help">
              Profile photos are currently turned off by the administrator.
            </p>
          )}
        </aside>
        <div className="ops-stack">
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Profile details</h2>
                <p>A familiar name makes it easier for classmates to find you.</p>
              </div>
              <UserRound size={22} className="ops-teal" />
            </div>
            {readOnly && (
              <div className="info-box">
                {auth.offline
                  ? 'Your saved profile is read-only. Reconnect to change your name, username or photo.'
                  : 'Profile changes are paused during maintenance. You can still view your account.'}
              </div>
            )}
            <form
              className="form-stack"
              onSubmit={async (event: FormEvent) => {
                event.preventDefault();
                if (readOnly) return;
                setBusy('details');
                setError('');
                try {
                  await auth.request('/me', {
                    method: 'PATCH',
                    body: JSON.stringify({
                      displayName: displayName.trim(),
                      username: username.trim() || null,
                    }),
                  });
                  await auth.refreshMe();
                  setUsername(username.trim().toLowerCase().replace(/^@/, ''));
                  toast('Profile details saved.');
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setBusy('');
                }
              }}
            >
              <label>
                Display name
                <input
                  value={displayName}
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  disabled={!!busy || !!readOnly}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                Username <span className="optional">Optional</span>
                <div className="ops-input-prefix">
                  <span aria-hidden="true">@</span>
                  <input
                    value={username}
                    minLength={username ? 3 : undefined}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]{3,24}"
                    aria-describedby="username-help"
                    autoComplete="nickname"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="your_name"
                    disabled={!!busy || !!readOnly}
                    onChange={(event) => setUsername(event.target.value.replace(/^@/, ''))}
                  />
                </div>
                <span id="username-help" className="ops-help">
                  3–24 letters, numbers, or underscores. Your username must be unique. Clear it to
                  remove it.
                </span>
              </label>
              <ErrorNotice message={error} />
              <div className="ops-form-footer">
                <span className="ops-help">
                  {nameChanged ? 'You have unsaved changes.' : 'Your profile is up to date.'}
                </span>
                <button
                  className="button button-primary"
                  disabled={!!busy || !nameChanged || !!readOnly}
                >
                  {busy === 'details' ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Save size={17} />
                  )}
                  Save details
                </button>
              </div>
            </form>
          </section>
          <section className="panel ops-account-security">
            <div className="section-heading">
              <div>
                <h2>Your university identity</h2>
                <p>Your login and account reference stay separate from your public profile.</p>
              </div>
              <LockKeyhole size={22} className="ops-violet" />
            </div>
            <dl className="detail-list">
              <div>
                <dt>University email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Account ID</dt>
                <dd className="ops-mono">{user.id}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>
                  {auth.config?.authMode === 'demo'
                    ? 'Local demo account'
                    : 'Verified university email'}
                </dd>
              </div>
            </dl>
            <div className="ops-form-footer">
              <Link to="/install" className="text-button">
                Get ZabSync on your home screen <ArrowUpRight size={16} />
              </Link>
              <button
                className="button button-secondary"
                disabled={!!busy}
                onClick={() => {
                  void auth.logout().catch((error) => setError(errorMessage(error)));
                }}
              >
                <LogOut size={17} />
                Sign out
              </button>
            </div>
          </section>
        </div>
      </div>
      {removePhoto && (
        <Modal
          title="Remove your profile photo?"
          description="Your initials will appear in its place. You can add a new photo later."
          onClose={() => {
            if (!busy) setRemovePhoto(false);
          }}
        >
          <ErrorNotice message={error} />
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={!!busy}
              onClick={() => setRemovePhoto(false)}
            >
              Keep photo
            </button>
            <button
              className="button button-danger"
              disabled={!!busy}
              onClick={async () => {
                setBusy('remove');
                setError('');
                try {
                  await auth.request('/me/avatar', { method: 'DELETE' });
                  await auth.refreshMe();
                  setRemovePhoto(false);
                  toast('Profile photo removed.');
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setBusy('');
                }
              }}
            >
              Remove photo
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function safeHttps(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function DeveloperContent({ profile }: { profile: DeveloperProfile }) {
  return (
    <div className="developer-content">
      <div className="developer-heading">
        <span className="developer-monogram">{profile.name.trim().slice(0, 1) || 'Z'}</span>
        <div>
          <h3>{profile.name}</h3>
          <p>{profile.title}</p>
        </div>
        {safeHttps(profile.portfolioUrl) && (
          <a
            className="button button-secondary button-small"
            href={safeHttps(profile.portfolioUrl)!}
            target="_blank"
            rel="noopener noreferrer"
          >
            Portfolio
            <ArrowUpRight size={16} />
          </a>
        )}
      </div>
      <p className="ops-prose">{profile.bio}</p>
      {profile.updatesText && (
        <div className="developer-update">
          <strong>From the developer</strong>
          <p className="ops-prose">{profile.updatesText}</p>
        </div>
      )}
      {profile.apps.length > 0 && (
        <div className="developer-apps">
          <h4>More things I’m building</h4>
          {profile.apps.map(
            (app, index) =>
              safeHttps(app.url) && (
                <a
                  href={safeHttps(app.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={`${app.name}-${index}`}
                >
                  <span className="developer-app-mark">
                    <Code2 size={19} />
                  </span>
                  <span>
                    <strong>{app.name}</strong>
                    <small>{app.description}</small>
                  </span>
                  <ArrowUpRight size={19} />
                </a>
              ),
          )}
        </div>
      )}
    </div>
  );
}
export function DeveloperSection() {
  return (
    <section className="panel ops-section developer-install-link">
      <Code2 size={25} />
      <div>
        <h2>Meet the Developer</h2>
        <p>Read the introduction, updates and other projects behind ZabSync.</p>
      </div>
      <Link className="button button-secondary" to="/developer">
        Open developer page <ArrowUpRight size={16} />
      </Link>
    </section>
  );
}
export function DeveloperPage() {
  const auth = useAuth();
  const site = useSite();
  const owner = isMaster(auth.me);
  const enabled = site.settings?.features.developer === true;
  const state = useOperationResource<{ developer: DeveloperProfile | null }>(
    enabled && !auth.offline ? '/developer' : null,
  );
  return (
    <>
      <ActionHeading
        eyebrow="BEHIND ZABSYNC"
        title="Meet the Developer"
        subtitle="The person, projects and updates behind your campus app."
      >
        {owner && !auth.offline && (
          <Link className="button button-primary" to="/admin?tab=developer">
            <Code2 size={17} />
            Edit Developer page
          </Link>
        )}
      </ActionHeading>
      {auth.offline ? (
        <EmptyState icon={<Code2 size={28} />} title="Connect to view the Developer page.">
          This introduction is available online. Your prepared classes and timetable remain
          available offline.
        </EmptyState>
      ) : !enabled ? (
        <EmptyState
          icon={<Code2 size={28} />}
          title="The Developer page is temporarily unavailable."
        >
          The owner can make this page available from the application controls.
        </EmptyState>
      ) : state.loading ? (
        <Spinner label="Loading developer introduction…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : state.data?.developer ? (
        <section className="panel developer-profile-page">
          <DeveloperContent profile={state.data.developer} />
          <p className="developer-updated">Updated {formatDate(state.data.developer.updatedAt)}</p>
        </section>
      ) : (
        <EmptyState icon={<Code2 size={28} />} title="An introduction is on its way.">
          {owner
            ? 'Add your details in the Developer editor, preview them, then publish when ready.'
            : 'The developer has not published an introduction yet. Their profile and project links will appear here when available.'}
        </EmptyState>
      )}
    </>
  );
}

const featureLabels: { key: keyof FeatureSettings; title: string; description: string }[] = [
  {
    key: 'subjects',
    title: 'Subjects',
    description: 'Course spaces and their subject-specific files and notices.',
  },
  {
    key: 'resources',
    title: 'Lecture resources',
    description: 'Upload and download files, including announcement attachments.',
  },
  {
    key: 'announcements',
    title: 'Announcements',
    description: 'Subject, class, and university-wide updates.',
  },
  {
    key: 'developer',
    title: 'Meet the Developer',
    description:
      'Make your published introduction, portfolio and other apps available on the Developer page.',
  },
  {
    key: 'timetable',
    title: 'Timetable',
    description: 'Weekly classes, teachers, rooms, and one-time schedule changes.',
  },
  {
    key: 'deadlines',
    title: 'Deadlines',
    description: 'Quizzes, assignments, events, and personal completion.',
  },
  {
    key: 'profilePhotos',
    title: 'Profile photos',
    description: 'Allow students to add and view profile photos.',
  },
];

export function AdminSettingsPanel() {
  const auth = useAuth();
  const allowed = isMaster(auth.me) && !auth.offline;
  const settings = useOperationResource<{ settings: SiteSettings }>(
    allowed ? '/admin/settings' : null,
  );
  if (!allowed)
    return <ErrorNotice message="Only the Master Admin can change application settings." />;
  return (
    <div className="ops-stack">
      <div className="ops-admin-intro">
        <span className="ops-admin-icon">
          <Settings2 size={25} />
        </span>
        <div>
          <h2>Your control room</h2>
          <p>Manage the features students see and read-only maintenance.</p>
        </div>
      </div>
      {settings.loading ? (
        <Spinner label="Loading application settings…" />
      ) : settings.error ? (
        <ErrorNotice message={settings.error} retry={settings.reload} />
      ) : (
        settings.data && (
          <SettingsEditor
            key={`settings-${settings.data.settings.version}`}
            initial={settings.data.settings}
            onReload={settings.reload}
          />
        )
      )}
      <Link className="text-button" to="/admin?tab=developer">
        Edit Developer page <ArrowUpRight size={16} />
      </Link>
      <section className="panel ops-release-note">
        <div>
          <ShieldCheck size={22} />
          <h3>Growing ZabSync</h3>
        </div>
        <p>
          These switches control features already built into the app. New functionality is added to
          the source code, reviewed, then deployed from GitHub. Secrets and service credentials
          belong in your hosting settings.
        </p>
        <Link className="text-button" to="/install">
          Web and phone installation <ArrowUpRight size={16} />
        </Link>
      </section>
    </div>
  );
}

export function AdminDeveloperPanel() {
  const auth = useAuth(),
    site = useSite();
  const allowed = isMaster(auth.me) && !auth.offline;
  const state = useOperationResource<{ developer: DeveloperProfile }>(
    allowed ? '/admin/developer' : null,
  );
  if (!allowed)
    return <ErrorNotice message="Only an online owner account can edit the Developer page." />;
  return (
    <div className="ops-stack">
      <div className="ops-admin-intro">
        <span className="ops-admin-icon">
          <Code2 size={25} />
        </span>
        <div>
          <h2>Your Developer page</h2>
          <p>
            Write your introduction, add other apps, preview the draft, and publish when it is
            ready.
          </p>
        </div>
        <Link className="button button-secondary" to="/developer">
          View public page <ArrowUpRight size={16} />
        </Link>
      </div>
      {site.settings?.features.developer !== true && (
        <p className="inline-notice">
          The Developer feature is currently disabled. You can keep editing your draft; enable it in
          App controls to show the published page.
        </p>
      )}
      {state.loading ? (
        <Spinner label="Loading developer settings…" />
      ) : state.error ? (
        <ErrorNotice message={state.error} retry={state.reload} />
      ) : (
        state.data && (
          <DeveloperEditor
            key={`developer-${state.data.developer.version}`}
            initial={state.data.developer}
            onReload={state.reload}
          />
        )
      )}
    </div>
  );
}

function SettingsEditor({ initial, onReload }: { initial: SiteSettings; onReload: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [features, setFeatures] = useState(initial.features);
  const [maintenance, setMaintenance] = useState(initial.maintenance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmReload, setConfirmReload] = useState(false);
  const changed =
    JSON.stringify({ features, maintenance }) !==
    JSON.stringify({ features: initial.features, maintenance: initial.maintenance });
  return (
    <section className="panel ops-settings-panel">
      <div className="section-heading">
        <div>
          <h2>Application controls</h2>
          <p>Changes apply across all classes when you save.</p>
        </div>
        <button
          className="icon-button"
          type="button"
          disabled={busy}
          aria-label="Refresh application settings"
          onClick={() => {
            if (changed) setConfirmReload(true);
            else onReload();
          }}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await auth.request('/admin/settings', {
              method: 'PATCH',
              body: JSON.stringify({ version: initial.version, features, maintenance }),
            });
            window.dispatchEvent(new CustomEvent('zabsync:settings-updated'));
            toast('Application settings saved.');
            onReload();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="ops-feature-list">
          {featureLabels.map((feature) => (
            <label key={feature.key} className="ops-toggle-row">
              <div>
                <strong>{feature.title}</strong>
                <span>{feature.description}</span>
              </div>
              <span className="ops-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={features[feature.key]}
                  disabled={busy}
                  onChange={(event) =>
                    setFeatures((value) => ({ ...value, [feature.key]: event.target.checked }))
                  }
                  aria-label={feature.title}
                />
                <span aria-hidden="true" />
              </span>
            </label>
          ))}
        </div>
        <p className="ops-help ops-settings-help">
          Turning a feature off hides access to it. Existing content is kept, so you can turn it
          back on later. Turning Subjects off also hides subject-specific content; class-wide
          content follows its own switches. Turning Resources off hides files, while announcement
          text remains available.
        </p>
        <fieldset className="ops-maintenance">
          <legend>
            <Wrench size={17} />
            Maintenance
          </legend>
          <label className="ops-toggle-row">
            <div>
              <strong>Pause changes for students and class admins</strong>
              <span>
                They can still read available content. Master Admin controls remain available.
              </span>
            </div>
            <span className="ops-switch">
              <input
                type="checkbox"
                role="switch"
                checked={maintenance.enabled}
                disabled={busy}
                aria-label="Maintenance mode"
                onChange={(event) =>
                  setMaintenance((value) => ({ ...value, enabled: event.target.checked }))
                }
              />
              <span aria-hidden="true" />
            </span>
          </label>
          <label className="ops-message-label">
            Message to students
            <textarea
              rows={3}
              maxLength={500}
              value={maintenance.message}
              disabled={busy}
              placeholder="We’re making a few improvements. You can read your class content while updates are paused."
              onChange={(event) =>
                setMaintenance((value) => ({ ...value, message: event.target.value }))
              }
            />
          </label>
        </fieldset>
        <ErrorNotice message={error} />
        <div className="ops-form-footer">
          <span className="ops-help">{changed ? 'Unsaved changes' : 'All changes saved'}</span>
          <button className="button button-primary" disabled={busy || !changed}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}Save
            application settings
          </button>
        </div>
      </form>
      {confirmReload && (
        <Modal
          title="Discard unsaved settings?"
          description="Refreshing will load the latest saved settings and replace your edits."
          onClose={() => setConfirmReload(false)}
        >
          <div className="modal-actions">
            <button className="button button-secondary" onClick={() => setConfirmReload(false)}>
              Keep editing
            </button>
            <button className="button button-primary" onClick={onReload}>
              Discard and refresh
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function DeveloperEditor({
  initial,
  onReload,
}: {
  initial: DeveloperProfile;
  onReload: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const changed = JSON.stringify(initial) !== JSON.stringify(draft);
  const field = (key: 'name' | 'title' | 'bio' | 'portfolioUrl' | 'updatesText', value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <section className="panel developer-editor">
      <div className="section-heading">
        <div>
          <h2>Meet the Developer</h2>
          <p>
            Your introduction, portfolio, and other applications. Publish them on the Developer
            page.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh developer settings"
          disabled={busy}
          onClick={() => (changed ? setDiscard(true) : onReload())}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await auth.request('/admin/developer', {
              method: 'PATCH',
              body: JSON.stringify({
                version: initial.version,
                published: draft.published,
                title: draft.title.trim(),
                name: draft.name.trim(),
                bio: draft.bio.trim(),
                portfolioUrl: draft.portfolioUrl.trim(),
                updatesText: draft.updatesText.trim(),
                apps: draft.apps.map((a) => ({
                  name: a.name.trim(),
                  description: a.description.trim(),
                  url: a.url.trim(),
                })),
              }),
            });
            toast(draft.published ? 'Developer details published.' : 'Developer draft saved.');
            onReload();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="ops-form-fields" disabled={busy}>
          <div className="form-two">
            <label>
              Your name
              <input
                maxLength={100}
                value={draft.name}
                required={draft.published}
                onChange={(e) => field('name', e.target.value)}
              />
            </label>
            <label>
              Title
              <input
                maxLength={100}
                value={draft.title}
                required={draft.published}
                onChange={(e) => field('title', e.target.value)}
                placeholder="e.g. Student developer"
              />
            </label>
          </div>
          <label>
            Your introduction
            <textarea
              rows={5}
              maxLength={4000}
              required={draft.published}
              value={draft.bio}
              onChange={(e) => field('bio', e.target.value)}
              placeholder="Tell students about yourself and why you built ZabSync."
            />
          </label>
          <label>
            Portfolio link
            <input
              type="url"
              pattern="https://.*"
              maxLength={1000}
              value={draft.portfolioUrl}
              onChange={(e) => field('portfolioUrl', e.target.value)}
              placeholder="https://your-portfolio.example"
            />
          </label>
          <label>
            Updates from you
            <textarea
              rows={3}
              maxLength={4000}
              value={draft.updatesText}
              onChange={(e) => field('updatesText', e.target.value)}
              placeholder="Share what you’re building next or an update about your apps."
            />
          </label>
          <div className="developer-app-editor">
            <div className="section-heading">
              <h3>Your applications</h3>
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={draft.apps.length >= 12}
                onClick={() =>
                  setDraft((old) => ({
                    ...old,
                    apps: [...old.apps, { name: '', description: '', url: '' }],
                  }))
                }
              >
                <Plus size={16} />
                Add an app
              </button>
            </div>
            {draft.apps.map((app, index) => (
              <fieldset key={index} className="developer-app-form">
                <legend>Application {index + 1}</legend>
                <label>
                  App name
                  <input
                    required
                    maxLength={80}
                    value={app.name}
                    onChange={(e) =>
                      setDraft((old) => ({
                        ...old,
                        apps: old.apps.map((a, i) =>
                          i === index ? { ...a, name: e.target.value } : a,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  Description
                  <input
                    maxLength={500}
                    value={app.description}
                    onChange={(e) =>
                      setDraft((old) => ({
                        ...old,
                        apps: old.apps.map((a, i) =>
                          i === index ? { ...a, description: e.target.value } : a,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  App link
                  <input
                    required
                    type="url"
                    pattern="https://.*"
                    maxLength={1000}
                    value={app.url}
                    onChange={(e) =>
                      setDraft((old) => ({
                        ...old,
                        apps: old.apps.map((a, i) =>
                          i === index ? { ...a, url: e.target.value } : a,
                        ),
                      }))
                    }
                  />
                </label>
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() =>
                    setDraft((old) => ({ ...old, apps: old.apps.filter((_, i) => i !== index) }))
                  }
                >
                  <Trash2 size={15} />
                  Remove this app
                </button>
              </fieldset>
            ))}
          </div>
          <label className="ops-toggle-row ops-publish-toggle">
            <div>
              <strong>Publish developer details</strong>
              <span>Keep this off to save a private draft.</span>
            </div>
            <span className="ops-switch">
              <input
                type="checkbox"
                role="switch"
                checked={draft.published}
                aria-label="Publish developer details"
                onChange={(e) => setDraft((old) => ({ ...old, published: e.target.checked }))}
              />
              <span aria-hidden="true" />
            </span>
          </label>
        </fieldset>
        <ErrorNotice message={error} />
        <div className="ops-form-footer">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setPreview(true)}
          >
            Preview introduction
          </button>
          <button className="button button-primary" disabled={busy || !changed}>
            <Save size={17} />
            {busy ? 'Saving…' : draft.published ? 'Save & publish profile' : 'Save developer draft'}
          </button>
        </div>
      </form>
      {preview && (
        <Modal
          title="Developer introduction preview"
          description="Only published, saved details appear to students."
          onClose={() => setPreview(false)}
        >
          <DeveloperContent profile={draft} />
        </Modal>
      )}
      {discard && (
        <Modal
          title="Discard your edits?"
          description="Refreshing will load the last saved developer details."
          onClose={() => setDiscard(false)}
        >
          <div className="modal-actions">
            <button className="button button-secondary" onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button className="button button-primary" onClick={onReload}>
              Discard and refresh
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function UserStatusControl({ user, onChanged }: { user: AppUser; onChanged: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isMaster(auth.me) || auth.offline || user.role === 'master' || user.id === auth.me?.user.id)
    return null;
  const suspended = user.status === 'suspended';
  return (
    <>
      <button
        className={`button button-small ${suspended ? 'button-secondary' : 'ops-suspend-button'}`}
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setError('');
        }}
      >
        {suspended ? 'Restore access' : 'Suspend'}
      </button>
      {open && (
        <Modal
          title={suspended ? 'Restore this account?' : 'Suspend this account?'}
          description={
            suspended
              ? `${user.displayName} will be able to access ZabSync again. Their class memberships remain in place.`
              : `${user.displayName} will lose access to ZabSync. Their content and class memberships are kept so access can be restored later.`
          }
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p className="ops-help">{user.email}</p>
          <ErrorNotice message={error} />
          <div className="modal-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              className={`button ${suspended ? 'button-primary' : 'button-danger'}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await auth.request(`/admin/users/${encodeURIComponent(user.id)}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: suspended ? 'active' : 'suspended' }),
                  });
                  toast(suspended ? 'Account access restored.' : 'Account suspended.');
                  setOpen(false);
                  onChanged();
                } catch (error) {
                  setError(errorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : suspended ? (
                <Check size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              {suspended ? 'Restore access' : 'Suspend account'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
