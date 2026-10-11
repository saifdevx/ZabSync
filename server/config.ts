import 'dotenv/config';
import { z } from 'zod';

export const ALLOWED_EMAIL_DOMAIN = 'szabist-isb.pk';
export const UNIVERSITY_TIMEZONE = 'Asia/Karachi';

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  authMode: 'demo' | 'firebase';
  host: string;
  port: number;
  databaseUrl: string;
  databaseAuthToken?: string;
  allowedOrigins: string[];
  masterAdminEmail: string | null;
  firebase: FirebasePublicConfig | null;
  firebaseAdminCredential: { projectId: string; clientEmail: string; privateKey: string } | null;
  firebaseUseApplicationDefault: boolean;
  appName: string;
  universityUrl: string;
  timezone: typeof UNIVERSITY_TIMEZONE;
}

export function isLoopbackHost(host: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'ALLOWED_ORIGINS must contain complete HTTP(S) origins without paths or wildcards.',
    );
  }
  return url.origin;
}

export function validateConfig(
  config: AppConfig,
  options: { allowInjectedTestIdentity?: boolean } = {},
): AppConfig {
  if (!['development', 'test', 'production'].includes(config.nodeEnv))
    throw new Error('Invalid NODE_ENV.');
  if (!['demo', 'firebase'].includes(config.authMode))
    throw new Error('AUTH_MODE must be demo or firebase.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');
  if (config.databaseUrl.startsWith('turso:')) {
    throw new Error(
      'This checkpoint uses @libsql/client. Choose a libSQL-compatible Turso database and libsql:// URL; turso:// engine URLs need a different driver.',
    );
  }
  if (
    !['file:', 'libsql:', 'https:', 'http:'].some((prefix) => config.databaseUrl.startsWith(prefix))
  ) {
    throw new Error('DATABASE_URL must be a local file: URL or a libSQL-compatible database URL.');
  }
  if (config.databaseUrl.startsWith('libsql:') && !config.databaseAuthToken) {
    throw new Error('DATABASE_AUTH_TOKEN is required for a remote Turso database.');
  }
  if (!config.allowedOrigins.length)
    throw new Error('At least one ALLOWED_ORIGINS value is required.');
  const allowedOrigins = [...new Set(config.allowedOrigins.map(normalizeOrigin))];
  if (config.authMode === 'demo') {
    if (config.nodeEnv === 'production')
      throw new Error('Demo authentication is forbidden in production.');
    if (!isLoopbackHost(config.host))
      throw new Error('Demo authentication must bind to localhost or a loopback address.');
    if (allowedOrigins.some((origin) => !isLoopbackHost(new URL(origin).hostname))) {
      throw new Error('Demo authentication accepts only loopback origins.');
    }
    if (!config.databaseUrl.startsWith('file:'))
      throw new Error('Demo authentication requires a local SQLite database.');
  }
  const masterAdminEmail = config.masterAdminEmail?.trim().toLowerCase() || null;
  if (
    masterAdminEmail &&
    (!z.email().safeParse(masterAdminEmail).success ||
      masterAdminEmail.split('@')[1] !== ALLOWED_EMAIL_DOMAIN)
  ) {
    throw new Error(`MASTER_ADMIN_EMAIL must be an exact @${ALLOWED_EMAIL_DOMAIN} address.`);
  }
  if (config.authMode === 'firebase') {
    const publicConfig = config.firebase;
    if (
      !publicConfig ||
      !publicConfig.apiKey ||
      !publicConfig.authDomain ||
      !publicConfig.projectId ||
      !publicConfig.appId
    ) {
      throw new Error(
        'Firebase mode requires FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, and FIREBASE_APP_ID.',
      );
    }
    if (!/^[A-Za-z0-9.-]+$/.test(publicConfig.authDomain))
      throw new Error('FIREBASE_AUTH_DOMAIN must be a hostname.');
    if (!options.allowInjectedTestIdentity) {
      if (!config.firebaseAdminCredential && !config.firebaseUseApplicationDefault) {
        throw new Error(
          'Firebase mode requires FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or FIREBASE_USE_APPLICATION_DEFAULT=true.',
        );
      }
      if (
        config.firebaseAdminCredential &&
        (!config.firebaseAdminCredential.clientEmail ||
          !config.firebaseAdminCredential.privateKey.includes('PRIVATE KEY'))
      ) {
        throw new Error('Firebase Admin credentials are incomplete or malformed.');
      }
    }
  }
  const universityUrl = new URL(config.universityUrl);
  if (universityUrl.protocol !== 'https:') throw new Error('UNIVERSITY_URL must use HTTPS.');
  if (!config.appName.trim() || config.appName.length > 80)
    throw new Error('APP_NAME must contain 1–80 characters.');
  return { ...config, allowedOrigins, masterAdminEmail, timezone: UNIVERSITY_TIMEZONE };
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AUTH_MODE: z.enum(['demo', 'firebase']).default('demo'),
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().default('file:./data/campus.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  MASTER_ADMIN_EMAIL: z.string().optional(),
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_USE_APPLICATION_DEFAULT: z.enum(['true', 'false']).default('false'),
  APP_NAME: z.string().default('XVIA'),
  UNIVERSITY_URL: z.string().url().default('https://szabist-isb.edu.pk/'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = envSchema.parse(env);
  const firebase =
    e.AUTH_MODE === 'firebase'
      ? {
          apiKey: e.FIREBASE_API_KEY || '',
          authDomain: e.FIREBASE_AUTH_DOMAIN || '',
          projectId: e.FIREBASE_PROJECT_ID || '',
          appId: e.FIREBASE_APP_ID || '',
        }
      : null;
  return validateConfig({
    nodeEnv: e.NODE_ENV,
    authMode: e.AUTH_MODE,
    host: e.HOST || (e.AUTH_MODE === 'demo' ? '127.0.0.1' : '0.0.0.0'),
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databaseAuthToken: e.DATABASE_AUTH_TOKEN,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    masterAdminEmail: e.MASTER_ADMIN_EMAIL || null,
    firebase,
    firebaseAdminCredential:
      e.FIREBASE_CLIENT_EMAIL || e.FIREBASE_PRIVATE_KEY
        ? {
            projectId: e.FIREBASE_PROJECT_ID || '',
            clientEmail: e.FIREBASE_CLIENT_EMAIL || '',
            privateKey: (e.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
          }
        : null,
    firebaseUseApplicationDefault: e.FIREBASE_USE_APPLICATION_DEFAULT === 'true',
    appName: e.APP_NAME,
    universityUrl: e.UNIVERSITY_URL,
    timezone: UNIVERSITY_TIMEZONE,
  });
}

/** Explicit local test configuration. Never selected by a request or environment shortcut. */
export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    authMode: 'demo',
    host: '127.0.0.1',
    port: 3001,
    databaseUrl: 'file::memory:',
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    masterAdminEmail: null,
    firebase:
      overrides.authMode === 'firebase'
        ? {
            apiKey: 'test-public-key',
            authDomain: 'test-project.firebaseapp.com',
            projectId: 'test-project',
            appId: 'test-app',
          }
        : null,
    firebaseAdminCredential: null,
    firebaseUseApplicationDefault: false,
    appName: 'XVIA',
    universityUrl: 'https://szabist-isb.edu.pk/',
    timezone: UNIVERSITY_TIMEZONE,
    ...overrides,
  };
}
