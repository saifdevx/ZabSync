import {
  createClient,
  type Client,
  type InValue,
  type Row,
  type Transaction,
} from '@libsql/client';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Database = Pick<Client, 'execute'>;
export type SqlRow = Row;

const migrationOne = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','master')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    identity_source TEXT NOT NULL CHECK (identity_source IN ('demo','firebase')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_master_admin ON users(role) WHERE role = 'master'`,
  `CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, program TEXT NOT NULL, semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 12),
    section TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','cr','gr')),
    status TEXT NOT NULL CHECK (status IN ('pending','active','rejected','removed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id),
    UNIQUE (class_id, user_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_class_cr ON memberships(class_id) WHERE role = 'cr' AND status = 'active'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_class_gr ON memberships(class_id) WHERE role = 'gr' AND status = 'active'`,
  `CREATE INDEX IF NOT EXISTS memberships_user_status ON memberships(user_id, status, class_id)`,
  `CREATE INDEX IF NOT EXISTS memberships_class_status ON memberships(class_id, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS class_requests (
    id TEXT PRIMARY KEY, requester_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, program TEXT NOT NULL,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 12), section TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    review_note TEXT, reviewed_by TEXT REFERENCES users(id), class_id TEXT REFERENCES classes(id),
    created_at TEXT NOT NULL, reviewed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS class_requests_requester ON class_requests(requester_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS class_requests_status ON class_requests(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS class_invites (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL UNIQUE REFERENCES classes(id), code_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS demo_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS demo_sessions_expiration ON demo_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_logs_created ON audit_logs(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

export async function openDatabase(url: string, authToken?: string): Promise<Client> {
  if (url.startsWith('file:') && !url.includes(':memory:')) {
    const filePath = url.startsWith('file://') ? fileURLToPath(url) : resolve(url.slice(5));
    await mkdir(dirname(filePath), { recursive: true });
  }
  return createClient({ url, authToken, intMode: 'number' });
}

export async function migrate(db: Client): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  await inWriteTransaction(db, async (tx) => {
    const existing = await first(tx, 'SELECT version FROM schema_migrations WHERE version = 1');
    if (!existing) {
      for (const sql of migrationOne) await tx.execute(sql);
      await tx.execute({
        sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)',
        args: [new Date().toISOString()],
      });
    }
    const historyMigration = await first(
      tx,
      'SELECT version FROM schema_migrations WHERE version = 2',
    );
    if (!historyMigration) {
      await tx.execute('ALTER TABLE memberships ADD COLUMN requested_at TEXT');
      // Existing audit evidence distinguishes genuine join requests from seeded/owner-created membership.
      await tx.execute(`UPDATE memberships SET requested_at = (
        SELECT MAX(a.created_at) FROM audit_logs a WHERE a.action = 'membership.requested' AND a.target_id = memberships.id
      ) WHERE EXISTS (
        SELECT 1 FROM audit_logs a WHERE a.action = 'membership.requested' AND a.target_id = memberships.id
      )`);
      await tx.execute(
        "UPDATE memberships SET requested_at = created_at WHERE requested_at IS NULL AND status IN ('pending','rejected')",
      );
      await tx.execute(
        'CREATE INDEX IF NOT EXISTS memberships_request_history ON memberships(user_id, requested_at DESC) WHERE requested_at IS NOT NULL',
      );
      await tx.execute({
        sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)',
        args: [new Date().toISOString()],
      });
    }
  });
}

export async function first(
  db: Database,
  sql: string,
  args: InValue[] = [],
): Promise<Row | undefined> {
  return (await db.execute({ sql, args })).rows[0];
}

export async function rows(db: Database, sql: string, args: InValue[] = []): Promise<Row[]> {
  return (await db.execute({ sql, args })).rows;
}

export async function inWriteTransaction<T>(
  db: Client,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = await db.transaction('write');
  try {
    const result = await action(tx);
    await tx.commit();
    return result;
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

export function stringValue(value: unknown): string {
  return String(value ?? '');
}
export function numberValue(value: unknown): number {
  return Number(value ?? 0);
}
