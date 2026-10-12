-- Frozen schema from the previously delivered Checkpoint 2. Do not regenerate from current migrations.

-- Historical roles and Tutor table are intentional migration inputs, not the Checkpoint 3 policy.

PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','master')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    identity_source TEXT NOT NULL CHECK (identity_source IN ('demo','firebase')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  , username TEXT COLLATE NOCASE, avatar_key TEXT, avatar_version TEXT);

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

CREATE TABLE subjects (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id),
    name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', instructor TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'blue' CHECK(color IN ('blue','teal','purple','amber','rose')),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

CREATE UNIQUE INDEX subjects_active_name ON subjects(class_id,name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE INDEX subjects_class ON subjects(class_id,deleted_at,name);

CREATE TABLE resources (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT REFERENCES subjects(id),
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes > 0), storage_key TEXT NOT NULL UNIQUE,
    storage_state TEXT NOT NULL DEFAULT 'ready' CHECK(storage_state IN ('ready','deleting')),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  );

CREATE INDEX resources_class ON resources(class_id,deleted_at,created_at DESC);

CREATE INDEX resources_subject ON resources(subject_id,deleted_at,created_at DESC);

CREATE TABLE announcements (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('global','class','subject')),
    class_id TEXT REFERENCES classes(id), subject_id TEXT REFERENCES subjects(id),
    title TEXT NOT NULL, body TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','important','urgent')),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    CHECK((scope='global' AND class_id IS NULL AND subject_id IS NULL)
       OR (scope='class' AND class_id IS NOT NULL AND subject_id IS NULL)
       OR (scope='subject' AND class_id IS NOT NULL AND subject_id IS NOT NULL))
  );

CREATE INDEX announcements_class ON announcements(class_id,deleted_at,created_at DESC);

CREATE INDEX announcements_scope ON announcements(scope,deleted_at,pinned,created_at DESC);

CREATE INDEX announcements_subject ON announcements(subject_id,deleted_at,created_at DESC);

CREATE TABLE announcement_resources (
    announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    PRIMARY KEY(announcement_id,resource_id)
  );

CREATE TABLE bookmarks (
    user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('resource','announcement')),
    target_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,kind,target_id)
  );

CREATE INDEX bookmarks_target ON bookmarks(kind,target_id);

CREATE TABLE announcement_reads (
    user_id TEXT NOT NULL REFERENCES users(id), announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL, PRIMARY KEY(user_id,announcement_id)
  );

CREATE UNIQUE INDEX users_unique_username ON users(username) WHERE username IS NOT NULL;

CREATE TABLE site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 1,
    features_json TEXT NOT NULL,
    maintenance_enabled INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_enabled IN (0,1)),
    maintenance_message TEXT NOT NULL DEFAULT 'We are updating XVIA. You can read your classes while changes are paused.',
    updated_at TEXT NOT NULL
  );

CREATE TABLE tutor_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 1,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    title TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
    subjects_json TEXT NOT NULL DEFAULT '[]', contact_label TEXT NOT NULL DEFAULT '',
    contact_url TEXT NOT NULL DEFAULT '', booking_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  );

CREATE TABLE avatar_cleanup_queue (
    object_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  );

INSERT INTO schema_migrations(version,applied_at) VALUES(1,'2026-10-10T09:00:00.000Z');

INSERT INTO schema_migrations(version,applied_at) VALUES(2,'2026-10-10T09:00:00.000Z');

INSERT INTO schema_migrations(version,applied_at) VALUES(3,'2026-10-10T09:00:00.000Z');

INSERT INTO schema_migrations(version,applied_at) VALUES(4,'2026-10-10T09:00:00.000Z');

