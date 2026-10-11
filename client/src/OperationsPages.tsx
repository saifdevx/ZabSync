import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
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
  Trash2,
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

export interface FeatureSettings {
  subjects: boolean;
  resources: boolean;
  announcements: boolean;
  tutor: boolean;
  profilePhotos: boolean;
}
interface SiteSettings {
  version: number;
  features: FeatureSettings;
  maintenance: { enabled: boolean; message: string };
  updatedAt: string;
}
interface TutorProfile {
  version: number;
  published: boolean;
  title: string;
  name: string;
  bio: string;
  subjects: string[];
  contactLabel: string;
  contactUrl: string;
  bookingUrl: string;
  updatedAt: string;
}

function useOperationResource<T>(path: string) {
  const { request, me } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    setLoading(true);
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
  }, [path, request, me?.user.id, revision]);
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
  const site = useOperationResource<{ settings: SiteSettings }>('/site');
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
  const readOnly = site.data?.settings.maintenance.enabled && user.role !== 'master';
  const photoEnabled = site.data?.settings.features.profilePhotos !== false;

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
                Profile changes are paused during maintenance. You can still view your account.
              </div>
            )}
            <form
              className="form-stack"
              onSubmit={async (event: FormEvent) => {
                event.preventDefault();
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
                Get XVIA on your home screen <ArrowUpRight size={16} />
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

export function TutorPage() {
  const { data, error, loading, reload } = useOperationResource<{ tutor: TutorProfile | null }>(
    '/tutor',
  );
  const isMaster = useAuth().me?.user.role === 'master';
  if (loading) return <Spinner label="Loading tutor information…" />;
  if (error) return <ErrorNotice message={error} retry={reload} />;
  const tutor = data?.tutor;
  return (
    <>
      <ActionHeading
        eyebrow="A little guidance goes a long way"
        title="Meet your tutor"
        subtitle="Extra support for the subjects you want to understand better."
      />
      {tutor ? (
        <article className="ops-tutor-profile panel">
          <div className="ops-tutor-top">
            <span className="ops-tutor-icon">
              <GraduationCap size={36} />
            </span>
            <div>
              <span className="eyebrow">Tutor</span>
              <h2>{tutor.name}</h2>
              <p>{tutor.title}</p>
            </div>
          </div>
          <div className="ops-tutor-body">
            <h3>About your tutor</h3>
            <p className="ops-prose">{tutor.bio}</p>
            {tutor.subjects.length > 0 && (
              <section className="ops-tutor-subjects">
                <h3>
                  <BookOpen size={19} />
                  Subjects & support
                </h3>
                <div className="ops-chip-list">
                  {tutor.subjects.map((subject, index) => (
                    <span key={`${index}-${subject}`} className="ops-chip">
                      {subject}
                    </span>
                  ))}
                </div>
              </section>
            )}
            {(safeHttps(tutor.contactUrl) || safeHttps(tutor.bookingUrl)) && (
              <div className="ops-tutor-contact">
                {safeHttps(tutor.contactUrl) && (
                  <a
                    className="button button-primary"
                    href={safeHttps(tutor.contactUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {tutor.contactLabel || 'Contact tutor'}
                    <ExternalLink size={17} />
                  </a>
                )}
                {safeHttps(tutor.bookingUrl) && (
                  <a
                    className="button button-secondary"
                    href={safeHttps(tutor.bookingUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Arrange a session
                    <ArrowUpRight size={17} />
                  </a>
                )}
              </div>
            )}
            <p className="ops-help">
              Details provided by the app administrator
              {tutor.updatedAt ? ` · Updated ${formatDate(tutor.updatedAt)}` : ''}.
            </p>
          </div>
        </article>
      ) : (
        <section className="panel">
          <EmptyState
            icon={<GraduationCap size={32} />}
            title="Tutor details are on their way."
            action={
              isMaster ? (
                <Link className="button button-primary" to="/admin">
                  Add tutor details
                  <ArrowUpRight size={17} />
                </Link>
              ) : undefined
            }
          >
            The app administrator has not published a tutor profile yet. Check back here for
            subjects, contact details, and session information.
          </EmptyState>
        </section>
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
  { key: 'tutor', title: 'Tutor', description: 'Show your published tutor profile to students.' },
  {
    key: 'profilePhotos',
    title: 'Profile photos',
    description: 'Allow students to add and view profile photos.',
  },
];

export function AdminSettingsPanel() {
  const auth = useAuth();
  const settings = useOperationResource<{ settings: SiteSettings }>('/admin/settings');
  const tutor = useOperationResource<{ tutor: TutorProfile }>('/admin/tutor');
  if (auth.me?.user.role !== 'master')
    return <ErrorNotice message="Only the Master Admin can change application settings." />;
  return (
    <div className="ops-stack">
      <div className="ops-admin-intro">
        <span className="ops-admin-icon">
          <Settings2 size={25} />
        </span>
        <div>
          <h2>Your control room</h2>
          <p>Manage the features students see, maintenance, and your tutor profile.</p>
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
      {tutor.loading ? (
        <Spinner label="Loading tutor settings…" />
      ) : tutor.error ? (
        <ErrorNotice message={tutor.error} retry={tutor.reload} />
      ) : (
        tutor.data && (
          <TutorEditor
            key={`tutor-${tutor.data.tutor.version}`}
            initial={tutor.data.tutor}
            onReload={tutor.reload}
          />
        )
      )}
      <section className="panel ops-release-note">
        <div>
          <ShieldCheck size={22} />
          <h3>Growing XVIA</h3>
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
            window.dispatchEvent(new CustomEvent('xvia:settings-updated'));
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
              <strong>Pause changes for students and representatives</strong>
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

function TutorEditor({ initial, onReload }: { initial: TutorProfile; onReload: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [subjects, setSubjects] = useState(initial.subjects.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const set = (key: keyof TutorProfile, value: string | boolean) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const changed =
    JSON.stringify(draft) !== JSON.stringify(initial) || subjects !== initial.subjects.join('\n');
  return (
    <section className="panel ops-tutor-editor">
      <div className="section-heading">
        <div>
          <h2>Your tutor profile</h2>
          <p>Add your own introduction and contact details, then publish when ready.</p>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="Refresh tutor settings"
          onClick={() => {
            if (changed) setConfirmReload(true);
            else onReload();
          }}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const normalizedSubjects = subjects
              .split('\n')
              .map((subject) => subject.trim())
              .filter(Boolean);
            if (normalizedSubjects.length > 20)
              throw new Error('Keep the subject list to 20 entries or fewer.');
            await auth.request('/admin/tutor', {
              method: 'PATCH',
              body: JSON.stringify({
                version: initial.version,
                published: draft.published,
                title: draft.title.trim(),
                name: draft.name.trim(),
                bio: draft.bio.trim(),
                subjects: normalizedSubjects,
                contactLabel: draft.contactLabel.trim(),
                contactUrl: draft.contactUrl.trim(),
                bookingUrl: draft.bookingUrl.trim(),
              }),
            });
            toast(
              draft.published
                ? 'Tutor profile published.'
                : 'Tutor draft saved. Students cannot see it yet.',
            );
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
              Name
              <input
                value={draft.name}
                required={draft.published}
                maxLength={100}
                autoComplete="name"
                onChange={(event) => set('name', event.target.value)}
                placeholder="Your name"
              />
            </label>
            <label>
              Title
              <input
                value={draft.title}
                required={draft.published}
                maxLength={100}
                onChange={(event) => set('title', event.target.value)}
                placeholder="e.g. Computer science tutor"
              />
            </label>
          </div>
          <label>
            About you
            <textarea
              value={draft.bio}
              required={draft.published}
              maxLength={4000}
              rows={6}
              onChange={(event) => set('bio', event.target.value)}
              placeholder="Tell students what you teach, your approach, and how you can help."
            />
            <span className="ops-help">Plain text · {draft.bio.length}/4,000 characters</span>
          </label>
          <label>
            Subjects and support
            <textarea
              value={subjects}
              maxLength={1800}
              rows={4}
              onChange={(event) => setSubjects(event.target.value)}
              placeholder={'Database systems\nOperating systems\nAssignment guidance'}
            />
            <span className="ops-help">
              One subject per line, up to 20 entries. Keep each entry under 80 characters.
            </span>
          </label>
          <div className="form-two">
            <label>
              Contact button label
              <input
                value={draft.contactLabel}
                maxLength={60}
                onChange={(event) => set('contactLabel', event.target.value)}
                placeholder="e.g. Contact me"
              />
            </label>
            <label>
              Contact link
              <input
                type="url"
                pattern="https://.*"
                value={draft.contactUrl}
                maxLength={1000}
                onChange={(event) => set('contactUrl', event.target.value)}
                placeholder="https://…"
              />
            </label>
          </div>
          <label>
            Session booking link <span className="optional">Optional</span>
            <input
              type="url"
              pattern="https://.*"
              value={draft.bookingUrl}
              maxLength={1000}
              onChange={(event) => set('bookingUrl', event.target.value)}
              placeholder="https://…"
            />
            <span className="ops-help">
              Use HTTPS links, such as your contact page or booking service. Leave a link empty to
              hide its button.
            </span>
          </label>
          <label className="ops-toggle-row ops-publish-toggle">
            <div>
              <strong>Publish tutor profile</strong>
              <span>
                Students can see it when this is on and the Tutor feature is enabled above.
              </span>
            </div>
            <span className="ops-switch">
              <input
                type="checkbox"
                role="switch"
                checked={draft.published}
                aria-label="Publish tutor profile"
                onChange={(event) => set('published', event.target.checked)}
              />
              <span aria-hidden="true" />
            </span>
          </label>
        </fieldset>
        <ErrorNotice message={error} />
        <div className="ops-form-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setPreview(true)}
          >
            Preview introduction
          </button>
          <button className="button button-primary" disabled={busy || !changed}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {draft.published ? 'Save & publish profile' : 'Save tutor draft'}
          </button>
        </div>
      </form>
      {preview && (
        <Modal
          title="Tutor introduction preview"
          description="Your draft is only visible here until you save and publish it."
          onClose={() => setPreview(false)}
        >
          <div className="ops-preview">
            <h2>{draft.name || 'Your name'}</h2>
            <p className="ops-teal">{draft.title || 'Your tutor title'}</p>
            <p className="ops-prose">{draft.bio || 'Your introduction will appear here.'}</p>
            <div className="ops-chip-list">
              {subjects
                .split('\n')
                .map((subject) => subject.trim())
                .filter(Boolean)
                .map((subject, index) => (
                  <span key={index} className="ops-chip">
                    {subject}
                  </span>
                ))}
            </div>
          </div>
          <div className="modal-actions">
            <button className="button button-primary" onClick={() => setPreview(false)}>
              Back to editing
            </button>
          </div>
        </Modal>
      )}
      {confirmReload && (
        <Modal
          title="Discard your tutor edits?"
          description="Refreshing will replace this draft with the last saved profile."
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

export function UserStatusControl({ user, onChanged }: { user: AppUser; onChanged: () => void }) {
  const auth = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (auth.me?.user.role !== 'master' || user.role === 'master' || user.id === auth.me.user.id)
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
              ? `${user.displayName} will be able to access XVIA again. Their class memberships remain in place.`
              : `${user.displayName} will lose access to XVIA. Their content and class memberships are kept so access can be restored later.`
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
