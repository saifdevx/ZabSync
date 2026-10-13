import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Client } from '@libsql/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, type Clock, type CurrentUser } from './auth.js';
import { first, inWriteTransaction, numberValue, rows, stringValue, type SqlRow } from './db.js';
import type { AppConfig } from './config.js';
import { ApiError, requireCondition } from './errors.js';
import { requireMaster, type RouteContext } from './routes.js';
import { requireWritable } from './site-settings.js';
import { safeFilename, type PrivateStorage, type StoragePutContext } from './storage.js';
import {
  DRIVE_CALLBACK_PATH,
  DRIVE_SCOPE,
  DRIVE_SCOPES,
  type DriveConfig,
} from './drive-config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const STATE_TTL_MS = 10 * 60_000;
const COOKIE = 'zabsync_drive_binding';
const PROVIDER_JSON_BYTES = 64 * 1024;
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const UPLOAD_FIELDS = 'id,size,mimeType,sha256Checksum,headRevisionId';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function secret(): string {
  return randomBytes(32).toString('base64url');
}
function sameSecret(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** AES-256-GCM with an independent random nonce and purpose/user-bound authenticated data. */
export function encryptDriveSecret(value: string, key: Buffer, purpose: string): string {
  if (key.length !== 32) throw new Error('Drive token key must have 32 bytes.');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`ZabSync:Drive:v1:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptDriveSecret(value: string, key: Buffer, purpose: string): string {
  try {
    const [version, nonce, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || !nonce || !tag || !ciphertext || extra || key.length !== 32)
      throw new Error();
    const iv = Buffer.from(nonce, 'base64url'),
      authTag = Buffer.from(tag, 'base64url');
    if (iv.length !== 12 || authTag.length !== 16) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`ZabSync:Drive:v1:${purpose}`));
    cipher.setAuthTag(authTag);
    return Buffer.concat([
      cipher.update(Buffer.from(ciphertext, 'base64url')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ApiError(
      503,
      'drive_credentials_unavailable',
      'Drive credentials cannot be read. Contact the application owner.',
    );
  }
}

/** A resumable session is a bearer capability. Never follow a provider-supplied arbitrary URL. */
export function validateDriveSessionUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      502,
      'drive_response_invalid',
      'Google Drive returned an invalid upload session.',
    );
  }
  requireCondition(
    url.origin === 'https://www.googleapis.com' &&
      url.pathname === '/upload/drive/v3/files' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.searchParams.get('uploadType') === 'resumable' &&
      Boolean(url.searchParams.get('upload_id')) &&
      value.length <= 4096,
    502,
    'drive_response_invalid',
    'Google Drive returned an invalid upload session.',
  );
  return url.href;
}

async function smallJson(response: Response): Promise<Record<string, unknown>> {
  requireCondition(
    Number(response.headers.get('content-length') || 0) <= PROVIDER_JSON_BYTES,
    502,
    'drive_response_invalid',
    'Google Drive returned an invalid response.',
  );
  if (!response.body) return {};
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      requireCondition(
        size <= PROVIDER_JSON_BYTES,
        502,
        'drive_response_invalid',
        'Google Drive returned an invalid response.',
      );
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) return {};
    const result: unknown = JSON.parse(text);
    requireCondition(
      result !== null && typeof result === 'object' && !Array.isArray(result),
      502,
      'drive_response_invalid',
      'Google Drive returned an invalid response.',
    );
    return result as Record<string, unknown>;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'drive_response_invalid', 'Google Drive returned an invalid response.');
  } finally {
    reader.releaseLock();
  }
}

function providerError(status: number, body: Record<string, unknown> = {}): ApiError {
  const details = JSON.stringify(body).slice(0, PROVIDER_JSON_BYTES);
  if (status === 404)
    return new ApiError(
      404,
      'drive_file_missing',
      'The uploader’s Drive file is unavailable. Ask your Class Admin to restore or upload it again.',
    );
  if (status === 401)
    return new ApiError(
      409,
      'drive_reconnect_required',
      'The uploader needs to reconnect Google Drive in My profile.',
    );
  if (
    status === 403 &&
    /storageQuotaExceeded|teamDriveFileLimitExceeded|activeItemCreationLimitExceeded/.test(details)
  )
    return new ApiError(
      409,
      'drive_storage_full',
      'The connected Google Drive has no space for this upload. Free space there and try again.',
    );
  if (
    status === 429 ||
    status >= 500 ||
    /rateLimitExceeded|downloadQuotaExceeded|userRateLimitExceeded/.test(details)
  )
    return new ApiError(
      503,
      'drive_busy',
      'Google Drive is temporarily busy or has reached a transfer limit. Try again later.',
    );
  return new ApiError(
    409,
    'drive_access_unavailable',
    'Google Drive could not allow this operation. Check the connected account, file permissions and available space.',
  );
}

export interface DriveStatus {
  enabled: boolean;
  resourceDestination: 'drive' | 'base';
  connected: boolean;
  status: 'disabled' | 'active' | 'reconnect' | 'disconnected';
  email: string | null;
  ownedFiles: number;
  ownedBytes: number;
  pendingCleanup: number;
}

export interface DriveService {
  config: DriveConfig;
  status(userId: string): Promise<DriveStatus>;
  begin(actor: CurrentUser): Promise<{ authorizationUrl: string; browserBinding: string }>;
  callback(query: unknown, cookieHeader?: string): Promise<'connected' | 'cancelled'>;
  disconnect(actor: CurrentUser): Promise<{ providerRevoked: boolean; retainedFiles: number }>;
  putFile(
    key: string,
    path: string,
    contentType: string,
    context: StoragePutContext,
  ): Promise<void>;
  open(key: string): ReturnType<PrivateStorage['open']>;
  delete(key: string): Promise<void>;
  hasObject(key: string): Promise<boolean>;
  reserveBase(key: string, size: number): Promise<void>;
  readyBase(key: string): Promise<void>;
  releaseBase(key: string): Promise<void>;
  usage(): Promise<{
    baseUsedBytes: number;
    baseLimitBytes: number;
    basePending: number;
    driveBytes: number;
    driveFiles: number;
    drivePending: number;
  }>;
  cleanupOrphans(
    base: PrivateStorage,
    limit?: number,
  ): Promise<{ removed: number; failed: number }>;
  close(): void;
}

export function createDriveService(options: {
  db: Client;
  config: DriveConfig;
  appConfig: AppConfig;
  now?: Clock;
  /** Explicit unit/integration test seam. Never configurable by URL, request or production environment. */
  fetchForTests?: typeof fetch;
}): DriveService {
  const { db, config, appConfig } = options,
    now = options.now || (() => new Date());
  if (options.fetchForTests && (appConfig.nodeEnv !== 'test' || appConfig.authMode !== 'firebase'))
    throw new Error(
      'Injected Google transport is allowed only in explicitly configured Firebase-mode tests.',
    );
  const providerFetch = options.fetchForTests || fetch;
  const cache = new Map<string, { token: string; expires: number; revision: number }>();
  const refreshes = new Map<string, Promise<{ token: string; revision: number }>>();
  const stamp = () => now().toISOString();
  function enabled() {
    requireCondition(
      config.enabled && config.encryptionKey,
      503,
      'drive_not_configured',
      'Google Drive is not configured yet. Ask the application owner to finish setup.',
    );
  }
  function encrypt(value: string, purpose: string) {
    enabled();
    return encryptDriveSecret(value, config.encryptionKey!, purpose);
  }
  function decrypt(value: string, purpose: string) {
    enabled();
    return decryptDriveSecret(value, config.encryptionKey!, purpose);
  }

  async function call(url: string, init: RequestInit = {}, timeout = 30_000): Promise<Response> {
    try {
      return await providerFetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new ApiError(
        503,
        'drive_unreachable',
        'Could not reach Google Drive. Check your connection and try again.',
      );
    }
  }
  async function markReconnect(userId: string, revision: number) {
    if (cache.get(userId)?.revision === revision) cache.delete(userId);
    await db.execute({
      sql: "UPDATE drive_connections SET status='reconnect',updated_at=? WHERE user_id=? AND revision=? AND status='active'",
      args: [stamp(), userId, revision],
    });
  }
  async function connection(userId: string): Promise<SqlRow> {
    enabled();
    const row = await first(db, 'SELECT * FROM drive_connections WHERE user_id=?', [userId]);
    requireCondition(
      row?.status === 'active' && row.refresh_token_cipher,
      409,
      'drive_reconnect_required',
      'Connect or reconnect Google Drive in My profile before uploading. Existing files need their uploader’s connection.',
    );
    return row;
  }
  async function accessToken(userId: string): Promise<{ token: string; revision: number }> {
    const row = await connection(userId),
      revision = numberValue(row.revision);
    const cached = cache.get(userId);
    if (cached && cached.revision === revision && cached.expires > now().getTime() + 60_000)
      return { token: cached.token, revision: cached.revision };
    const key = `${userId}:${revision}`,
      active = refreshes.get(key);
    if (active) return active;
    const promise = (async () => {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: decrypt(stringValue(row.refresh_token_cipher), `refresh:${userId}`),
      });
      const response = await call(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = await smallJson(response);
      if (!response.ok) {
        if (
          ['invalid_grant', 'invalid_token', 'unauthorized_client'].includes(String(json.error))
        ) {
          await markReconnect(userId, revision);
          throw new ApiError(
            409,
            'drive_reconnect_required',
            'The uploader needs to reconnect Google Drive in My profile.',
          );
        }
        throw providerError(response.status, json);
      }
      const token = tokenResponse.parse(json);
      if (token.scope && !token.scope.split(' ').includes(DRIVE_SCOPE)) {
        await markReconnect(userId, revision);
        throw new ApiError(
          409,
          'drive_scope_required',
          'Reconnect Google Drive and allow ZabSync access to its files.',
        );
      }
      const current = await connection(userId);
      requireCondition(
        numberValue(current.revision) === revision,
        409,
        'drive_connection_changed',
        'The Drive connection changed. Try again.',
      );
      if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
      cache.set(userId, {
        token: token.access_token,
        expires: now().getTime() + token.expires_in * 1000,
        revision,
      });
      return { token: token.access_token, revision };
    })().finally(() => refreshes.delete(key));
    refreshes.set(key, promise);
    return promise;
  }
  async function authorized(
    userId: string,
    url: string,
    init: RequestInit = {},
    timeout = 30_000,
  ): Promise<Response> {
    const token = await accessToken(userId);
    const response = await call(
      url,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          Authorization: `Bearer ${token.token}`,
        },
      },
      timeout,
    );
    if (response.status === 401) {
      // An old in-flight response must never disable a newer successful reconnect.
      await markReconnect(userId, token.revision);
    }
    return response;
  }
  async function checkedJson(
    userId: string,
    url: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await authorized(userId, url, init),
      json = await smallJson(response);
    if (!response.ok) throw providerError(response.status, json);
    return json;
  }
  async function actorStillEligible(userId: string): Promise<CurrentUser> {
    const row = await first(
      db,
      "SELECT * FROM users WHERE id=? AND status='active' AND identity_source='firebase'",
      [userId],
    );
    requireCondition(
      row,
      403,
      'drive_account_ineligible',
      'Sign in with your eligible verified ZabSync account to connect Drive.',
    );
    const actor = {
      id: userId,
      email: stringValue(row.email),
      displayName: stringValue(row.display_name),
      username: null,
      avatarVersion: null,
      rollNumber: null,
      role: row.role === 'master' ? 'master' : 'student',
      status: 'active',
    } as CurrentUser;
    await requireWritable(db, actor);
    return actor;
  }

  const service: DriveService = {
    config,
    async status(userId) {
      const row = await first(db, 'SELECT status,email FROM drive_connections WHERE user_id=?', [
        userId,
      ]);
      const total = await first(
        db,
        "SELECT COUNT(*) AS n,COALESCE(SUM(size_bytes),0) AS bytes,COALESCE(SUM(CASE WHEN state!='ready' THEN 1 ELSE 0 END),0) AS pending FROM drive_objects WHERE user_id=?",
        [userId],
      );
      return {
        enabled: config.enabled,
        resourceDestination: config.resourceDestination,
        connected: config.enabled && row?.status === 'active',
        status: !config.enabled
          ? 'disabled'
          : (row?.status as DriveStatus['status']) || 'disconnected',
        email: row?.email ? stringValue(row.email) : null,
        ownedFiles: numberValue(total?.n),
        ownedBytes: numberValue(total?.bytes),
        pendingCleanup: numberValue(total?.pending),
      };
    },
    async begin(actor) {
      enabled();
      await actorStillEligible(actor.id);
      const state = secret(),
        browserBinding = secret(),
        verifier = secret(),
        stateHash = digest(state),
        date = stamp();
      await inWriteTransaction(db, async (tx) => {
        await tx.execute({
          sql: 'DELETE FROM drive_oauth_states WHERE expires_at<=? OR user_id=?',
          args: [date, actor.id],
        });
        await tx.execute({
          sql: "INSERT OR IGNORE INTO drive_connections(user_id,status,created_at,updated_at) VALUES (?,'disconnected',?,?)",
          args: [actor.id, date, date],
        });
        const row = await first(tx, 'SELECT revision FROM drive_connections WHERE user_id=?', [
          actor.id,
        ]);
        await tx.execute({
          sql: 'INSERT INTO drive_oauth_states(state_hash,user_id,browser_hash,verifier_cipher,connection_revision,expires_at,created_at) VALUES (?,?,?,?,?,?,?)',
          args: [
            stateHash,
            actor.id,
            digest(browserBinding),
            encrypt(verifier, `state:${stateHash}`),
            numberValue(row?.revision),
            new Date(now().getTime() + STATE_TTL_MS).toISOString(),
            date,
          ],
        });
      });
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: DRIVE_SCOPES.join(' '),
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent select_account',
        include_granted_scopes: 'false',
      }).toString();
      return { authorizationUrl: url.href, browserBinding };
    },
    async callback(input, cookieHeader) {
      enabled();
      const query = callbackQuery.parse(input),
        stateHash = digest(query.state);
      const matchingCookies = (cookieHeader || '')
        .split(';')
        .map((p) => p.trim())
        .filter((p) => p.startsWith(`${COOKIE}=`));
      const browser =
        matchingCookies.length === 1 ? matchingCookies[0]!.slice(COOKIE.length + 1) : '';
      requireCondition(
        /^[A-Za-z0-9_-]{43}$/.test(browser),
        400,
        'drive_state_invalid',
        'This Drive connection expired or opened in a different browser. Start again from My profile.',
      );
      const state = await inWriteTransaction(db, async (tx) => {
        const row = await first(tx, 'SELECT * FROM drive_oauth_states WHERE state_hash=?', [
          stateHash,
        ]);
        requireCondition(
          row &&
            stringValue(row.expires_at) > stamp() &&
            sameSecret(stringValue(row.browser_hash), digest(browser)),
          400,
          'drive_state_invalid',
          'This Drive connection expired or opened in a different browser. Start again from My profile.',
        );
        await tx.execute({
          sql: 'DELETE FROM drive_oauth_states WHERE state_hash=?',
          args: [stateHash],
        });
        return row;
      });
      if (query.error) return 'cancelled';
      requireCondition(
        query.code,
        400,
        'drive_code_missing',
        'Google did not return a connection code. Try connecting again.',
      );
      const userId = stringValue(state.user_id),
        actor = await actorStillEligible(userId);
      const response = await call(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
          code: query.code,
          code_verifier: decrypt(stringValue(state.verifier_cipher), `state:${stateHash}`),
        }),
      });
      const json = await smallJson(response);
      if (!response.ok)
        throw new ApiError(
          409,
          'drive_consent_failed',
          'Google Drive could not complete this connection. Start again from My profile.',
        );
      const token = tokenResponse.parse(json);
      requireCondition(
        token.scope?.split(' ').includes(DRIVE_SCOPE),
        409,
        'drive_scope_required',
        'Allow Google Drive file access on the consent screen to connect.',
      );
      const infoResponse = await call(USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      requireCondition(
        infoResponse.ok,
        409,
        'drive_identity_invalid',
        'Google could not confirm this storage account. Connect again.',
      );
      const google = googleIdentity.parse(await smallJson(infoResponse));
      await inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, actor);
        const user = await first(
          tx,
          "SELECT id FROM users WHERE id=? AND status='active' AND identity_source='firebase'",
          [userId],
        );
        requireCondition(
          user,
          403,
          'drive_account_ineligible',
          'This account cannot connect Drive.',
        );
        const current = await first(tx, 'SELECT * FROM drive_connections WHERE user_id=?', [
          userId,
        ]);
        requireCondition(
          current && numberValue(current.revision) === numberValue(state.connection_revision),
          409,
          'drive_connection_changed',
          'A newer connection change already took place. Start again from My profile.',
        );
        const owned = await first(tx, 'SELECT COUNT(*) AS n FROM drive_objects WHERE user_id=?', [
          userId,
        ]);
        requireCondition(
          !current.google_sub || current.google_sub === google.sub || numberValue(owned?.n) === 0,
          409,
          'drive_account_has_files',
          'Reconnect the same Google account while it owns shared files. Replace or remove those files before switching accounts.',
        );
        const other = await first(
          tx,
          'SELECT user_id FROM drive_connections WHERE google_sub=? AND user_id!=?',
          [google.sub, userId],
        );
        requireCondition(
          !other,
          409,
          'drive_account_already_linked',
          'This Google Drive is linked to another ZabSync account. Use that account or choose another Drive.',
        );
        const refreshCipher = token.refresh_token
          ? encrypt(token.refresh_token, `refresh:${userId}`)
          : current.google_sub === google.sub
            ? stringValue(current.refresh_token_cipher)
            : '';
        requireCondition(
          refreshCipher,
          409,
          'drive_refresh_required',
          'Google did not grant ongoing access. Reconnect and accept the requested Drive permission.',
        );
        await tx.execute({
          sql: "UPDATE drive_connections SET google_sub=?,email=?,refresh_token_cipher=?,scopes=?,status='active',revision=revision+1,updated_at=? WHERE user_id=?",
          args: [
            google.sub,
            google.email.toLowerCase(),
            refreshCipher,
            token.scope || '',
            stamp(),
            userId,
          ],
        });
        await audit(tx, userId, 'drive.connected', userId, now(), {
          reconnected: Boolean(current.google_sub),
        });
      });
      cache.delete(userId);
      return 'connected';
    },
    async disconnect(actor) {
      const result = await inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, actor);
        const row = await first(
          tx,
          'SELECT refresh_token_cipher FROM drive_connections WHERE user_id=?',
          [actor.id],
        );
        const total = await first(tx, 'SELECT COUNT(*) AS n FROM drive_objects WHERE user_id=?', [
          actor.id,
        ]);
        await tx.execute({
          sql: "UPDATE drive_connections SET refresh_token_cipher=NULL,status='disconnected',revision=revision+1,updated_at=? WHERE user_id=?",
          args: [stamp(), actor.id],
        });
        await tx.execute({
          sql: 'DELETE FROM drive_oauth_states WHERE user_id=?',
          args: [actor.id],
        });
        await audit(tx, actor.id, 'drive.disconnected', actor.id, now(), {
          retainedFiles: numberValue(total?.n),
        });
        return {
          cipher: row?.refresh_token_cipher ? stringValue(row.refresh_token_cipher) : null,
          retainedFiles: numberValue(total?.n),
        };
      });
      cache.delete(actor.id);
      let providerRevoked = !result.cipher;
      if (result.cipher && config.enabled) {
        try {
          const response = await call(
            REVOKE_URL,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ token: decrypt(result.cipher, `refresh:${actor.id}`) }),
            },
            10_000,
          );
          providerRevoked = response.ok;
          await response.body?.cancel();
        } catch {
          /* Local access is removed even if Google's revocation endpoint cannot be reached. */
        }
      }
      return { providerRevoked, retainedFiles: result.retainedFiles };
    },
    async putFile(key, path, contentType, context) {
      requireCondition(
        /^resources\/[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(key),
        400,
        'invalid_storage_key',
        'Invalid resource destination.',
      );
      const actor = await actorStillEligible(context.userId),
        conn = await connection(actor.id),
        info = await stat(path);
      requireCondition(
        info.isFile() && info.size > 0,
        400,
        'invalid_file',
        'Choose a non-empty resource file.',
      );
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const checksum = hash.digest('hex');
      const generated = await checkedJson(
        actor.id,
        `${FILES_URL}/generateIds?count=1&space=drive&type=files`,
      );
      const fileId = z.object({ ids: z.array(z.string().regex(ID)).length(1) }).parse(generated)
        .ids[0]!;
      await inWriteTransaction(db, async (tx) => {
        const current = await first(
          tx,
          'SELECT revision,status FROM drive_connections WHERE user_id=?',
          [actor.id],
        );
        requireCondition(
          current?.status === 'active' && current.revision === conn.revision,
          409,
          'drive_connection_changed',
          'The Drive connection changed. Try again.',
        );
        await tx.execute({
          sql: "INSERT INTO drive_objects(object_key,user_id,file_id,size_bytes,mime_type,sha256,state,created_at,updated_at) VALUES (?,?,?,?,?,?,'uploading',?,?)",
          args: [key, actor.id, fileId, info.size, contentType, checksum, stamp(), stamp()],
        });
      });
      try {
        const uploadUrl = new URL(UPLOAD_URL);
        uploadUrl.search = new URLSearchParams({
          uploadType: 'resumable',
          fields: UPLOAD_FIELDS,
          keepRevisionForever: 'true',
          ignoreDefaultVisibility: 'true',
        }).toString();
        const start = await authorized(actor.id, uploadUrl.href, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': contentType,
            'X-Upload-Content-Length': String(info.size),
          },
          body: JSON.stringify({
            id: fileId,
            name: safeFilename(context.filename || key.split('/')[1]!),
            mimeType: contentType,
            description:
              'Shared through ZabSync. Keep this file available until your section no longer needs it.',
            appProperties: { zabsyncKey: key },
          }),
        });
        if (!start.ok) throw providerError(start.status, await smallJson(start));
        const sessionUrl = validateDriveSessionUrl(start.headers.get('location') || '');
        await start.body?.cancel();
        await db.execute({
          sql: 'UPDATE drive_objects SET session_cipher=?,updated_at=? WHERE object_key=?',
          args: [encrypt(sessionUrl, `session:${key}`), stamp(), key],
        });
        // Node fetch streams directly from the bounded private disk spool. No full-file Buffer.
        const body = createReadStream(path);
        let uploaded: Record<string, unknown>;
        try {
          const response = await authorized(
            actor.id,
            sessionUrl,
            {
              method: 'PUT',
              headers: { 'Content-Type': contentType, 'Content-Length': String(info.size) },
              body: body as unknown as RequestInit['body'],
              duplex: 'half',
            } as RequestInit & { duplex: 'half' },
            180_000,
          );
          uploaded = await smallJson(response);
          if (!response.ok) throw providerError(response.status, uploaded);
        } finally {
          body.destroy();
        }
        const file = uploadedFile.parse(uploaded);
        requireCondition(
          file.id === fileId &&
            Number(file.size) === info.size &&
            (!file.sha256Checksum || file.sha256Checksum === checksum) &&
            file.mimeType === contentType,
          502,
          'drive_upload_integrity',
          'The Drive upload could not be verified. Try uploading again.',
        );
        await inWriteTransaction(db, async (tx) => {
          const current = await first(
            tx,
            'SELECT revision,status FROM drive_connections WHERE user_id=?',
            [actor.id],
          );
          requireCondition(
            current?.status === 'active' && current.revision === conn.revision,
            409,
            'drive_connection_changed',
            'The Drive connection changed during upload. Reconnect and retry.',
          );
          await tx.execute({
            sql: "UPDATE drive_objects SET state='ready',revision_id=?,session_cipher=NULL,updated_at=? WHERE object_key=? AND state='uploading'",
            args: [file.headRevisionId, stamp(), key],
          });
        });
      } catch (error) {
        await db
          .execute({
            sql: "UPDATE drive_objects SET state='failed',updated_at=? WHERE object_key=?",
            args: [stamp(), key],
          })
          .catch(() => undefined);
        await service.delete(key).catch(() => undefined);
        throw error;
      }
    },
    async open(key) {
      const row = await first(db, 'SELECT * FROM drive_objects WHERE object_key=?', [key]);
      requireCondition(
        row?.state === 'ready' && row.revision_id,
        404,
        'file_unavailable',
        'This file is temporarily unavailable.',
      );
      const userId = stringValue(row.user_id),
        fileId = stringValue(row.file_id),
        revisionId = stringValue(row.revision_id);
      requireCondition(
        ID.test(fileId) && ID.test(revisionId),
        503,
        'drive_mapping_invalid',
        'The resource needs the application owner’s attention.',
      );
      const metadata = await checkedJson(
        userId,
        `${FILES_URL}/${fileId}?fields=id,size,mimeType,sha256Checksum,headRevisionId,trashed,capabilities(canDownload)`,
      );
      requireCondition(
        metadata.trashed !== true &&
          (metadata.capabilities as { canDownload?: boolean } | undefined)?.canDownload === true,
        409,
        'drive_file_unavailable',
        'The uploader’s Drive file is unavailable or downloads are disabled. Ask your Class Admin to restore it.',
      );
      requireCondition(
        metadata.headRevisionId === revisionId &&
          (metadata.sha256Checksum === undefined || metadata.sha256Checksum === row.sha256) &&
          Number(metadata.size) === numberValue(row.size_bytes) &&
          metadata.mimeType === row.mime_type,
        409,
        'drive_file_changed',
        'This file was changed directly in Google Drive. Ask your Class Admin to upload the updated file through ZabSync.',
      );
      // Pin the immutable revision rather than race a metadata check against the latest file bytes.
      const response = await authorized(
        userId,
        `${FILES_URL}/${fileId}/revisions/${revisionId}?alt=media`,
        {},
        180_000,
      );
      if (!response.ok) throw providerError(response.status, await smallJson(response));
      requireCondition(
        response.body,
        502,
        'drive_response_invalid',
        'Google Drive returned no file data.',
      );
      const expected = numberValue(row.size_bytes),
        source = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
      let received = 0;
      const bound = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          callback(
            received > expected ? new Error('Drive file exceeded its stored size.') : null,
            received <= expected ? chunk : undefined,
          );
        },
        flush(callback) {
          callback(received === expected ? null : new Error('Drive file download was incomplete.'));
        },
      });
      source.on('error', (error) => bound.destroy(error));
      bound.on('close', () => source.destroy());
      source.pipe(bound);
      return { stream: bound, size: expected, contentType: stringValue(row.mime_type) };
    },
    async delete(key) {
      const row = await first(db, 'SELECT * FROM drive_objects WHERE object_key=?', [key]);
      if (!row) return;
      await db.execute({
        sql: "UPDATE drive_objects SET state='deleting',updated_at=? WHERE object_key=?",
        args: [stamp(), key],
      });
      const userId = stringValue(row.user_id),
        fileId = stringValue(row.file_id);
      requireCondition(
        ID.test(fileId),
        503,
        'drive_mapping_invalid',
        'The resource needs the application owner’s attention.',
      );
      // Cancel any incomplete resumable session before deleting its reserved file ID.
      if (row.session_cipher) {
        const session = validateDriveSessionUrl(
          decrypt(stringValue(row.session_cipher), `session:${key}`),
        );
        const cancelled = await authorized(userId, session, { method: 'DELETE' });
        if (![200, 204, 404, 410, 499].includes(cancelled.status))
          throw providerError(cancelled.status, await smallJson(cancelled));
        await cancelled.body?.cancel();
      }
      const response = await authorized(userId, `${FILES_URL}/${fileId}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404)
        throw providerError(response.status, await smallJson(response));
      await response.body?.cancel();
      await db.execute({ sql: 'DELETE FROM drive_objects WHERE object_key=?', args: [key] });
    },
    async hasObject(key) {
      return Boolean(
        await first(db, 'SELECT object_key FROM drive_objects WHERE object_key=?', [key]),
      );
    },
    async reserveBase(key, size) {
      requireCondition(
        Number.isSafeInteger(size) && size > 0,
        400,
        'invalid_file',
        'Choose a non-empty file.',
      );
      await inWriteTransaction(db, async (tx) => {
        const used = await first(
          tx,
          'SELECT COALESCE(SUM(size_bytes),0) AS n FROM base_storage_objects',
        );
        requireCondition(
          numberValue(used?.n) + size <= config.baseLimitBytes,
          409,
          'base_storage_quota',
          'Application storage has reached its limit. Ask the owner to remove unneeded files or raise the budget.',
        );
        await tx.execute({
          sql: "INSERT INTO base_storage_objects(object_key,size_bytes,state,created_at,updated_at) VALUES (?,?,'pending',?,?)",
          args: [key, size, stamp(), stamp()],
        });
      });
    },
    async readyBase(key) {
      await db.execute({
        sql: "UPDATE base_storage_objects SET state='ready',updated_at=? WHERE object_key=?",
        args: [stamp(), key],
      });
    },
    async releaseBase(key) {
      await db.execute({ sql: 'DELETE FROM base_storage_objects WHERE object_key=?', args: [key] });
    },
    async usage() {
      const base = await first(
        db,
        "SELECT COALESCE(SUM(size_bytes),0) AS bytes,COALESCE(SUM(CASE WHEN state!='ready' THEN 1 ELSE 0 END),0) AS pending FROM base_storage_objects",
      );
      const drive = await first(
        db,
        "SELECT COUNT(*) AS n,COALESCE(SUM(size_bytes),0) AS bytes,COALESCE(SUM(CASE WHEN state!='ready' THEN 1 ELSE 0 END),0) AS pending FROM drive_objects",
      );
      return {
        baseUsedBytes: numberValue(base?.bytes),
        baseLimitBytes: config.baseLimitBytes,
        basePending: numberValue(base?.pending),
        driveBytes: numberValue(drive?.bytes),
        driveFiles: numberValue(drive?.n),
        drivePending: numberValue(drive?.pending),
      };
    },
    async cleanupOrphans(base, limit = 10) {
      requireCondition(
        Number.isInteger(limit) && limit >= 1 && limit <= 50,
        400,
        'invalid_cleanup_limit',
        'Cleanup handles between 1 and 50 files at a time.',
      );
      const cutoff = new Date(now().getTime() - 60 * 60_000).toISOString();
      const objects = await rows(
        db,
        `SELECT object_key,'drive' AS provider FROM drive_objects d WHERE updated_at<? AND NOT EXISTS(SELECT 1 FROM resources r WHERE r.storage_key=d.object_key)
        UNION ALL SELECT object_key,'base' AS provider FROM base_storage_objects b WHERE updated_at<? AND NOT EXISTS(SELECT 1 FROM resources r WHERE r.storage_key=b.object_key) AND NOT EXISTS(SELECT 1 FROM users u WHERE u.avatar_key=b.object_key) LIMIT ?`,
        [cutoff, cutoff, limit],
      );
      let removed = 0,
        failed = 0;
      for (const row of objects) {
        const key = stringValue(row.object_key);
        try {
          if (row.provider === 'drive') await service.delete(key);
          else {
            await base.delete(key);
            await service.releaseBase(key);
          }
          removed++;
        } catch {
          failed++;
        }
      }
      return { removed, failed };
    },
    close() {
      cache.clear();
      refreshes.clear();
    },
  };
  return service;
}

