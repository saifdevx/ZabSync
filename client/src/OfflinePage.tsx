import { useEffect, useRef, useState } from 'react';
import { Check, CloudDownload, Download, FileText, HardDrive, LoaderCircle, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { errorMessage, useAuth } from './auth';
import type { Resource } from './academic-types';
import { ActionHeading, EmptyState, ErrorNotice, formatDate, Modal, useToast } from './components';
import { OFFLINE_FILE_LIMIT_BYTES, subscribeOfflineChanges, type OfflineFileInfo } from './offline-store';

function bytes(value: number) {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
function useOfflineFiles() {
  const auth = useAuth();
  const list = useRef(auth.listOfflineFiles); list.current = auth.listOfflineFiles;
  const [files, setFiles] = useState<OfflineFileInfo[]>([]), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => subscribeOfflineChanges(() => setRevision((value) => value + 1)), []);
  useEffect(() => {
    let active = true; setFiles([]); setError('');
    if (auth.offlineEnabled) void list.current().then((value) => { if (active) setFiles(value); })
      .catch((value) => { if (active) setError(errorMessage(value)); });
    return () => { active = false; };
  }, [auth.me?.user.id, auth.offlineEnabled, auth.lastSyncedAt, revision]);
  return { files, error, reload: () => setRevision((value) => value + 1) };
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.hidden = true;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function useShellStatus() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  useEffect(() => {
    let active = true;
    let channel: MessageChannel | undefined;
    const timeout = window.setTimeout(() => { if (active) setStatus('unavailable'); channel?.port1.close(); }, 5000);
    const check = async () => {
      if (!('serviceWorker' in navigator) || typeof MessageChannel === 'undefined') { setStatus('unavailable'); return; }
      const registration = await navigator.serviceWorker.getRegistration();
      const worker = navigator.serviceWorker.controller ?? registration?.active;
      if (!worker || !active) { if (active) setStatus('unavailable'); return; }
      channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (active) setStatus(event.data?.ready === true ? 'ready' : 'unavailable');
        window.clearTimeout(timeout); channel?.port1.close();
      };
      worker.postMessage({ type: 'ZABSYNC_OFFLINE_STATUS' }, [channel.port2]);
    };
    void check().catch(() => { if (active) setStatus('unavailable'); });
    return () => { active = false; window.clearTimeout(timeout); channel?.port1.close(); };
  }, []);
  return status;
}

export function OfflineSaveButton({ resource }: { resource: Resource }) {
  const auth = useAuth(), toast = useToast();
  const state = useOfflineFiles();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saved = state.files.some((item) => item.id === resource.id && item.resourceUpdatedAt === resource.updatedAt);
  if (!auth.offlineEnabled) return <Link className="button button-secondary button-small" to="/offline"><HardDrive size={15} /> Set up offline</Link>;
  return <div className="offline-save-control">
    <button className="button button-secondary button-small" disabled={busy || saved || auth.offline}
      aria-label={saved ? `${resource.title} is saved offline` : `Save ${resource.title} offline`}
      onClick={async () => {
        setBusy(true); setError('');
        try { await auth.saveOfflineFile(resource); toast('File saved for offline use on this device.'); state.reload(); }
        catch (value) { setError(errorMessage(value)); }
        finally { setBusy(false); }
      }}>
      {busy ? <LoaderCircle className="spin" size={15} /> : saved ? <Check size={15} /> : <CloudDownload size={15} />}
      {busy ? 'Saving to device…' : saved ? 'Saved offline' : 'Save offline'}
    </button>
    {error && <small role="alert" className="field-error">{error}</small>}
  </div>;
}

