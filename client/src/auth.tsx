import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Auth, User } from 'firebase/auth';
import type { Resource } from './academic-types';
import { buildOfflineSnapshot, offlineResponse } from './offline-data';
import {
  OFFLINE_TTL_MS,
  offlineStore,
  OfflineStorageError,
  subscribeOfflineChanges,
  type OfflineAccess,
  type OfflineFileInfo,
  type OfflineLease,
  type OfflineSnapshot,
} from './offline-store';
import type { MeResponse, Persona, PublicConfig } from './types';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
class NetworkUnavailableError extends Error {
  constructor() {
    super('Could not reach ZabSync. Check your connection and try again.');
    this.name = 'NetworkUnavailableError';
  }
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'The email or password is incorrect. Please try again.',
    'auth/email-already-in-use':
      'An account already uses this email. Sign in or reset your password.',
    'auth/weak-password': 'Choose a stronger password with at least 12 characters.',
    'auth/too-many-requests': 'Too many attempts. Please wait a little before trying again.',
    'auth/network-request-failed':
      'Could not connect. Check your internet connection and try again.',
    'auth/invalid-email': 'Please enter a valid university email address.',
    'auth/user-disabled': 'This account is disabled. Please contact the app administrator.',
    'auth/operation-not-allowed':
      'This sign-in method is not enabled yet. Ask the app administrator to finish setup.',
    'auth/popup-blocked':
      'Your browser blocked the Google sign-in window. Allow pop-ups for ZabSync or use your university email and app password.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed. You can try again.',
    'auth/cancelled-popup-request':
      'Another sign-in window is already open. Finish that sign-in first.',
    'auth/account-exists-with-different-credential':
      'This email already has an account. Use the original sign-in method for that account.',
    'auth/unauthorized-domain':
      'This website address has not been enabled for login. Contact the app administrator.',
  };
  if (code && messages[code]) return messages[code];
  if (error instanceof TypeError && /fetch/i.test(error.message))
    return 'Could not reach ZabSync. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