const tokenResponse = z.object({
  access_token: z.string().min(1).max(4096),
  token_type: z.string().refine((v) => v.toLowerCase() === 'bearer'),
  expires_in: z.coerce.number().int().min(1).max(86_400),
  scope: z.string().max(8000).optional(),
  refresh_token: z.string().min(1).max(4096).optional(),
});
const googleIdentity = z.object({
  sub: z.string().regex(ID),
  email: z.email().max(254),
  email_verified: z.literal(true),
});
const uploadedFile = z.object({
  id: z.string().regex(ID),
  size: z.string().regex(/^\d+$/),
  mimeType: z.string().max(150),
  sha256Checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  headRevisionId: z.string().regex(ID),
});
const callbackQuery = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(2048).optional(),
    error: z.string().max(100).optional(),
  })
  .passthrough();

/** Existing objects route from their persisted map, never from today's default destination. */
export function createHybridStorage(base: PrivateStorage, drive: DriveService): PrivateStorage {
  return {
    async putFile(key, path, contentType, context) {
      requireCondition(
        /^(resources|avatars)\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,8})?$/.test(key),
        400,
        'invalid_storage_key',
        'Invalid private storage key.',
      );
      if (key.startsWith('resources/') && drive.config.resourceDestination === 'drive') {
        requireCondition(
          context?.userId,
          400,
          'drive_uploader_required',
          'The resource uploader is missing.',
        );
        await drive.putFile(key, path, contentType, context);
        return;
      }
      const info = await stat(path);
      await drive.reserveBase(key, info.size);
      try {
        await base.putFile(key, path, contentType, context);
        await drive.readyBase(key);
      } catch (error) {
        // Keep a reservation if object deletion fails; an orphan stays visible to cleanup/accounting.
        try {
          await base.delete(key);
          await drive.releaseBase(key);
        } catch {
          /* retry using owner cleanup */
        }
        throw error;
      }
    },
    async open(key) {
      return (await drive.hasObject(key)) ? drive.open(key) : base.open(key);
    },
    async delete(key) {
      if (await drive.hasObject(key)) await drive.delete(key);
      else {
        await base.delete(key);
        await drive.releaseBase(key);
      }
    },
    async close() {
      drive.close();
      await base.close?.();
    },
  };
}

