import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Download,
  Globe2,
  MonitorSmartphone,
  RefreshCw,
  Share2,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { ActionHeading, ErrorNotice, Modal, useToast } from './components';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
interface InstallState {
  canPrompt: boolean;
  installed: boolean;
  updateAvailable: boolean;
  registrationError: boolean;
}
interface InstallContextValue extends InstallState {
  promptInstall: () => Promise<void>;
  applyUpdate: () => void;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let registrationStarted = false;
let reloadRequested = false;
let state: InstallState = {
  canPrompt: false,
  installed: false,
  updateAvailable: false,
  registrationError: false,
};
const listeners = new Set<(value: InstallState) => void>();
const notify = (patch: Partial<InstallState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
};

function isStandalone() {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

// Capture this event at module load: mounting the install page later must not lose it.
if (typeof window !== 'undefined') {
  state.installed = Boolean(isStandalone());
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify({ installed: true, canPrompt: false });
  });
}

export function registerServiceWorker() {
  if (
    !import.meta.env?.PROD ||
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator) ||
    registrationStarted
  )
    return;
  registrationStarted = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Other tabs are allowed to keep editing. Only the tab that confirmed an update reloads.
    if (reloadRequested) {
      reloadRequested = false;
      window.location.reload();
    }
  });
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((value) => {
      registration = value;
      if (value.waiting && navigator.serviceWorker.controller) notify({ updateAvailable: true });
      value.addEventListener('updatefound', () => {
        const worker = value.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller)
            notify({ updateAvailable: true });
        });
      });
      // Checking for a newer worker never reloads the page or discards an editor's work.
      window.addEventListener('online', () => {
        void value.update().catch(() => undefined);
      });
    })
    .catch(() => notify({ registrationError: true }));
}

const InstallContext = createContext<InstallContextValue | null>(null);
export function InstallProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    const media = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => notify({ installed: Boolean(isStandalone()) });
    media?.addEventListener?.('change', onDisplayChange);
    return () => {
      listeners.delete(setCurrent);
      media?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);
  return (
    <InstallContext.Provider
      value={{
        ...current,
        promptInstall: async () => {
          const event = deferredPrompt;
          if (!event) return;
          deferredPrompt = null;
          notify({ canPrompt: false });
          await event.prompt();
          // appinstalled or standalone detection establishes installation, not merely acceptance.
          await event.userChoice;
        },
        applyUpdate: () => {
          if (registration?.waiting) {
            reloadRequested = true;
            registration.waiting.postMessage({ type: 'XVIA_ACTIVATE_UPDATE' });
          } else {
            // A different tab may already have activated the update. This is an explicit reload.
            window.location.reload();
          }
        },
      }}
    >
      {children}
    </InstallContext.Provider>
  );
}

export function useInstall() {
  const value = useContext(InstallContext);
  if (!value) throw new Error('InstallProvider is missing.');
  return value;
}

