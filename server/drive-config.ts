import { isLoopbackHost, type AppConfig } from './config.js';

export const DRIVE_CALLBACK_PATH = '/oauth/google-drive/callback';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_SCOPES = ['openid', 'email', DRIVE_SCOPE] as const;

export interface DriveConfig {
  enabled: boolean;
  resourceDestination: 'drive' | 'base';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  returnUrl: string;
  encryptionKey: Buffer | null;
  baseLimitBytes: number;
}

export function loadDriveConfig(app: AppConfig, env: NodeJS.ProcessEnv = process.env): DriveConfig {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() || '';
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || '';
  const redirectUri = env.GOOGLE_DRIVE_REDIRECT_URI?.trim() || '';
  const encodedKey = env.DRIVE_TOKEN_ENCRYPTION_KEY?.trim() || '';
  const provided = [clientId, clientSecret, redirectUri, encodedKey].filter(Boolean).length;
  if (provided && provided !== 4)
    throw new Error(
      'Google Drive requires GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REDIRECT_URI and DRIVE_TOKEN_ENCRYPTION_KEY.',
    );
  const enabled = provided === 4;
  if (enabled && app.authMode === 'demo')
    throw new Error(
      'Google Drive is disabled in local demo mode. Use verified Firebase accounts for cloud storage.',
    );
  const destination = env.RESOURCE_STORAGE || (enabled ? 'drive' : 'base');
  if (!['drive', 'base'].includes(destination))
    throw new Error('RESOURCE_STORAGE must be drive or base.');
  if (destination === 'drive' && !enabled)
    throw new Error('RESOURCE_STORAGE=drive requires the Google Drive OAuth configuration.');
  const limit = Number(env.BASE_STORAGE_LIMIT_MIB || 8192);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_048_576)
    throw new Error('BASE_STORAGE_LIMIT_MIB must be a whole number between 1 and 1048576.');
  const returnUrl = env.DRIVE_RETURN_URL || `${app.allowedOrigins[0]}/account`;
  const finish = new URL(returnUrl);
  if (
    !app.allowedOrigins.includes(finish.origin) ||
    finish.pathname !== '/account' ||
    finish.search ||
    finish.hash ||
    finish.username ||
    finish.password
  )
    throw new Error('DRIVE_RETURN_URL must be /account on an exact ALLOWED_ORIGINS origin.');
  let encryptionKey: Buffer | null = null;
  if (enabled) {
    if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) || clientId.length > 256)
      throw new Error('GOOGLE_DRIVE_CLIENT_ID must be a Google web OAuth client ID.');
    if (clientSecret.length > 512 || /[\u0000-\u0020\u007f]/.test(clientSecret))
      throw new Error('GOOGLE_DRIVE_CLIENT_SECRET is malformed.');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey))
      throw new Error(
        'DRIVE_TOKEN_ENCRYPTION_KEY must be exactly 32 random bytes encoded as standard base64.',
      );
    encryptionKey = Buffer.from(encodedKey, 'base64');
    if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encodedKey)
      throw new Error('DRIVE_TOKEN_ENCRYPTION_KEY must encode exactly 32 random bytes.');
    const callback = new URL(redirectUri);
    if (
      callback.pathname !== DRIVE_CALLBACK_PATH ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash
    )
      throw new Error(
        `GOOGLE_DRIVE_REDIRECT_URI must end at ${DRIVE_CALLBACK_PATH}, without query parameters.`,
      );
    if (
      app.nodeEnv === 'production'
        ? callback.protocol !== 'https:'
        : callback.protocol !== 'https:' &&
          !(callback.protocol === 'http:' && isLoopbackHost(callback.hostname))
    )
      throw new Error(
        'Google Drive callbacks require HTTPS (loopback HTTP is permitted only for development).',
      );
    if (
      callback.hostname !== finish.hostname ||
      callback.protocol !== finish.protocol ||
      (app.nodeEnv === 'production' && callback.origin !== finish.origin)
    )
      throw new Error(
        'The Drive callback and app must use the same host and scheme; production requires the same origin for the secure browser-binding cookie.',
      );
  }
  return {
    enabled,
    resourceDestination: destination as 'drive' | 'base',
    clientId,
    clientSecret,
    redirectUri,
    returnUrl: finish.href,
    encryptionKey,
    baseLimitBytes: limit * 1024 * 1024,
  };
}
