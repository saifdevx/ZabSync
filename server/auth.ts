import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { FastifyRequest } from 'fastify';
import { applicationDefault, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { ALLOWED_EMAIL_DOMAIN, type AppConfig } from './config.js';
import { first, inWriteTransaction, stringValue, type Database, type SqlRow } from './db.js';
import { ApiError, requireCondition } from './errors.js';

export interface VerifiedIdentity {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: 'student' | 'master';
  status: 'active' | 'suspended';
}

export type TokenVerifier = (token: string) => Promise<VerifiedIdentity>;
export type Clock = () => Date;

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function assertUniversityIdentity(identity: VerifiedIdentity): {
  id: string;
  email: string;
  displayName: string;
} {
  requireCondition(
    typeof identity.uid === 'string' && identity.uid.length > 0 && identity.uid.length <= 128,
    401,
    'invalid_identity',
    'The sign-in identity is invalid.',
  );
  requireCondition(
    identity.email_verified === true,
    403,
    'email_not_verified',
    'Verify your university email before continuing.',
  );
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';
  requireCondition(
    email.length <= 254 &&
      z.email().safeParse(email).success &&
      email.split('@')[1] === ALLOWED_EMAIL_DOMAIN,
    403,
    'university_email_required',
    `Use your verified @${ALLOWED_EMAIL_DOMAIN} university email.`,
  );
  const displayName =
    typeof identity.name === 'string' && identity.name.trim()
      ? identity.name.trim().slice(0, 80)
      : email.split('@')[0]!;
  return { id: identity.uid, email, displayName };
}

export function publicUser(row: SqlRow): CurrentUser {
  return {
    id: stringValue(row.id),
    email: stringValue(row.email),
    displayName: stringValue(row.display_name),
    role: row.role === 'master' ? 'master' : 'student',
    status: row.status === 'active' ? 'active' : 'suspended',
  };
}

export async function audit(
  db: Database,
  actorId: string | null,
  action: string,
  targetId: string | null,
  now: Date,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO audit_logs (id,actor_id,action,target_id,details_json,created_at) VALUES (?,?,?,?,?,?)',
    args: [randomUUID(), actorId, action, targetId, JSON.stringify(details), now.toISOString()],
  });
}

export async function ensureIdentityMode(db: Client, mode: 'demo' | 'firebase'): Promise<void> {
  await inWriteTransaction(db, async (tx) => {
    const stored = await first(tx, "SELECT value FROM app_metadata WHERE key = 'identity_mode'");
    const incompatibleUser = await first(
      tx,
      'SELECT id FROM users WHERE identity_source != ? LIMIT 1',
      [mode],
    );
    if ((stored && stored.value !== mode) || incompatibleUser) {
      throw new Error(
        'Authentication mode does not match this database. Use a separate clean database for Firebase and demo identities.',
      );
    }
    await tx.execute({
      sql: "INSERT OR IGNORE INTO app_metadata (key,value) VALUES ('identity_mode',?)",
      args: [mode],
    });
  });
}

export async function createFirebaseVerifier(
  config: AppConfig,
): Promise<{ verify: TokenVerifier; close: () => Promise<void> }> {
  const credential = config.firebaseAdminCredential
    ? cert(config.firebaseAdminCredential)
    : applicationDefault();
  const app = initializeApp(
    { credential, projectId: config.firebase!.projectId },
    `campusdesk-${randomUUID()}`,
  );
  try {
    // Fail startup on invalid or unavailable credentials, rather than accepting traffic with broken authentication.
    await credential.getAccessToken();
  } catch {
    await deleteApp(app);
    throw new Error(
      'Firebase Admin credentials could not be validated. Check the service account, its permissions, and network access.',
    );
  }
  return {
    verify: async (token) => {
      const decoded = await getAuth(app).verifyIdToken(token, true);
      return {
        uid: decoded.uid,
        email: decoded.email,
        email_verified: decoded.email_verified,
        name: decoded.name as string | undefined,
      };
    },
    close: () => deleteApp(app),
  };
}

