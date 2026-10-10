import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import type { MeResponse, Persona, PublicConfig } from './types';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
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
      'Email login is not enabled yet. Ask the app administrator to finish setup.',
    'auth/unauthorized-domain':
      'This website address has not been enabled for login. Contact the app administrator.',
  };
  if (code && messages[code]) return messages[code];
  if (error instanceof TypeError && /fetch/i.test(error.message))
    return 'Could not reach CampusDesk. Check your connection and try again.';
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'The request could not be completed.',
      response.status,
    );
  return body as T;
}
interface AuthContextValue {
  config: PublicConfig | null;
  loading: boolean;
  configError: string;
  me: MeResponse | null;
  meError: string;
  signedIn: boolean;
  verified: boolean;
  email: string;
  request: <T>(path: string, options?: RequestInit) => Promise<T>;
  refreshMe: () => Promise<void>;
  demoLogin: (persona: Persona) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  refreshVerification: () => Promise<boolean>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
const DEMO_TOKEN_KEY = 'campusdesk.demo.token';
export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [firebase, setFirebase] = useState<Auth | null>(null);
  const [identity, setIdentity] = useState<{ user: User; verified: boolean } | null>(null);
  const [demoToken, setDemoToken] = useState(() => sessionStorage.getItem(DEMO_TOKEN_KEY) ?? '');
  const [authReady, setAuthReady] = useState(false);
  const [loadingMe, setLoadingMe] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    fetchJson<PublicConfig>('/config')
      .then((value) => {
        if (!active) return;
        setConfig(value);
        if (value.authMode === 'demo') {
          setAuthReady(true);
          return;
        }
        if (!value.firebase)
          throw new Error(
            'University login has not been configured. Please contact the app administrator.',
          );
        const auth = getAuth(getApps().length ? getApp() : initializeApp(value.firebase));
        auth.languageCode = 'en';
        setFirebase(auth);
        unsubscribe = onAuthStateChanged(
          auth,
          (user) => {
            if (!active) return;
            setIdentity(user ? { user, verified: user.emailVerified } : null);
            setAuthReady(true);
          },
          (error) => {
            setConfigError(errorMessage(error));
            setAuthReady(true);
          },
        );
      })
      .catch((error) => {
        if (active) setConfigError(errorMessage(error));
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const token =
        config?.authMode === 'demo' ? demoToken : await firebase?.currentUser?.getIdToken();
      if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in to continue.', 401);
      return fetchJson<T>(path, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
    },
    [config?.authMode, demoToken, firebase],
  );
  const refreshMe = useCallback(async () => {
    const requestGeneration = ++generation.current;
    setLoadingMe(true);
    setMeError('');
    try {
      const value = await request<MeResponse>('/me');
      if (requestGeneration === generation.current) setMe(value);
    } catch (error) {
      if (requestGeneration === generation.current) {
        setMe(null);
        setMeError(errorMessage(error));
      }
      throw error;
    } finally {
      if (requestGeneration === generation.current) setLoadingMe(false);
    }
  }, [request]);
  const signedIn = config?.authMode === 'demo' ? !!demoToken : !!identity;
  const verified = config?.authMode === 'demo' ? !!demoToken : !!identity?.verified;
  useEffect(() => {
    setMe(null);
    setMeError('');
    if (authReady && signedIn && verified) void refreshMe().catch(() => {});
    else {
      generation.current++;
      setLoadingMe(false);
    }
  }, [authReady, signedIn, verified, demoToken, identity?.user.uid, refreshMe]);

  const requireFirebase = () => {
    if (!firebase) throw new Error('University login is not available in local demo mode.');
    return firebase;
  };
  const validateEmail = (email: string) => {
    const normalized = email.trim().toLowerCase();
    const parts = normalized.split('@');
    if (
      parts.length !== 2 ||
      !parts[0] ||
      /\s/.test(normalized) ||
      parts[1] !== (config?.allowedEmailDomain ?? 'szabist-isb.pk')
    ) {
      throw new Error(
        `Use your @${config?.allowedEmailDomain ?? 'szabist-isb.pk'} university email address.`,
      );
    }
    return normalized;
  };
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
    request,
    refreshMe,
    demoLogin: async (persona) => {
      const { token } = await fetchJson<{ token: string }>('/demo/session', {
        method: 'POST',
        body: JSON.stringify({ persona }),
      });
      sessionStorage.setItem(DEMO_TOKEN_KEY, token);
      setDemoToken(token);
    },
    login: async (email, password) => {
      await signInWithEmailAndPassword(requireFirebase(), validateEmail(email), password);
    },
    register: async (name, email, password) => {
      if (password.length < 12)
        throw new Error('Choose an app password with at least 12 characters.');
      const result = await createUserWithEmailAndPassword(
        requireFirebase(),
        validateEmail(email),
        password,
      );
      await updateProfile(result.user, { displayName: name.trim() });
      await sendEmailVerification(result.user);
    },
    resetPassword: async (email) => {
      await sendPasswordResetEmail(requireFirebase(), validateEmail(email));
    },
    resendVerification: async () => {
      if (!identity?.user) throw new Error('Sign in first.');
      await sendEmailVerification(identity.user);
    },
    refreshVerification: async () => {
      if (!identity?.user) return false;
      await identity.user.reload();
      await identity.user.getIdToken(true);
      setIdentity({ user: identity.user, verified: identity.user.emailVerified });
      return identity.user.emailVerified;
    },
    logout: async () => {
      generation.current++;
      sessionStorage.removeItem(DEMO_TOKEN_KEY);
      setDemoToken('');
      setMe(null);
      setMeError('');
      if (firebase) await signOut(firebase);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing.');
  return value;
}
