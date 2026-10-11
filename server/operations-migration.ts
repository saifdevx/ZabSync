/** Additive checkpoint 2 migration, applied exactly once as schema version 4. */
export const operationsMigration = [
  'ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE',
  'ALTER TABLE users ADD COLUMN avatar_key TEXT',
  'ALTER TABLE users ADD COLUMN avatar_version TEXT',
  'CREATE UNIQUE INDEX users_unique_username ON users(username) WHERE username IS NOT NULL',
  `CREATE TABLE site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 1,
    features_json TEXT NOT NULL,
    maintenance_enabled INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_enabled IN (0,1)),
    maintenance_message TEXT NOT NULL DEFAULT 'We are updating XVIA. You can read your classes while changes are paused.',
    updated_at TEXT NOT NULL
  )`,
  `INSERT INTO site_settings(id,version,features_json,maintenance_enabled,maintenance_message,updated_at)
   VALUES (1,1,'{"subjects":true,"resources":true,"announcements":true,"tutor":true,"profilePhotos":true}',0,
   'We are updating XVIA. You can read your classes while changes are paused.',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `CREATE TABLE tutor_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 1,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    title TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
    subjects_json TEXT NOT NULL DEFAULT '[]', contact_label TEXT NOT NULL DEFAULT '',
    contact_url TEXT NOT NULL DEFAULT '', booking_url TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`,
  `INSERT INTO tutor_profile(id,updated_at) VALUES (1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  `CREATE TABLE avatar_cleanup_queue (
    object_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  )`,
];