export function OfflinePage() {
  const auth = useAuth(), toast = useToast(), state = useOfflineFiles(), shellStatus = useShellStatus();
  const [error, setError] = useState(''), [busyFile, setBusyFile] = useState('');
  const [clearOpen, setClearOpen] = useState(false), [clearBusy, setClearBusy] = useState(false);
  const total = state.files.reduce((sum, item) => sum + item.sizeBytes, 0);
  const refresh = async () => {
    setError('');
    try { await auth.prepareOffline(); toast('Your class information is saved on this device.'); state.reload(); }
    catch (value) { setError(errorMessage(value)); }
  };
  return <>
    <ActionHeading eyebrow="Your device" title="Available offline" subtitle="Keep your week and the files you choose close by, even without a connection." />
    <section className="panel ops-section offline-status-panel" aria-labelledby="offline-status-title">
      <div className="ops-section-heading"><div><span className="eyebrow">{auth.offline ? 'Saved view' : 'Device storage'}</span>
        <h2 id="offline-status-title">{auth.offline ? 'You’re reading your saved information.' : auth.offlineEnabled ? 'Class information is saved.' : 'Prepare this device before you go offline.'}</h2></div>
        <span className="ops-accent-icon">{auth.offline ? <WifiOff size={24} /> : <HardDrive size={24} />}</span>
      </div>
      <p>Save your joined classes, subjects, announcements, timetable, dated changes and deadlines for up to seven days. Pick lecture files individually using <strong>Save offline</strong>.</p>
      <dl className="ops-detail-list">
        <div><dt>Last complete sync</dt><dd>{auth.lastSyncedAt ? formatDate(auth.lastSyncedAt, true) : 'Not prepared yet'}</dd></div>
        <div><dt>Offline access expires</dt><dd>{auth.lastSyncedAt ? formatDate(new Date(Date.parse(auth.lastSyncedAt) + 7 * 24 * 60 * 60 * 1000).toISOString(), true) : 'Seven days after preparation'}</dd></div>
        <div><dt>Reopen the app offline</dt><dd>{shellStatus === 'ready' ? 'The app is ready on this browser' : shellStatus === 'checking' ? 'Checking this browser…' : 'Open the app online to finish setup'}</dd></div>
      </dl>
      {shellStatus === 'unavailable' && <p className="help-text">Open the app using its secure website address, then refresh this page once. This browser needs to finish saving the app before it can reopen without a connection. See <Link to="/install">installation help</Link> if it is still unavailable.</p>}
      <p className="help-text">Use a device you control. Anyone who can open this browser can read its saved class information. Signing out or switching accounts clears saved access and files. Edits, uploads, joining classes and marking deadlines complete need a connection.</p>
      <ErrorNotice message={error || auth.offlineError || state.error} />
      <div className="ops-inline-actions">
        {auth.offline ? <button className="button button-primary" onClick={async () => { setError(''); try { await auth.reconnect(); } catch (value) { setError(errorMessage(value)); } }}><Wifi size={17} /> Reconnect</button>
          : <button className="button button-primary" disabled={auth.offlineBusy} onClick={() => void refresh()}>
            {auth.offlineBusy ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
            {auth.offlineBusy ? 'Preparing complete snapshot…' : auth.offlineEnabled ? 'Refresh offline information' : 'Prepare offline access'}
          </button>}
        {auth.offlineEnabled && <button className="button button-secondary" disabled={auth.offlineBusy} onClick={() => setClearOpen(true)}><Trash2 size={17} /> Clear this device</button>}
      </div>
    </section>
    <section className="panel ops-section" aria-labelledby="offline-files-title">
      <div className="ops-section-heading"><div><span className="eyebrow">Saved files</span><h2 id="offline-files-title">Your offline library</h2></div><span>{bytes(total)} / 150 MiB</span></div>
      <progress className="offline-storage-meter" aria-label="Offline file storage used" value={total} max={OFFLINE_FILE_LIMIT_BYTES} />
      <p className="help-text">These copies stay inside this browser. “Download copy” also saves a separate file through your browser; you manage that downloaded copy yourself.</p>
      {state.files.length ? <div className="offline-file-list">{state.files.map((file) => <article className="offline-file-row" key={file.id}>
        <div className="ops-accent-icon"><FileText size={22} /></div><div className="offline-file-info"><h3>{file.title}</h3><p>{file.filename} · {bytes(file.sizeBytes)}</p><small>Saved {formatDate(file.savedAt, true)}</small></div>
        <div className="ops-inline-actions"><button className="button button-secondary button-small" disabled={!!busyFile}
          onClick={async () => { setBusyFile(file.id); setError(''); try { saveBlob(await auth.getOfflineFile(file.id), file.filename); } catch (value) { setError(errorMessage(value)); state.reload(); } finally { setBusyFile(''); } }}>
          {busyFile === file.id ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />} Download copy
        </button><button className="icon-button" aria-label={`Remove ${file.title} from this device`} disabled={!!busyFile}
          onClick={async () => { setBusyFile(file.id); setError(''); try { await auth.removeOfflineFile(file.id); state.reload(); toast('Offline copy removed.'); } catch (value) { setError(errorMessage(value)); } finally { setBusyFile(''); } }}><Trash2 size={17} /></button></div>
      </article>)}</div> : <EmptyState icon={<CloudDownload size={28} />} title="Choose the files you’ll need.">
        Open your class resources and use Save offline. Bookmarking a file in Saved for later does not download its contents.
      </EmptyState>}
      <p className="help-text">Reconnect to validate current class access. Files that are deleted, replaced, disabled or no longer shared with you are removed from this offline library after validation. Browser storage can be cleared by your device; keep important independent backups where appropriate.</p>
    </section>
    {clearOpen && <Modal title="Clear offline information?" description="This removes the class snapshot and offline files from this browser. Your university account and online class content remain available." onClose={() => { if (!clearBusy) setClearOpen(false); }}>
      <ErrorNotice message={error} />
      <div className="modal-actions"><button className="button button-secondary" disabled={clearBusy} onClick={() => setClearOpen(false)}>Cancel</button>
        <button className="button button-danger" disabled={clearBusy} onClick={async () => { setClearBusy(true); setError(''); try { await auth.clearOffline(); setClearOpen(false); state.reload(); toast('Offline information cleared from this device.'); } catch (value) { setError(errorMessage(value)); } finally { setClearBusy(false); } }}>{clearBusy ? 'Clearing…' : 'Clear offline information'}</button></div>
    </Modal>}
  </>;
}