async function getOrCreateFirebaseUser(
  db: Client,
  identity: VerifiedIdentity,
  config: AppConfig,
  now: Date,
): Promise<CurrentUser> {
  const accepted = assertUniversityIdentity(identity);
  const current = await first(db, 'SELECT * FROM users WHERE id = ?', [accepted.id]);
  if (current) {
    requireCondition(
      current.identity_source === 'firebase',
      401,
      'invalid_identity',
      'This account cannot use this authentication mode.',
    );
    requireCondition(
      current.status === 'active',
      403,
      'account_suspended',
      'This account is suspended. Contact the application owner.',
    );
    const mightBootstrap = accepted.email === config.masterAdminEmail && current.role !== 'master';
    if (current.email === accepted.email && !mightBootstrap) return publicUser(current);
  }
  return inWriteTransaction(db, async (tx) => {
    let user = await first(tx, 'SELECT * FROM users WHERE id = ?', [accepted.id]);
    const sameEmail = await first(tx, 'SELECT id FROM users WHERE email = ? AND id != ?', [
      accepted.email,
      accepted.id,
    ]);
    requireCondition(
      !sameEmail,
      409,
      'identity_conflict',
      'This email belongs to another sign-in identity. Contact the application owner.',
    );
    const stamp = now.toISOString();
    if (!user) {
      await tx.execute({
        sql: 'INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        args: [
          accepted.id,
          accepted.email,
          accepted.displayName,
          'student',
          'active',
          'firebase',
          stamp,
          stamp,
        ],
      });
      await audit(tx, accepted.id, 'account.created', accepted.id, now);
    } else {
      requireCondition(
        user.identity_source === 'firebase' && user.status === 'active',
        403,
        'account_suspended',
        'This account is not active.',
      );
      if (user.email !== accepted.email) {
        await tx.execute({
          sql: 'UPDATE users SET email = ?, updated_at = ? WHERE id = ?',
          args: [accepted.email, stamp, accepted.id],
        });
        await audit(tx, accepted.id, 'account.email_updated', accepted.id, now);
      }
    }
    if (config.masterAdminEmail && accepted.email === config.masterAdminEmail) {
      const existingMaster = await first(tx, "SELECT id FROM users WHERE role = 'master' LIMIT 1");
      if (!existingMaster) {
        await tx.execute({
          sql: "UPDATE users SET role = 'master', updated_at = ? WHERE id = ?",
          args: [stamp, accepted.id],
        });
        await audit(tx, accepted.id, 'owner.bootstrapped', accepted.id, now);
      }
    }
    user = await first(tx, 'SELECT * FROM users WHERE id = ?', [accepted.id]);
    return publicUser(user!);
  });
}

export function createAuthenticator(
  db: Client,
  config: AppConfig,
  now: Clock,
  verifyFirebaseToken?: TokenVerifier,
) {
  return async function authenticate(request: FastifyRequest): Promise<CurrentUser> {
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string' ? /^Bearer ([^\s]{1,8192})$/.exec(authorization) : null;
    requireCondition(match, 401, 'authentication_required', 'Sign in to continue.');
    const token = match[1]!;
    if (config.authMode === 'demo') {
      requireCondition(
        token.startsWith('demo_'),
        401,
        'invalid_token',
        'This session is invalid or has expired.',
      );
      const row = await first(
        db,
        `SELECT u.* FROM demo_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.identity_source = 'demo'`,
        [hashSecret(token), now().toISOString()],
      );
      requireCondition(row, 401, 'invalid_token', 'This session is invalid or has expired.');
      requireCondition(
        row.status === 'active',
        403,
        'account_suspended',
        'This account is suspended. Contact the application owner.',
      );
      return publicUser(row);
    }
    requireCondition(
      !token.startsWith('demo_'),
      401,
      'invalid_token',
      'Demo sessions are not accepted here.',
    );
    let identity: VerifiedIdentity;
    try {
      identity = await verifyFirebaseToken!(token);
    } catch {
      throw new ApiError(
        401,
        'invalid_token',
        'Your sign-in has expired or is invalid. Sign in again.',
      );
    }
    return getOrCreateFirebaseUser(db, identity, config, now());
  };
}

export async function createDemoSession(db: Client, userId: string, now: Date): Promise<string> {
  const token = `demo_${randomBytes(32).toString('base64url')}`;
  await inWriteTransaction(db, async (tx) => {
    const user = await first(
      tx,
      "SELECT id FROM users WHERE id = ? AND status = 'active' AND identity_source = 'demo'",
      [userId],
    );
    requireCondition(user, 403, 'demo_unavailable', 'This demo persona is not available.');
    await tx.execute({
      sql: 'DELETE FROM demo_sessions WHERE expires_at <= ?',
      args: [now.toISOString()],
    });
    await tx.execute({
      sql: 'INSERT INTO demo_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',
      args: [
        hashSecret(token),
        userId,
        now.toISOString(),
        new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
      ],
    });
  });
  return token;
}
