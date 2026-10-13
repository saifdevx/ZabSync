import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Database,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useAuth, errorMessage } from './auth';
import { EmptyState, ErrorNotice, Spinner, useToast } from './components';
import { isMaster } from './permissions';
import { useApi } from './hooks';

interface HealthData {
  version: string;
  checkedAt: string;
  schemaVersions: number[];
  runtime: { auth: string; database: string; pushEnabled: boolean; googleSignInEnabled: boolean };
  counts: Record<string, number>;
  uploadLimits: { documents: number; video: number; perSection: number };
}
interface StorageUsage {
  baseUsedBytes: number;
  baseLimitBytes: number;
  basePending: number;
  driveBytes: number;
  driveFiles: number;
  drivePending: number;
  resourceDestination: string;
  driveEnabled: boolean;
}
function bytes(value: number) {
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`;
}
export function OperationsHealthPage() {
  const auth = useAuth(),
    toast = useToast(),
    allowed = isMaster(auth.me) && !auth.offline;
  const health = useApi<HealthData>(allowed ? '/admin/operations' : null);
  const usage = useApi<StorageUsage>(allowed ? '/admin/storage/usage' : null);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [cleanup, setCleanup] = useState(false);
  if (!allowed)
    return (
      <EmptyState icon={<ShieldCheck size={28} />} title="Owner connection required">
        Use your owner account while online to view operations.
      </EmptyState>
    );
  if (health.loading || usage.loading) return <Spinner label="Checking operations…" />;
  if (!health.data || !usage.data)
    return (
      <ErrorNotice
        message={health.error || usage.error || 'Operations are unavailable.'}
        retry={() => {
          health.reload();
          usage.reload();
        }}
      />
    );
  const data = health.data,
    storage = usage.data;
  const action = async (kind: 'cleanup' | 'retry') => {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'cleanup') {
        const result = await auth.request<{ removed: number; failed: number }>(
          '/admin/storage/cleanup',
          { method: 'POST', body: JSON.stringify({ confirm: true, limit: 10 }) },
        );
        toast(
          `${result.removed} tracked orphan files removed. ${result.failed} need another check.`,
        );
        setCleanup(false);
      } else {
        const result = await auth.request<{ requeued: number }>(
          '/admin/operations/retry-reminders',
          { method: 'POST', body: JSON.stringify({ confirm: true }) },
        );
        toast(`${result.requeued} failed reminders queued for another eligibility check.`);
      }
      health.reload();
      usage.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="student-tool-page">
      <Link to="/admin" className="text-button">
        <ArrowLeft size={16} /> Owner dashboard
      </Link>
      <header className="tool-heading">
        <div className="tool-heading-icon">
          <Activity size={25} />
        </div>
        <div>
          <span className="eyebrow">MASTER ADMIN</span>
          <h1>Operations</h1>
          <p>Storage, background jobs, and the health of your campus.</p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => {
            health.reload();
            usage.reload();
          }}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </header>
      <ErrorNotice message={error} />
      <div className="student-tools-grid">
        <section className="tool-panel">
          <div className="section-heading">
            <h2>
              <HardDrive size={18} /> Small-file storage
            </h2>
          </div>
          <p className="gpa-value" style={{ fontSize: 36 }}>
            {bytes(storage.baseUsedBytes)}
          </p>
          <p className="muted">of {bytes(storage.baseLimitBytes)} app allowance</p>
          <progress
            className="ops-storage-progress"
            value={Math.min(storage.baseUsedBytes, storage.baseLimitBytes)}
            max={storage.baseLimitBytes}
            aria-label="Base storage used"
          />
          <p className="tool-note">
            Tracks profile photos and files in the base storage provider. Pending reservations:{' '}
            {storage.basePending}. This is the app’s accounting, not your provider invoice.
          </p>
          <hr />
          <h2>Uploader Drive storage</h2>
          <p>
            {storage.driveFiles} files · {bytes(storage.driveBytes)}
          </p>
          <p className="tool-note">
            New resource destination:{' '}
            <strong>
              {storage.resourceDestination === 'drive'
                ? 'Uploader’s connected Google Drive'
                : 'Configured local / R2 base storage'}
            </strong>
            . Drive setup: {storage.driveEnabled ? 'configured' : 'not configured'}. Pending Drive
            cleanup: {storage.drivePending}.
          </p>
        </section>
        <section className="tool-panel">
          <div className="section-heading">
            <h2>
              <Database size={18} /> Application health
            </h2>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Version</dt>
              <dd>{data.version}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{data.runtime.database === 'remote' ? 'Remote SQL' : 'Local SQLite'}</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>{data.runtime.auth === 'demo' ? 'Local demo only' : 'Verified Firebase'}</dd>
            </div>
            <div>
              <dt>Device push</dt>
              <dd>{data.runtime.pushEnabled ? 'Configured' : 'Off; reminder inbox available'}</dd>
            </div>
            <div>
              <dt>Upload caps</dt>
              <dd>
                {bytes(data.uploadLimits.documents)} documents / {bytes(data.uploadLimits.video)}{' '}
                video
              </dd>
            </div>
            <div>
              <dt>Per-section quota</dt>
              <dd>{bytes(data.uploadLimits.perSection)}</dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{data.schemaVersions.at(-1)}</dd>
            </div>
          </dl>
          <p className="tool-note">
            Checked {new Date(data.checkedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}{' '}
            · Pakistan time.
          </p>
        </section>
      </div>
      <section className="tool-panel">
        <h2>What needs attention</h2>
        <div className="ops-health-counts">
          {[
            ['students', 'Active students'],
            ['sections', 'Active sections'],
            ['subjects', 'Subjects'],
            ['resources', 'Resources'],
            ['sectionConflicts', 'Section decisions needed'],
            ['openChatReports', 'Open chat reports'],
            ['pendingReminders', 'Queued reminders'],
            ['failedReminders', 'Failed reminders'],
            ['failedPush', 'Failed device deliveries'],
          ].map(([key, label]) => (
            <div key={key}>
              <strong>{data.counts[key] ?? 0}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <p className="tool-note">
          Resolve section decisions in All students. Review reported chat messages from the
          subject’s Chat tab. Failed jobs remain visible; after correcting the cause, retry up to 50
          reminder jobs below.
        </p>
        <div className="tool-form-actions">
          <Link className="button button-secondary" to="/admin?tab=users">
            Open All students
          </Link>
          <button
            className="button button-secondary"
            disabled={!!busy || !data.counts.failedReminders}
            onClick={() => void action('retry')}
          >
            {busy === 'retry' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}{' '}
            Retry failed reminders
          </button>
        </div>
      </section>
      <section className="tool-panel">
        <h2>Maintenance & recovery</h2>
        <p className="tool-note">
          The App controls tab pauses student writes during maintenance and enables or disables
          built-in features. New code is released through your GitHub deployment. Keep a database
          backup and rehearse restoring it to a new database before upgrading.
        </p>
        <div className="tool-form-actions">
          <Link to="/admin?tab=settings" className="button button-secondary">
            Open App controls
          </Link>
          <button
            className="button button-quiet"
            disabled={!!busy}
            onClick={() => setCleanup(!cleanup)}
          >
            <Trash2 size={16} /> Clean tracked orphan files
          </button>
        </div>
        {cleanup && (
          <div className="inline-notice">
            <p>
              Remove up to 10 app-tracked files older than one hour that have no remaining resource
              or profile reference. Referenced files and arbitrary personal Drive files are
              excluded.
            </p>
            <button
              className="button button-secondary"
              disabled={!!busy}
              onClick={() => void action('cleanup')}
            >
              {busy === 'cleanup' ? 'Cleaning…' : 'Remove tracked orphans'}
            </button>
            <button className="text-button" onClick={() => setCleanup(false)}>
              Cancel
            </button>
          </div>
        )}
        <p className="tool-note">
          Database export and restore commands are in the included Recovery guide. File bytes and
          the Drive token encryption key need their own protected backup; a database export alone
          cannot recover deleted Drive documents.
        </p>
      </section>
    </div>
  );
}