export function InstallBanner() {
  const install = useInstall();
  const [dismissed, setDismissed] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  if (!install.updateAvailable && (dismissed || install.installed || !install.canPrompt))
    return null;
  return (
    <>
      <aside
        className={`ops-install-banner ${install.updateAvailable ? 'ops-update-banner' : ''}`}
        aria-label={install.updateAvailable ? 'Application update' : 'Install XVIA'}
      >
        {install.updateAvailable ? <RefreshCw size={21} /> : <Smartphone size={21} />}
        <div>
          <strong>
            {install.updateAvailable
              ? 'A fresh version of XVIA is ready.'
              : 'A place on your home screen.'}
          </strong>
          <span>
            {install.updateAvailable
              ? 'Save your changes, then update when you’re ready.'
              : 'Open your classes with one tap.'}
          </span>
        </div>
        {install.updateAvailable ? (
          <button
            className="button button-secondary button-small"
            onClick={() => setConfirmUpdate(true)}
          >
            Update
          </button>
        ) : (
          <Link to="/install" className="button button-secondary button-small">
            Get the app
          </Link>
        )}
        {!install.updateAvailable && (
          <button
            className="icon-button"
            aria-label="Dismiss installation suggestion"
            onClick={() => setDismissed(true)}
          >
            <X size={17} />
          </button>
        )}
      </aside>
      {confirmUpdate && (
        <Modal
          title="Ready to update XVIA?"
          description="Save any open edits first. Updating reloads this page, so unsaved form changes will be lost."
          onClose={() => setConfirmUpdate(false)}
        >
          <div className="modal-actions">
            <button className="button button-secondary" onClick={() => setConfirmUpdate(false)}>
              Keep working
            </button>
            <button className="button button-primary" onClick={() => install.applyUpdate()}>
              <RefreshCw size={17} />
              Update and reload
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function InstallPage() {
  const install = useInstall();
  const toast = useToast();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const appUrl = `${window.location.origin}/`;
  const canShare = typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      toast('XVIA link copied.');
    } catch {
      setError('The browser could not copy the link. Select and copy the address shown below.');
    }
  };
  return (
    <>
      <ActionHeading
        eyebrow="XVIA · Node Compass Task"
        title="Your campus, one tap away"
        subtitle="Use XVIA in your browser or add it to your home screen."
      />
      <section className="ops-install-hero">
        <div className="ops-install-brand">
          <img src="/icons/xvia-icon.png" alt="SZABIST University" width="82" height="82" />
          <div>
            <span className="eyebrow">Node Compass Task</span>
            <h2>XVIA</h2>
            <p>Less searching. More learning.</p>
          </div>
        </div>
        {install.installed ? (
          <span className="ops-installed-state">
            <CheckCircle2 size={20} />
            You’re using the installed app
          </span>
        ) : install.canPrompt ? (
          <button
            className="button button-white"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await install.promptInstall();
              } catch {
                setError(
                  'The browser could not open installation. Use its menu or follow the steps below.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={19} />
            {busy ? 'Opening installation…' : 'Install XVIA'}
          </button>
        ) : (
          <span className="ops-install-hint">
            <Smartphone size={19} />
            Follow the steps for your device below
          </span>
        )}
      </section>
      <ErrorNotice message={error} />
      {local && (
        <div className="info-box ops-install-local">
          <MonitorSmartphone size={20} />
          <p>
            You’re using XVIA on this computer. To open and install it on a phone, first deploy the
            app with real university login and share its HTTPS website link.
          </p>
        </div>
      )}
      {install.registrationError && (
        <div className="info-box">
          The browser could not prepare the offline connection page. XVIA can still be used online.
          Try reloading when your connection is stable.
        </div>
      )}
      <div className="ops-install-grid">
        <article className="panel ops-install-card">
          <span className="ops-device-icon ops-violet-bg">
            <Smartphone size={26} />
          </span>
          <h2>iPhone & iPad</h2>
          <p>Add XVIA directly from Safari.</p>
          <ol className="ops-steps">
            <li>
              <span>1</span>
              <div>
                Open the XVIA website in <strong>Safari</strong>.
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                Tap <strong>Share</strong> <Share2 size={14} />. Depending on your Safari layout,
                open the page menu first.
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                Choose <strong>Add to Home Screen</strong>.
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                If shown, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.
              </div>
            </li>
          </ol>
          <p className="ops-help">
            The XVIA icon appears on that device’s home screen. An App Store account is not needed
            for this web option.
          </p>
        </article>
        <article className="panel ops-install-card">
          <span className="ops-device-icon ops-teal-bg">
            <ArrowDownToLine size={26} />
          </span>
          <h2>Android & desktop</h2>
          <p>Use your browser’s installation option.</p>
          <ol className="ops-steps">
            <li>
              <span>1</span>
              <div>Open the XVIA website in a browser that supports web app installation.</div>
            </li>
            <li>
              <span>2</span>
              <div>
                Choose <strong>Install XVIA</strong> above when it appears, or look for{' '}
                <strong>Install app</strong> / <strong>Add to Home screen</strong> in the browser
                menu.
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                Follow the browser’s instructions, then open XVIA from your home screen or apps
                list.
              </div>
            </li>
          </ol>
          <p className="ops-help">
            The option and its wording depend on your browser. If it is unavailable, you can keep
            using the website.
          </p>
        </article>
      </div>
      <div className="ops-install-bottom">
        <section className="panel ops-share-panel">
          <div className="section-heading">
            <div>
              <h2>One link for everyone</h2>
              <p>
                {local
                  ? 'Your deployed website link will work on phones and computers.'
                  : 'Share the website. Each student chooses how to open it.'}
              </p>
            </div>
            <Globe2 size={24} className="ops-teal" />
          </div>
          <label>
            XVIA website
            <input value={appUrl} readOnly onFocus={(event) => event.target.select()} />
          </label>
          {!local && (
            <div className="ops-inline-actions">
              <button className="button button-secondary" onClick={() => void copy()}>
                {copied ? <CheckCircle2 size={17} /> : <Copy size={17} />}
                {copied ? 'Link copied' : 'Copy link'}
              </button>
              {canShare && (
                <button
                  className="button button-primary"
                  onClick={() => {
                    void navigator
                      .share({
                        title: 'XVIA · Node Compass Task',
                        text: 'Your class, connected on XVIA.',
                        url: appUrl,
                      })
                      .catch((err: unknown) => {
                        if (!(err instanceof DOMException && err.name === 'AbortError'))
                          setError(
                            'Sharing is unavailable here. You can copy the website link instead.',
                          );
                      });
                  }}
                >
                  <Share2 size={17} />
                  Share XVIA
                </button>
              )}
            </div>
          )}
        </section>
        <section className="panel ops-install-notes">
          <h2>What to expect</h2>
          <div>
            <WifiOff size={20} />
            <p>
              This version needs internet for class content. If your connection drops, an installed
              production build can show a reconnect page. Saved timetables and offline class content
              will be available in a future update.
            </p>
          </div>
          <div>
            <Download size={20} />
            <p>
              An Android download and Play Store listing will be added when the mobile release is
              ready. You can use the website and home-screen option now.
            </p>
          </div>
          <Link className="text-button" to="/">
            Back to your classes <ArrowUpRight size={16} />
          </Link>
        </section>
      </div>
    </>
  );
}
