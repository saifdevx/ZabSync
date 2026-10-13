import { useEffect, useState, type FormEvent } from 'react';
import { Bell, BellRing, Check, RefreshCw, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { errorMessage, useAuth } from './auth';
import { EmptyState, ErrorNotice, Modal, Spinner, formatDate, useToast } from './components';
import { useApi } from './hooks';
import { useSite } from './site';
import { enableDevicePush, removeLocalPushRegistration } from './reminder-push';

interface ReminderPreference {
  enabled: boolean;
  offsetMinutes: number;
  dueAt: string;
  deadlineVersion: number;
}
export interface ReminderPublicConfig {
  pushAvailable: boolean;
  vapidKey: string | null;
  publicFirebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    messagingSenderId: string;
  } | null;
}
interface InboxItem {
  id: string;
  deadlineId: string;
  title: string;
  dueAt: string;
  classId: string;
  className: string;
  subjectId: string | null;
  subjectName: string | null;
  createdAt: string;
  readAt: string | null;
}
interface Inbox {
  items: InboxItem[];
  nextCursor: string | null;
}
const offsets = [
  { value: 0, label: 'At the deadline time' },
  { value: 15, label: '15 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

function ReminderForm({ deadlineId, onClose }: { deadlineId: string; onClose: () => void }) {
  const auth = useAuth(),
    toast = useToast(),
    current = useApi<ReminderPreference>(`/deadlines/${deadlineId}/reminder`);
  const [enabled, setEnabled] = useState(false),
    [offset, setOffset] = useState(60),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (current.data) {
      setEnabled(current.data.enabled);
      setOffset(current.data.offsetMinutes);
    }
  }, [current.data]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth.request(`/deadlines/${deadlineId}/reminder`, {
        method: 'POST',
        body: JSON.stringify({ enabled, offsetMinutes: offset }),
      });
      toast(enabled ? 'Reminder saved.' : 'Reminder turned off.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Your deadline reminder" onClose={() => !busy && onClose()}>
      {current.loading ? (
        <Spinner label="Loading reminder…" />
      ) : current.error ? (
        <ErrorNotice message={current.error} retry={current.reload} />
      ) : (
        <form className="reminder-preference" onSubmit={save}>
          <p className="reminder-explanation">
            This is your personal reminder. The shared deadline stays under your class admin’s
            control.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Remind me about this deadline
          </label>
          <label>
            When
            <select
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
              disabled={!enabled}
            >
              {offsets.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="reminder-muted">
            Due {current.data && formatDate(current.data.dueAt, true)} · Asia/Karachi. If you enable
            it after the chosen reminder time, it is queued for the next check while the deadline is
            still upcoming.
          </p>
          <p className="reminder-muted">
            Your reminder appears in the Reminders inbox. Device alerts are optional and need
            permission plus connectivity. Times may be delayed by your phone or the network.
          </p>
          <ErrorNotice message={error} />
          <button className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save reminder'}
          </button>
        </form>
      )}
    </Modal>
  );
}

/** Lazy preference loading avoids one extra API request for every row of the deadline list. */
export function DeadlineReminderButton({ deadlineId }: { deadlineId: string }) {
  const auth = useAuth(),
    site = useSite(),
    [open, setOpen] = useState(false);
  if (auth.me?.user.role === 'master' || site.settings?.features.reminders === false) return null;
  return (
    <>
      <button
        className="text-button deadline-reminder-button"
        disabled={auth.offline || site.settings?.maintenance.enabled}
        title={auth.offline ? 'Reconnect to set a personal reminder' : undefined}
        onClick={() => setOpen(true)}
      >
        <Bell size={14} />
        Remind me
      </button>
      {open && <ReminderForm deadlineId={deadlineId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReminderPage() {
  const auth = useAuth(),
    site = useSite(),
    toast = useToast(),
    online = !auth.offline;
  const [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<InboxItem[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const enabled = site.settings?.features.reminders !== false,
    student = auth.me?.user.role !== 'master';
  const inbox = useApi<Inbox>(
    online && enabled && student
      ? `/reminders${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`
      : null,
  );
  const config = useApi<ReminderPublicConfig>(
    online && enabled && student ? '/reminders/config' : null,
  );
  const devices = useApi<{
    subscriptions: { id: string; deviceLabel: string; updatedAt: string }[];
  }>(online && enabled && student ? '/reminders/push-subscriptions' : null);
  useEffect(() => {
    setPrevious([]);
    setCursor(null);
    setError('');
  }, [auth.me?.user.id, online]);
  useEffect(() => {
    if (!online || !enabled || !student || cursor) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) inbox.reload();
    }, 60_000);
    const visible = () => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) inbox.reload();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [online, enabled, student, cursor, inbox.reload]);
  async function mark(item: InboxItem) {
    setBusy(item.id);
    setError('');
    try {
      await auth.request(`/reminders/${item.id}/read`, {
        method: 'PATCH',
        body: JSON.stringify({ read: !item.readAt }),
      });
      setPrevious((list) =>
        list.map((row) =>
          row.id === item.id
            ? { ...row, readAt: item.readAt ? null : new Date().toISOString() }
            : row,
        ),
      );
      inbox.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  async function enable() {
    if (!config.data || !auth.me) return;
    setBusy('push');
    setError('');
    try {
      await enableDevicePush(config.data, auth.me.user.id, auth.request);
      devices.reload();
      toast('Device notifications enabled for this account.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  async function remove(id: string) {
    setBusy(id);
    setError('');
    try {
      await auth.request(`/reminders/push-subscriptions/${id}`, { method: 'DELETE' });
      await removeLocalPushRegistration(auth.me!.user.id, id);
      devices.reload();
      toast('Device notifications removed.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  const items = [
    ...new Map([...previous, ...(inbox.data?.items || [])].map((item) => [item.id, item])).values(),
  ];
  if (!student)
    return (
      <EmptyState title="Personal reminders use your student account">
        Sign in with your university account to set and receive your own deadline reminders.
      </EmptyState>
    );
  if (!enabled)
    return (
      <EmptyState title="Reminders are paused">
        The owner has temporarily turned this feature off.
      </EmptyState>
    );
  return (
    <div className="reminder-page">
      <header className="reminder-header">
        <div>
          <span className="eyebrow">YOUR PERSONAL INBOX</span>
          <h1>Reminders</h1>
          <p>
            A little advance notice for your quizzes, assignments, and events. Choose “Remind me” on
            any upcoming deadline.
          </p>
        </div>
        <button
          className="button button-secondary"
          disabled={!online || Boolean(busy)}
          onClick={() => {
            setPrevious([]);
            setCursor(null);
            inbox.reload();
            devices.reload();
          }}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </header>
      {!online ? (
        <div className="panel">
          <EmptyState icon={<Bell />} title="Reconnect for your reminder inbox">
            Saved deadlines remain available offline. Device alerts and new reminders need a
            connection.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="reminder-settings">
            <h3>
              <Smartphone size={17} /> Device notifications
            </h3>
            <p>
              In-app reminders work without enabling phone alerts. When enabled, the lock screen
              shows a general ZabSync alert; open the app to read the private details.
            </p>
            {config.loading ? (
              <small>Checking notification support…</small>
            ) : config.data?.pushAvailable ? (
              <button
                className="button button-primary"
                disabled={Boolean(busy) || site.settings?.maintenance.enabled}
                onClick={() => void enable()}
              >
                <BellRing size={16} />
                {busy === 'push' ? 'Enabling…' : 'Enable on this device'}
              </button>
            ) : (
              <p>
                Phone alerts are not configured yet. Your personal reminder inbox remains available.
              </p>
            )}
            <p className="reminder-muted">
              On supported iPhones, add ZabSync to your Home Screen first. A closed, offline phone
              cannot receive a new alert. You can remove a device at any time.
            </p>
            <div className="reminder-devices">
              {devices.data?.subscriptions.map((device) => (
                <div className="reminder-device" key={device.id}>
                  <span>{device.deviceLabel || 'Registered device'}</span>
                  <button
                    className="text-button"
                    disabled={Boolean(busy) || site.settings?.maintenance.enabled}
                    onClick={() => void remove(device.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
          <ErrorNotice message={error || inbox.error || config.error || devices.error} />
          {inbox.loading && !items.length ? (
            <Spinner label="Loading your reminders…" />
          ) : !items.length ? (
            <EmptyState icon={<Bell />} title="No reminders here yet">
              Choose a reminder on an upcoming deadline. It will appear here when its reminder time
              arrives.
            </EmptyState>
          ) : (
            <div className="reminder-list">
              {items.map((item) => (
                <article
                  className={`reminder-item ${item.readAt ? '' : 'is-unread'}`}
                  key={item.id}
                >
                  <span className="reminder-bell">
                    <Bell size={18} />
                  </span>
                  <div className="reminder-item-content">
                    <span className="eyebrow">{item.subjectName || item.className}</span>
                    <h3>{item.title}</h3>
                    <p>Due {formatDate(item.dueAt, true)} · Asia/Karachi</p>
                    <p>Reminder received {formatDate(item.createdAt, true)}</p>
                    <div className="reminder-item-actions">
                      <Link
                        className="text-button"
                        to={
                          item.subjectId
                            ? `/subjects/${item.subjectId}?tab=deadlines`
                            : '/deadlines'
                        }
                      >
                        Open deadline
                      </Link>
                      <button
                        className="text-button"
                        disabled={Boolean(busy) || site.settings?.maintenance.enabled}
                        onClick={() => void mark(item)}
                      >
                        {item.readAt ? (
                          'Mark unread'
                        ) : (
                          <>
                            <Check size={13} />
                            Mark read
                          </>
                        )}
                      </button>
                      <DeadlineReminderButton deadlineId={item.deadlineId} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {inbox.data?.nextCursor && (
            <button
              className="button button-secondary"
              disabled={inbox.loading}
              onClick={() => {
                setPrevious(items);
                setCursor(inbox.data!.nextCursor);
              }}
            >
              Load earlier reminders
            </button>
          )}
        </>
      )}
    </div>
  );
}