export function registerDriveRoutes(
  app: FastifyInstance,
  context: RouteContext,
  drive: DriveService,
  baseStorage?: PrivateStorage,
): void {
  const { authenticate, db, now } = context;
  app.get('/api/drive/status', async (request) => {
    const actor = await authenticate(request);
    return drive.status(actor.id);
  });
  app.post(
    '/api/drive/connect',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      z.object({})
        .strict()
        .parse(request.body ?? {});
      const actor = await authenticate(request);
      await requireWritable(db, actor);
      const started = await drive.begin(actor);
      reply.header(
        'Set-Cookie',
        `${COOKIE}=${started.browserBinding}; Path=${DRIVE_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=600${drive.config.redirectUri.startsWith('https:') ? '; Secure' : ''}`,
      );
      return { authorizationUrl: started.authorizationUrl };
    },
  );
  app.get(
    DRIVE_CALLBACK_PATH,
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          allowList: () => false,
          keyGenerator: (request) => `drive-callback:${request.ip}`,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      let result: string;
      try {
        result = await drive.callback(request.query, request.headers.cookie);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'drive_connection_failed';
        result = [
          'drive_state_invalid',
          'drive_account_has_files',
          'drive_account_already_linked',
          'drive_scope_required',
          'drive_refresh_required',
          'drive_connection_changed',
        ].includes(code)
          ? code
          : 'drive_connection_failed';
      }
      reply.header(
        'Set-Cookie',
        `${COOKIE}=; Path=${DRIVE_CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${drive.config.redirectUri.startsWith('https:') ? '; Secure' : ''}`,
      );
      const destination = new URL(drive.config.returnUrl);
      destination.searchParams.set('drive', result);
      return reply.redirect(destination.href, 303);
    },
  );
  app.post('/api/drive/disconnect', async (request) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(request.body);
    const actor = await authenticate(request);
    return drive.disconnect(actor);
  });
  app.get('/api/admin/storage/usage', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    return {
      ...(await drive.usage()),
      resourceDestination: drive.config.resourceDestination,
      driveEnabled: drive.config.enabled,
    };
  });
  if (baseStorage)
    app.post(
      '/api/admin/storage/cleanup',
      { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
      async (request) => {
        const actor = await authenticate(request);
        await requireMaster(db, actor);
        const form = z
          .object({ confirm: z.literal(true), limit: z.number().int().min(1).max(50).default(10) })
          .strict()
          .parse(request.body);
        const result = await drive.cleanupOrphans(baseStorage, form.limit);
        await audit(db, actor.id, 'storage.orphans_cleaned', null, now(), result);
        return result;
      },
    );
}
