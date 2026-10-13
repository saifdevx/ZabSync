/** Checkpoint 4 migration 9. Subject chat is relational text; private binary storage stays separate. */
export const chatMigration = [
  `CREATE TABLE IF NOT EXISTS subject_chat_settings (
    subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
    mode TEXT NOT NULL DEFAULT 'admins' CHECK(mode IN ('members','admins')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS subject_chat_messages (
    id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), user_id TEXT NOT NULL REFERENCES users(id),
    client_key TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body)<=2000), resource_id TEXT REFERENCES resources(id),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted_at TEXT, deleted_by TEXT REFERENCES users(id), UNIQUE(subject_id,user_id,client_key)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_subject_cursor ON subject_chat_messages(subject_id,created_at DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS subject_chat_mutes (
    subject_id TEXT NOT NULL REFERENCES subjects(id), user_id TEXT NOT NULL REFERENCES users(id),
    muted_until TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL REFERENCES users(id), updated_at TEXT NOT NULL,
    PRIMARY KEY(subject_id,user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS subject_chat_reports (
    message_id TEXT NOT NULL REFERENCES subject_chat_messages(id), reporter_id TEXT NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL CHECK(length(reason)<=500), created_at TEXT NOT NULL,
    resolved_at TEXT, resolved_by TEXT REFERENCES users(id), PRIMARY KEY(message_id,reporter_id)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_reports_open ON subject_chat_reports(message_id,resolved_at)`,
  `CREATE TABLE IF NOT EXISTS chat_write_windows (
    user_id TEXT NOT NULL REFERENCES users(id), bucket TEXT NOT NULL, writes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,bucket)
  )`,
  `CREATE INDEX IF NOT EXISTS chat_write_windows_expiry ON chat_write_windows(bucket)`,
];
