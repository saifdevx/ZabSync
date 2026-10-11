/** Additive migration 3; called by the shared migration runner in one write transaction. */
export const academicMigration = [
  `CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id),
    name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', instructor TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'blue' CHECK(color IN ('blue','teal','purple','amber','rose')),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS subjects_active_name ON subjects(class_id,name COLLATE NOCASE) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS subjects_class ON subjects(class_id,deleted_at,name)`,
  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT REFERENCES subjects(id),
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes > 0), storage_key TEXT NOT NULL UNIQUE,
    storage_state TEXT NOT NULL DEFAULT 'ready' CHECK(storage_state IN ('ready','deleting')),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS resources_class ON resources(class_id,deleted_at,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS resources_subject ON resources(subject_id,deleted_at,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK(scope IN ('global','class','subject')),
    class_id TEXT REFERENCES classes(id), subject_id TEXT REFERENCES subjects(id),
    title TEXT NOT NULL, body TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','important','urgent')),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    CHECK((scope='global' AND class_id IS NULL AND subject_id IS NULL)
       OR (scope='class' AND class_id IS NOT NULL AND subject_id IS NULL)
       OR (scope='subject' AND class_id IS NOT NULL AND subject_id IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS announcements_class ON announcements(class_id,deleted_at,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS announcements_scope ON announcements(scope,deleted_at,pinned,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS announcements_subject ON announcements(subject_id,deleted_at,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS announcement_resources (
    announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    PRIMARY KEY(announcement_id,resource_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
    user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('resource','announcement')),
    target_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,kind,target_id)
  )`,
  `CREATE INDEX IF NOT EXISTS bookmarks_target ON bookmarks(kind,target_id)`,
  `CREATE TABLE IF NOT EXISTS announcement_reads (
    user_id TEXT NOT NULL REFERENCES users(id), announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL, PRIMARY KEY(user_id,announcement_id)
  )`,
];
