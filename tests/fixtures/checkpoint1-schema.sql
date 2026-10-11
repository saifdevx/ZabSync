-- Frozen schema generated from the delivered Checkpoint 1 migration runner.
-- Kept as SQL so upgrade tests never import a previous checkpoint or sibling folder.

CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','master')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    identity_source TEXT NOT NULL CHECK (identity_source IN ('demo','firebase')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );

CREATE UNIQUE INDEX one_master_admin ON users(role) WHERE role = 'master';

CREATE TABLE classes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, program TEXT NOT NULL, semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 12),
    section TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
  );

CREATE TABLE memberships (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','cr','gr')),
    status TEXT NOT NULL CHECK (status IN ('pending','active','rejected','removed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id), requested_at TEXT,
    UNIQUE (class_id, user_id)
  );

CREATE UNIQUE INDEX one_class_cr ON memberships(class_id) WHERE role = 'cr' AND status = 'active';

CREATE UNIQUE INDEX one_class_gr ON memberships(class_id) WHERE role = 'gr' AND status = 'active';

CREATE INDEX memberships_user_status ON memberships(user_id, status, class_id);

CREATE INDEX memberships_class_status ON memberships(class_id, status, created_at);

CREATE TABLE class_requests (
    id TEXT PRIMARY KEY, requester_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, program TEXT NOT NULL,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 12), section TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    review_note TEXT, reviewed_by TEXT REFERENCES users(id), class_id TEXT REFERENCES classes(id),
    created_at TEXT NOT NULL, reviewed_at TEXT
  );

CREATE INDEX class_requests_requester ON class_requests(requester_id, created_at);

CREATE INDEX class_requests_status ON class_requests(status, created_at);

CREATE TABLE class_invites (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL UNIQUE REFERENCES classes(id), code_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
  );

CREATE TABLE demo_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  );

CREATE INDEX demo_sessions_expiration ON demo_sessions(expires_at);

CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );

CREATE INDEX audit_logs_created ON audit_logs(created_at DESC);

CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX memberships_request_history ON memberships(user_id, requested_at DESC) WHERE requested_at IS NOT NULL;

INSERT INTO schema_migrations(version,applied_at) VALUES (1,'2026-10-10T00:00:00.000Z'),(2,'2026-10-10T00:00:00.000Z');