function isNetworkFailure(error: unknown) {
  return (
    error instanceof NetworkUnavailableError ||
    (error as { code?: string })?.code === 'auth/network-request-failed'
  );
}
function aborted(): never {
  throw new DOMException('This account request was cancelled.', 'AbortError');
}
async function apiFetch(path: string, options: RequestInit = {}) {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error('Use an application API path.');
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`/api${path}`, { ...options, cache: 'no-store', headers });
  } catch (error) {
    if (options.signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
    throw new NetworkUnavailableError();
  }
}
async function responseError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => null);
  throw new ApiError(
    body?.error?.code ?? 'REQUEST_FAILED',
    body?.error?.message ?? fallback,
    response.status,
  );
}
async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) return responseError(response, 'The request could not be completed.');
  return (await response.json()) as T;
}
const DEMO_TOKEN_KEY = 'zabsync.demo.token';
const REVOKED_KEY = 'zabsync.offline.revoked';
function sessionToken() {
  try {
    return sessionStorage.getItem(DEMO_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeSessionToken(token: string) {
  try {
    if (token) sessionStorage.setItem(DEMO_TOKEN_KEY, token);
    else sessionStorage.removeItem(DEMO_TOKEN_KEY);
    sessionStorage.removeItem('xvia.demo.token');
  } catch {
    /* An in-memory online demo still works when session storage is denied. */
  }
}
function revocationKey(lease: OfflineLease) {
  return `${REVOKED_KEY}:${encodeURIComponent(lease.userId)}:${lease.epoch}`;
}
function markRevoked(lease: OfflineLease, value: boolean) {
  try {
    if (value) localStorage.setItem(revocationKey(lease), '1');
    else {
      localStorage.removeItem(revocationKey(lease));
      localStorage.removeItem(REVOKED_KEY);
    }
  } catch {
    /* IndexedDB remains the primary revocation boundary. */
  }
}
function restorationAllowed(lease: OfflineLease) {
  try {
    return (
      localStorage.getItem(REVOKED_KEY) !== '1' &&
      localStorage.getItem(revocationKey(lease)) !== '1'
    );
  } catch {
    return true;
  }
}

export interface AuthContextValue {
  config: PublicConfig | null;
  loading: boolean;
  configError: string;
  me: MeResponse | null;
  meError: string;
  signedIn: boolean;
  verified: boolean;
  email: string;
  offline: boolean;
  offlineEnabled: boolean;
  lastSyncedAt: string | null;
  offlineError: string;
  offlineBusy: boolean;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  requestBlob: (path: string, options?: RequestInit) => Promise<Blob>;
  refreshMe: () => Promise<void>;
  prepareOffline: () => Promise<void>;
  clearOffline: () => Promise<void>;
  reconnect: () => Promise<void>;
  saveOfflineFile: (resource: Resource) => Promise<void>;
  listOfflineFiles: () => Promise<OfflineFileInfo[]>;
  getOfflineFile: (id: string) => Promise<Blob>;
  removeOfflineFile: (id: string) => Promise<void>;
  demoLogin: (persona: Persona) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  ownerLogin: (email: string, password: string) => Promise<void>;
  googleLogin: (owner?: boolean) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshVerification: () => Promise<boolean>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [identity, setIdentity] = useState<{ user: User; verified: boolean } | null>(null);
  const [demoToken, setDemoToken] = useState(sessionToken);
  const [authReady, setAuthReady] = useState(false);
  const [loadingMe, setLoadingMe] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState('');
  const [offline, setOffline] = useState(false);
  const [offlineEnabled, setOfflineEnabled] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [offlineError, setOfflineError] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const generation = useRef(0),
    refreshGeneration = useRef(0);
  const mounted = useRef(true);
  const configRef = useRef<PublicConfig | null>(null);
  const firebaseRef = useRef<Auth | null>(null);
  const firebaseApi = useRef<typeof import('firebase/auth') | null>(null);
  const tokenRef = useRef(demoToken),
    userRef = useRef<User | null>(null);
  const verifiedUserId = useRef<string | null>(null),
    leaseRef = useRef<OfflineLease | null>(null);
  const meRef = useRef<MeResponse | null>(null),
    offlineRef = useRef(false);
  const prepareRef = useRef<Promise<void> | null>(null);
  const preparationGeneration = useRef(0),
    preparationTicket = useRef<symbol | null>(null);
  const reconnectRef = useRef<() => Promise<void>>(async () => {});

  const changeMe = useCallback((value: MeResponse | null) => {
    meRef.current = value;
    setMe(value);
  }, []);
  const changeOffline = useCallback((value: boolean) => {
    offlineRef.current = value;
    setOffline(value);
  }, []);
  const cancelPreparation = useCallback(() => {
    preparationGeneration.current++;
    preparationTicket.current = null;
    prepareRef.current = null;
    setOfflineBusy(false);
  }, []);
  const clearView = useCallback(() => {
    generation.current++;
    refreshGeneration.current++;
    verifiedUserId.current = null;
    leaseRef.current = null;
    cancelPreparation();
    changeMe(null);
    setMeError('');
    setLoadingMe(false);
    changeOffline(false);
    setOfflineEnabled(false);
    setLastSyncedAt(null);
    setOfflineBusy(false);
  }, [changeMe, changeOffline, cancelPreparation]);
  const forgetPrivateData = useCallback(
    async (reason: 'cleared' | 'logout' = 'cleared', expected = leaseRef.current) => {
      const userId = verifiedUserId.current;
      cancelPreparation();
      setOfflineEnabled(false);
      setLastSyncedAt(null);
      // A failed old-account request cannot revoke or clear another tab's newly active account.
      if (expected) markRevoked(expected, true);
      try {
        if (!expected && userId) {
          const active = await offlineStore.active();
          if (active?.userId === userId) {
            expected = active;
            markRevoked(expected, true);
          }
        }
        if (expected) await offlineStore.clear(reason, expected);
      } catch (error) {
        setOfflineError(errorMessage(error));
        throw error;
      }
    },
    [cancelPreparation],
  );
  const storedFor = useCallback(async (userId?: string) => {
    const stored = await offlineStore.snapshot(userId).catch((error) => {
      setOfflineError(errorMessage(error));
      return null;
    });
    return stored && stored.snapshot.me.user.role !== 'master' && restorationAllowed(stored.lease)
      ? stored
      : null;
  }, []);
  const restore = useCallback(
    (stored: { snapshot: OfflineSnapshot; lease: OfflineLease }) => {
      verifiedUserId.current = stored.snapshot.userId;
      leaseRef.current = stored.lease;
      changeMe(stored.snapshot.me);
      setMeError('');
      changeOffline(true);
      setOfflineEnabled(true);
      setLastSyncedAt(stored.snapshot.savedAt);
      setLoadingMe(false);
      setAuthReady(true);
    },
    [changeMe, changeOffline],
  );

  const authorizedResponse = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const started = generation.current,
        expectedLease = leaseRef.current;
      const token =
        configRef.current?.authMode === 'demo'
          ? tokenRef.current
          : await userRef.current?.getIdToken();
      if (started !== generation.current || options.signal?.aborted) aborted();
      if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${token}`);
      const response = await apiFetch(path, { ...options, headers });
      if (started !== generation.current || options.signal?.aborted) aborted();
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const failure = new ApiError(
          body?.error?.code ?? 'REQUEST_FAILED',
          body?.error?.message ?? 'The request could not be completed.',
          response.status,
        );
        if (started !== generation.current || options.signal?.aborted) aborted();
        if (response.status === 401 || response.status === 403) {
          // Permission failures are authoritative; they must never return an old offline response.
          await forgetPrivateData('cleared', expectedLease).catch(() => {});
        }
        if (
          started === generation.current &&
          (response.status === 401 || failure.code === 'account_suspended')
        ) {
          generation.current++;
          verifiedUserId.current = null;
          leaseRef.current = null;
          changeMe(null);
          changeOffline(false);
          setMeError(failure.message);
          setLoadingMe(false);
          if (response.status === 401) {
            tokenRef.current = '';
            writeSessionToken('');
            setDemoToken('');
            userRef.current = null;
            setIdentity(null);
          }
        }
        throw failure;
      }
      return response;
    },
    [forgetPrivateData, changeMe, changeOffline],
  );
  const onlineRequest = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const started = generation.current;
      const value = (await (await authorizedResponse(path, options)).json()) as T;
      if (started !== generation.current || options.signal?.aborted) aborted();
      return value;
    },
    [authorizedResponse],
  );
  const readOffline = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      if ((options.method ?? 'GET').toUpperCase() !== 'GET')
        throw new ApiError(
          'OFFLINE_READ_ONLY',
          'You are viewing saved information. Reconnect before making changes.',
          0,
        );
      const userId = verifiedUserId.current,
        started = generation.current;
      if (!userId) throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
      const stored = await storedFor(userId);
      if (started !== generation.current || options.signal?.aborted) aborted();
      if (!stored)
        throw new OfflineStorageError(
          'OFFLINE_NOT_PREPARED',
          'Offline information is unavailable or expired. Reconnect and prepare this device again.',
        );
      return offlineResponse<T>(stored.snapshot, path);
    },
    [storedFor],
  );
  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      if (offlineRef.current) return readOffline<T>(path, options);
      const started = generation.current,
        userId = verifiedUserId.current;
      try {
        return await onlineRequest<T>(path, options);
      } catch (error) {
        if (
          !isNetworkFailure(error) ||
          (options.method ?? 'GET').toUpperCase() !== 'GET' ||
          !userId ||
          options.signal?.aborted
        )
          throw error;
        const stored = await storedFor(userId);
        if (started !== generation.current) aborted();
        if (!stored) throw error;
        restore(stored);
        return offlineResponse<T>(stored.snapshot, path);
      }
    },
    [onlineRequest, readOffline, restore, storedFor],
  );
  const requestBlob = useCallback(
    async (path: string, options: RequestInit = {}): Promise<Blob> => {
      const started = generation.current,
        userId = verifiedUserId.current;
      const savedBlob = async () => {
        if ((options.method ?? 'GET').toUpperCase() !== 'GET')
          throw new ApiError('OFFLINE_READ_ONLY', 'Reconnect before making changes.', 0);
        const match = /^\/resources\/([^/?]+)\/download$/.exec(path);
        if (!match || !userId || !(await storedFor(userId)))
          throw new OfflineStorageError(
            'OFFLINE_FILE_UNAVAILABLE',
            'Save this file to the device while online before opening it offline.',
          );
        const blob = await offlineStore.file(userId, decodeURIComponent(match[1]));
        if (started !== generation.current || options.signal?.aborted) aborted();
        if (!blob)
          throw new OfflineStorageError(
            'OFFLINE_FILE_UNAVAILABLE',
            'This file is not saved offline, or its saved access has expired.',
          );
        return blob;
      };
      if (offlineRef.current) return savedBlob();
      try {
        const blob = await (await authorizedResponse(path, options)).blob();
        if (started !== generation.current || options.signal?.aborted) aborted();
        return blob;
      } catch (error) {
        if (!isNetworkFailure(error) || !userId || options.signal?.aborted) throw error;
        const stored = await storedFor(userId);
        if (started !== generation.current) aborted();
        if (!stored) throw error;
        restore(stored);
        return savedBlob();
      }
    },
    [authorizedResponse, restore, storedFor],
  );

  const refreshMe = useCallback(
    async (forceOnline = false) => {
      if (offlineRef.current && !forceOnline) {
        changeMe(await readOffline<MeResponse>('/me'));
        return;
      }
      const started = generation.current,
        revision = ++refreshGeneration.current;
      setLoadingMe(true);
      setMeError('');
      try {
        const value = await onlineRequest<MeResponse>('/me');
        if (started !== generation.current || revision !== refreshGeneration.current) return;
        verifiedUserId.current = value.user.id;
        try {
          leaseRef.current = await offlineStore.activateVerifiedAccount(
            value.user.id,
            () => started === generation.current,
          );
          const stored = await storedFor(value.user.id);
          if (stored) {
            const access = await onlineRequest<OfflineAccess>('/offline/access');
            if (started !== generation.current) aborted();
            const pruned = await offlineStore.revalidate(stored.lease, access, value);
            if (pruned) leaseRef.current = pruned.lease;
            setOfflineEnabled(!!pruned);
            setLastSyncedAt(pruned?.snapshot.savedAt ?? null);
          }
        } catch (error) {
          if (
            error instanceof ApiError ||
            isNetworkFailure(error) ||
            (error as { name?: string })?.name === 'AbortError'
          )
            throw error;
          setOfflineError(errorMessage(error)); // Storage denial does not break online authentication.
        }
        if (started === generation.current && revision === refreshGeneration.current) {
          changeMe(value);
          changeOffline(false);
          setMeError('');
        }
      } catch (error) {
        if (started !== generation.current || revision !== refreshGeneration.current) return;
        if (isNetworkFailure(error)) {
          const stored = await storedFor(verifiedUserId.current ?? userRef.current?.uid);
          if (started === generation.current && stored) {
            restore(stored);
            return;
          }
        }
        changeMe(null);
        setMeError(errorMessage(error));
        throw error;
      } finally {
        if (started === generation.current && revision === refreshGeneration.current)
          setLoadingMe(false);
      }
    },
    [onlineRequest, readOffline, restore, storedFor, changeMe, changeOffline],
  );

  const prepareOffline = useCallback(async () => {
    if (meRef.current?.user.role === 'master')
      throw new ApiError(
        'OFFLINE_OWNER_DISABLED',
        'The owner console requires an online connection.',
        0,
      );
    if (prepareRef.current) return prepareRef.current;
    if (offlineRef.current)
      throw new ApiError(
        'OFFLINE_READ_ONLY',
        'Reconnect before refreshing offline information.',
        0,
      );
    const userId = verifiedUserId.current,
      started = generation.current,
      preparation = preparationGeneration.current;
    if (!userId || !meRef.current)
      throw new ApiError(
        'UNAUTHENTICATED',
        'Sign in with your verified university account first.',
        401,
      );
    const ticket = Symbol('offline-preparation');
    preparationTicket.current = ticket;
    const job = (async () => {
      setOfflineBusy(true);
      setOfflineError('');
      try {
        const lease = await offlineStore.activateVerifiedAccount(
          userId,
          () => started === generation.current && preparation === preparationGeneration.current,
        );
        if (started !== generation.current || preparation !== preparationGeneration.current)
          aborted();
        leaseRef.current = lease;
        const snapshot = await buildOfflineSnapshot(onlineRequest, userId);
        if (
          started !== generation.current ||
          preparation !== preparationGeneration.current ||
          userId !== verifiedUserId.current
        )
          aborted();
        if (configRef.current) await offlineStore.savePublicConfig(configRef.current);
        const committedLease = await offlineStore.commit(lease, snapshot);
        if (started !== generation.current || preparation !== preparationGeneration.current)
          aborted();
        leaseRef.current = committedLease;
        markRevoked(committedLease, false);
        setOfflineEnabled(true);
        setLastSyncedAt(snapshot.savedAt);
      } catch (error) {
        if (started === generation.current && preparation === preparationGeneration.current)
          setOfflineError(errorMessage(error));
        throw error;
      } finally {
        if (preparationTicket.current === ticket) {
          setOfflineBusy(false);
          prepareRef.current = null;
          preparationTicket.current = null;
        }
      }
    })();
    prepareRef.current = job;
    return job;
  }, [onlineRequest]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    mounted.current = true;
    const init = async () => {
      setConfigError('');
      let value: PublicConfig;
      try {
        value = await fetchJson<PublicConfig>('/config');
      } catch (error) {
        if (isNetworkFailure(error)) {
          const [cachedConfig, stored] = await Promise.all([
            offlineStore.publicConfig().catch(() => null),
            storedFor(),
          ]);
          if (active && cachedConfig && stored) {
            configRef.current = cachedConfig;
            setConfig(cachedConfig);
            restore(stored);
            return;
          }
        }
        if (active) {
          setConfigError(
            `${errorMessage(error)} Connect once and prepare offline access on this device to reopen saved information.`,
          );
          setAuthReady(true);
        }
        return;
      }
      if (!active) return;
      configRef.current = value;
      setConfig(value);
      void offlineStore.savePublicConfig(value).catch(() => {});
      if (value.authMode === 'demo') {
        setAuthReady(true);
        return;
      }
      if (!value.firebase)
        throw new Error(
          'University login has not been configured. Please contact the app administrator.',
        );
      const [appModule, authModule] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
      ]);
      if (!active) return;
      firebaseApi.current = authModule;
      const auth = authModule.getAuth(
        appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(value.firebase),
      );
      auth.languageCode = 'en';
      firebaseRef.current = auth;
      unsubscribe = authModule.onAuthStateChanged(
        auth,
        (user) => {
          if (!active) return;
          if (userRef.current?.uid !== user?.uid) {
            generation.current++;
            changeMe(null);
            setMeError('');
            if (verifiedUserId.current && verifiedUserId.current !== user?.uid) {
              void forgetPrivateData('cleared').catch(() => {});
              verifiedUserId.current = null;
              leaseRef.current = null;
            }
          }
          userRef.current = user;
          setIdentity(user ? { user, verified: user.emailVerified } : null);
          setAuthReady(true);
        },
        (error) => {
          if (active) {
            setConfigError(errorMessage(error));
            setAuthReady(true);
          }
        },
      );
    };
    void init().catch((error) => {
      if (active) {
        setConfigError(errorMessage(error));
        setAuthReady(true);
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe?.();
    };
  }, [bootstrapRevision, changeMe, forgetPrivateData, restore, storedFor]);
  useEffect(() => {
    if (!authReady || !config || offlineRef.current) return;
    const valid = config.authMode === 'demo' ? !!demoToken : !!identity?.verified;
    if (valid) void refreshMe().catch(() => {});
    else {
      changeMe(null);
      setMeError('');
      setLoadingMe(false);
    }
  }, [authReady, config, demoToken, identity?.user.uid, identity?.verified, refreshMe, changeMe]);

  const reconnect = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      throw new NetworkUnavailableError();
    setOfflineError('');
    const hasCredentials =
      configRef.current?.authMode === 'demo' ? !!tokenRef.current : !!userRef.current;
    if (!hasCredentials) {
      // A saved identity never manufactures a new Firebase or demo session.
      changeOffline(false);
      changeMe(null);
      setMeError('');
      setAuthReady(false);
      setBootstrapRevision((value) => value + 1);
      return;
    }
    const wasOffline = offlineRef.current;
    try {
      await refreshMe(true);
      if (!offlineRef.current && wasOffline) {
        const stored = await storedFor(verifiedUserId.current ?? undefined);
        if (stored) await prepareOffline();
      }
    } catch (error) {
      setOfflineError(errorMessage(error));
      throw error;
    }
  }, [changeMe, changeOffline, prepareOffline, refreshMe, storedFor]);
  reconnectRef.current = reconnect;
  useEffect(() => {
    const wentOnline = () => {
      void reconnectRef.current().catch(() => {});
    };
    const wentOffline = () => {
      const started = generation.current,
        userId = verifiedUserId.current;
      if (!userId) return;
      void storedFor(userId).then((stored) => {
        if (mounted.current && started === generation.current && stored) restore(stored);
      });
    };
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    const unsubscribe = subscribeOfflineChanges((change, external) => {
      if (
        (external && change === 'identity') ||
        change === 'cleared' ||
        (external && change === 'logout')
      )
        cancelPreparation();
      if (external && change === 'logout') {
        tokenRef.current = '';
        writeSessionToken('');
        setDemoToken('');
        userRef.current = null;
        setIdentity(null);
        clearView();
        if (firebaseRef.current && firebaseApi.current)
          void firebaseApi.current.signOut(firebaseRef.current).catch(() => {});
        return;
      }
      const started = generation.current,
        userId = verifiedUserId.current;
      if (!userId) return;
      void storedFor(userId).then((stored) => {
        if (!mounted.current || started !== generation.current) return;
        setOfflineEnabled(!!stored);
        setLastSyncedAt(stored?.snapshot.savedAt ?? null);
        if (!stored && offlineRef.current) {
          changeMe(null);
          changeOffline(false);
          setMeError('Saved access was cleared or expired. Reconnect and sign in again.');
        } else if (stored && offlineRef.current) {
          leaseRef.current = stored.lease;
          changeMe(stored.snapshot.me);
          // Permission-only pruning intentionally keeps savedAt unchanged; mounted queries still need to refresh.
          window.dispatchEvent(new CustomEvent('zabsync:content-updated'));
        }
      });
    });
    return () => {
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
      unsubscribe();
    };
  }, [changeMe, changeOffline, clearView, restore, storedFor, cancelPreparation]);

  useEffect(() => {
    if (!lastSyncedAt || !offlineEnabled) return;
    const started = generation.current,
      userId = verifiedUserId.current;
    const timer = window.setTimeout(
      () => {
        if (started !== generation.current || !userId) return;
        // Re-read and conditionally expire the observed revision, so an old timer cannot erase a fresh sync.
        void storedFor(userId).then((stored) => {
          if (!mounted.current || started !== generation.current) return;
          setOfflineEnabled(!!stored);
          setLastSyncedAt(stored?.snapshot.savedAt ?? null);
          if (!stored && offlineRef.current) {
            changeOffline(false);
            changeMe(null);
            setMeError('Offline information has expired. Reconnect and prepare this device again.');
          }
        });
      },
      Math.max(0, Date.parse(lastSyncedAt) + OFFLINE_TTL_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [lastSyncedAt, offlineEnabled, changeMe, changeOffline, storedFor]);

  const requireFirebase = () => {
    if (!firebaseRef.current || !firebaseApi.current)
      throw new Error('Reconnect to use university login.');
    return { auth: firebaseRef.current, api: firebaseApi.current };
  };
  const validateEmail = (email: string) => {
    const normalized = email.trim().toLowerCase(),
      parts = normalized.split('@');
    if (
      parts.length !== 2 ||
      !parts[0] ||
      /\s/.test(normalized) ||
      parts[1] !== (config?.allowedEmailDomain ?? 'szabist-isb.pk')
    )
      throw new Error(
        `Use your @${config?.allowedEmailDomain ?? 'szabist-isb.pk'} university email address.`,
      );
    return normalized;
  };
  const requireCurrentLease = async () => {
    const userId = verifiedUserId.current;
    if (!userId)
      throw new OfflineStorageError(
        'OFFLINE_NOT_PREPARED',
        'Prepare offline access on this device first.',
      );
    const stored = await storedFor(userId);
    if (!stored)
      throw new OfflineStorageError(
        'OFFLINE_NOT_PREPARED',
        'Prepare offline access on this device first.',
      );
    return stored.lease;
  };
  const signedIn = offline || (config?.authMode === 'demo' ? !!demoToken : !!identity);
  const verified = offline || (config?.authMode === 'demo' ? !!demoToken : !!identity?.verified);
  const value: AuthContextValue = {
    config,
    configError,
    me,
    meError,
    signedIn,
    verified,
    loading:
      !configError &&
      (!config || !authReady || (loadingMe && !me) || (signedIn && verified && !me && !meError)),
    email: identity?.user.email ?? me?.user.email ?? '',
    offline,
    offlineEnabled,
    lastSyncedAt,
    offlineError,
    offlineBusy,
    request,
    requestBlob,
    refreshMe,
    prepareOffline,
    reconnect,
    clearOffline: async () => {
      const wasOffline = offlineRef.current;
      await forgetPrivateData();
      leaseRef.current = null;
      if (wasOffline) {
        changeOffline(false);
        changeMe(null);
        setMeError('Offline data was cleared. Reconnect to sign in.');
      }
    },
    saveOfflineFile: async (resource) => {
      if (offlineRef.current)
        throw new ApiError('OFFLINE_READ_ONLY', 'Reconnect to save a new file for offline use.', 0);
      const started = generation.current;
      let lease = await requireCurrentLease();
      if (started !== generation.current) aborted();
      const currentMe = await onlineRequest<MeResponse>('/me');
      const access = await onlineRequest<OfflineAccess>('/offline/access');
      const before = await offlineStore.revalidate(lease, access, currentMe);
      if (!before)
        throw new OfflineStorageError(
          'OFFLINE_NOT_PREPARED',
          'Refresh offline access before saving this file.',
        );
      lease = before.lease;
      const { resource: current } = await onlineRequest<{ resource: Resource }>(
        `/resources/${encodeURIComponent(resource.id)}`,
      );
      const blob = await (
        await authorizedResponse(`/resources/${encodeURIComponent(resource.id)}/download`)
      ).blob();
      if (started !== generation.current) aborted();
      // Pin the current snapshot before the final access request, so a delayed older manifest cannot restore a revoked scope.
      lease = await requireCurrentLease();
      const after = await onlineRequest<OfflineAccess>('/offline/access');
      if (started !== generation.current || after.userId !== lease.userId) aborted();
      const final = await offlineStore.revalidate(lease, after, currentMe);
      if (!final)
        throw new OfflineStorageError(
          'OFFLINE_NOT_PREPARED',
          'Refresh offline access before saving this file.',
        );
      lease = final.lease;
      await offlineStore.saveFile(lease, current, blob);
    },
    listOfflineFiles: async () => {
      const started = generation.current,
        userId = verifiedUserId.current;
      if (!userId || !(await storedFor(userId))) return [];
      const files = await offlineStore.listFiles(userId);
      if (started !== generation.current) aborted();
      return files;
    },
    getOfflineFile: async (id) => {
      const started = generation.current;
      let lease = await requireCurrentLease();
      if (!offlineRef.current) {
        try {
          const currentMe = await onlineRequest<MeResponse>('/me');
          const access = await onlineRequest<OfflineAccess>('/offline/access');
          const validated = await offlineStore.revalidate(lease, access, currentMe);
          if (!validated)
            throw new OfflineStorageError(
              'OFFLINE_NOT_PREPARED',
              'Refresh offline access before opening this file.',
            );
          lease = validated.lease;
        } catch (error) {
          if (!isNetworkFailure(error)) throw error;
          const stored = await storedFor(lease.userId);
          if (started !== generation.current) aborted();
          if (!stored) throw error;
          restore(stored);
        }
      }
      const blob = await offlineStore.file(lease.userId, id);
      if (started !== generation.current) aborted();
      if (!blob)
        throw new OfflineStorageError(
          'OFFLINE_FILE_UNAVAILABLE',
          'This file is no longer saved or available to this account.',
        );
      return blob;
    },
    removeOfflineFile: async (id) => {
      await offlineStore.removeFile(await requireCurrentLease(), id);
    },
    demoLogin: async (persona) => {
      const { token } = await fetchJson<{ token: string }>('/demo/session', {
        method: 'POST',
        body: JSON.stringify({ persona }),
      });
      const oldLease = leaseRef.current;
      clearView();
      tokenRef.current = '';
      writeSessionToken('');
      await forgetPrivateData('cleared', oldLease).catch(() => {});
      tokenRef.current = token;
      writeSessionToken(token);
      setDemoToken(token);
    },
    login: async (email, password) => {
      const { api, auth } = requireFirebase(),
        normalized = validateEmail(email);
      if (userRef.current?.email?.toLowerCase() !== normalized)
        await forgetPrivateData().catch(() => {});
      await api.signInWithEmailAndPassword(auth, normalized, password);
    },
    ownerLogin: async (email, password) => {
      const normalized = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254)
        throw new Error('Enter the email for your existing owner account.');
      const { api, auth } = requireFirebase();
      if (userRef.current?.email?.toLowerCase() !== normalized)
        await forgetPrivateData().catch(() => {});
      // The API accepts an external owner only when its private configured email AND UID match.
      // No owner address, UID, or student registration exception is exposed by this form.
      await api.signInWithEmailAndPassword(auth, normalized, password);
    },
    googleLogin: async (owner = false) => {
      if (!configRef.current?.googleSignInEnabled)
        throw new Error('Google sign-in is not enabled yet.');
      const { api, auth } = requireFirebase();
      const provider = new api.GoogleAuthProvider();
      provider.setCustomParameters(
        owner
          ? { prompt: 'select_account' }
          : { prompt: 'select_account', hd: configRef.current.allowedEmailDomain },
      );
      // Called directly from a user gesture. This asks for identity only; Drive uses its own consent.
      const result = await api.signInWithPopup(auth, provider);
      if (!owner) {
        try {
          validateEmail(result.user.email || '');
        } catch {
          await api.signOut(auth);
          throw new Error(
            'Use your verified @szabist-isb.pk university account to enter ZabSync. Your personal Gmail can be connected for Drive after sign-in.',
          );
        }
      }
      // The server still checks verified email and the exact private owner UID. The hd hint is not authorization.
    },
    register: async (name, email, password) => {
      if (password.length < 12)
        throw new Error('Choose an app password with at least 12 characters.');
      const { api, auth } = requireFirebase();
      await forgetPrivateData().catch(() => {});
      const result = await api.createUserWithEmailAndPassword(auth, validateEmail(email), password);
      await api.updateProfile(result.user, { displayName: name.trim() });
      await api.sendEmailVerification(result.user);
    },
    resetPassword: async (email) => {
      const { api, auth } = requireFirebase();
      await api.sendPasswordResetEmail(auth, validateEmail(email));
    },
    resendVerification: async () => {
      const { api } = requireFirebase();
      if (!userRef.current) throw new Error('Sign in first.');
      await api.sendEmailVerification(userRef.current);
    },
    refreshVerification: async () => {
      if (!userRef.current) return false;
      await userRef.current.reload();
      await userRef.current.getIdToken(true);
      setIdentity({ user: userRef.current, verified: userRef.current.emailVerified });
      return userRef.current.emailVerified;
    },
    logout: async () => {
      if (meRef.current && !offlineRef.current) {
        try {
          const { disconnectPushOnLogout } = await import('./reminder-push');
          await disconnectPushOnLogout(meRef.current.user.id, request);
        } catch {
          /* Push cleanup never prevents account sign-out. */
        }
      }
      const oldLease = leaseRef.current;
      clearView();
      tokenRef.current = '';
      writeSessionToken('');
      setDemoToken('');
      userRef.current = null;
      setIdentity(null);
      await forgetPrivateData('logout', oldLease).catch(() => {});
      if (firebaseRef.current && firebaseApi.current)
        await firebaseApi.current.signOut(firebaseRef.current);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing.');
  return value;
}
