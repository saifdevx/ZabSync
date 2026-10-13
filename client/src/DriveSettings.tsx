import { useEffect, useState } from 'react';
import { Cloud, HardDrive, Link2, LoaderCircle, ShieldCheck, Unlink } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage, useAuth } from './auth';
import { ErrorNotice } from './components';
import { useApi } from './hooks';

interface DriveStatus {
  enabled: boolean;
  resourceDestination: 'drive' | 'base';
  connected: boolean;
  status: 'disabled' | 'active' | 'reconnect' | 'disconnected';
  email: string | null;
  ownedFiles: number;
  ownedBytes: number;
  pendingCleanup: number;
}

const callbackMessages: Record<string, string> = {
  cancelled: 'You cancelled the connection. Your storage has not changed.',
  drive_state_invalid:
    'The connection expired or opened in another browser. Please start again here.',
  drive_account_has_files:
    'Reconnect the same Google account while it owns shared files. Replace or remove those files before switching accounts.',
  drive_account_already_linked:
    'That Google Drive is already connected to another ZabSync account.',
  drive_scope_required:
    'Allow access to the files you use with ZabSync when Google asks for permission.',
  drive_refresh_required:
    'Google did not grant ongoing access. Please connect again and accept the Drive permission.',
  drive_connection_changed:
    'Another connection change happened first. Please check the current account and try again.',
  drive_connection_failed:
    'Google Drive could not connect. Please try again or ask the application owner to check setup.',
};

function bytes(value: number) {
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
}

/** Account-scoped controls; no Drive credential, file ID or public share URL reaches the browser. */
export function DriveSettings() {
  const auth = useAuth(),
    remote = useApi<DriveStatus>(auth.offline ? null : '/drive/status');
  const [query, setQuery] = useSearchParams();
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const result = query.get('drive');
  useEffect(() => {
    if (!result) return;
    if (result === 'connected')
      setNotice('Google Drive is connected. New resources you publish can use your Drive storage.');
    else setError(callbackMessages[result] || callbackMessages.drive_connection_failed!);
    const next = new URLSearchParams(query);
    next.delete('drive');
    setQuery(next, { replace: true });
  }, [result, query, setQuery]);
  const status = remote.data;

  async function connect() {
    setBusy('connect');
    setError('');
    setNotice('');
    try {
      const { authorizationUrl } = await auth.request<{ authorizationUrl: string }>(
        '/drive/connect',
        { method: 'POST', body: '{}' },
      );
      const url = new URL(authorizationUrl);
      if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth')
        throw new Error('The Google connection address is invalid.');
      window.location.assign(url.href);
    } catch (error) {
      setError(errorMessage(error));
      setBusy('');
    }
  }
  async function disconnect() {
    setBusy('disconnect');
    setError('');
    setNotice('');
    try {
      const response = await auth.request<{ providerRevoked: boolean; retainedFiles: number }>(
        '/drive/disconnect',
        { method: 'POST', body: JSON.stringify({ confirm: true }) },
      );
      setConfirmDisconnect(false);
      setNotice(
        `Drive is disconnected. Your files remain in your Google account.${response.retainedFiles ? ' Shared downloads need you to reconnect the same account.' : ''}${response.providerRevoked ? '' : ' Google could not confirm revocation; you can also remove ZabSync in your Google Account’s third-party connections.'}`,
      );
      remote.reload();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="panel drive-settings" aria-labelledby="drive-settings-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR STORAGE</span>
          <h2 id="drive-settings-title">Google Drive</h2>
          <p>Keep shared learning resources in the account you choose.</p>
        </div>
        <span className="drive-symbol" aria-hidden="true">
          <HardDrive size={24} />
        </span>
      </div>
      {auth.offline ? (
        <p className="drive-hint">
          Connect to the internet to manage Google Drive. Files already saved for offline use remain
          in Saved offline.
        </p>
      ) : remote.loading ? (
        <p role="status">
          <LoaderCircle className="spin" size={18} /> Checking your connection…
        </p>
      ) : (
        <>
          <ErrorNotice
            message={error || remote.error}
            retry={remote.error ? remote.reload : undefined}
          />
          {notice && (
            <p className="drive-notice" role="status">
              <ShieldCheck size={18} />
              {notice}
            </p>
          )}
          {status?.enabled ? (
            <>
              <div className="drive-account">
                <Cloud size={22} aria-hidden="true" />
                <div>
                  <strong>{status.email || 'No Drive connected'}</strong>
                  <span>
                    {status.connected
                      ? 'Connected'
                      : status.status === 'reconnect'
                        ? 'Reconnect required'
                        : 'Disconnected'}
                  </span>
                </div>
                {status.ownedFiles > 0 && (
                  <span className="drive-size">
                    {status.ownedFiles} file{status.ownedFiles === 1 ? '' : 's'} ·{' '}
                    {bytes(status.ownedBytes)}
                  </span>
                )}
              </div>
              <p className="drive-hint">
                Connecting is optional for reading resources. When you are allowed to publish, your
                uploads use{' '}
                {status.resourceDestination === 'drive'
                  ? 'your connected Drive'
                  : 'the app’s current storage setting'}
                . Classmates download through their subject in ZabSync.
              </p>
              <p className="drive-hint">
                Choose a personal Google account if you prefer. This does not change your university
                sign-in. Google asks for permission once; reconnecting may be needed if permission
                expires.
              </p>
              {status.ownedFiles > 0 && (
                <p className="drive-hint">
                  Keep the original files and this connection available while your section uses
                  them. Changing Class Admins does not transfer ownership of your Drive files.
                </p>
              )}
              {status.pendingCleanup > 0 && (
                <p className="drive-hint">
                  {status.pendingCleanup} file operation{status.pendingCleanup === 1 ? '' : 's'}{' '}
                  need cleanup. Reconnect if necessary, then ask the owner to retry storage cleanup.
                </p>
              )}
              <div className="drive-actions">
                <button
                  className="button button-primary"
                  disabled={Boolean(busy)}
                  onClick={() => void connect()}
                >
                  {busy === 'connect' ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Link2 size={17} />
                  )}
                  {status.connected ? 'Reconnect Drive' : 'Connect Google Drive'}
                </button>
                {status.status !== 'disconnected' && (
                  <button
                    className="button button-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    <Unlink size={17} />
                    Disconnect
                  </button>
                )}
              </div>
              {confirmDisconnect && (
                <div className="drive-confirm" role="group" aria-label="Confirm Drive disconnect">
                  <strong>Disconnect this Google Drive?</strong>
                  <p>
                    Files stay in your Google account. Shared resources stored there will stop
                    downloading in ZabSync until you reconnect the same account. Already downloaded
                    copies remain on students’ devices.
                  </p>
                  <div className="drive-actions">
                    <button
                      className="button button-danger"
                      disabled={Boolean(busy)}
                      onClick={() => void disconnect()}
                    >
                      {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Drive'}
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => setConfirmDisconnect(false)}
                    >
                      Keep connected
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            status && (
              <p className="drive-hint">
                {auth.config?.authMode === 'demo'
                  ? 'This is the local practice environment. Files stay on this computer; no Google account is needed.'
                  : 'Drive connection will appear here when the owner completes Google setup. Your profile photo uses application storage.'}
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
