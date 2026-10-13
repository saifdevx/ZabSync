/** Checkpoint 4, schema version 8. Existing resource keys keep their original destination. */
export const driveMigration = [
  `CREATE TABLE drive_connections (
    user_id TEXT PRIMARY KEY REFERENCES users(id), google_sub TEXT UNIQUE, email TEXT,
    refresh_token_cipher TEXT, scopes TEXT NOT NULL DEFAULT '', folder_id TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('active','reconnect','disconnected')),
    revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE drive_oauth_states (
    state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    browser_hash TEXT NOT NULL, verifier_cipher TEXT NOT NULL, connection_revision INTEGER NOT NULL,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  'CREATE INDEX drive_oauth_states_expiry ON drive_oauth_states(expires_at)',
  'CREATE INDEX drive_oauth_states_user ON drive_oauth_states(user_id)',
  `CREATE TABLE drive_objects (
    object_key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES drive_connections(user_id),
    file_id TEXT NOT NULL UNIQUE, revision_id TEXT, size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
    mime_type TEXT NOT NULL, sha256 TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('uploading','ready','deleting','failed')),
    session_cipher TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX drive_objects_owner ON drive_objects(user_id,state)',
  'CREATE INDEX drive_objects_cleanup ON drive_objects(state,updated_at)',
  `CREATE TABLE base_storage_objects (
    object_key TEXT PRIMARY KEY, size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
    state TEXT NOT NULL CHECK(state IN ('pending','ready','deleting')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `INSERT INTO base_storage_objects(object_key,size_bytes,state,created_at,updated_at)
    SELECT storage_key,size_bytes,CASE WHEN storage_state='deleting' THEN 'deleting' ELSE 'ready' END,created_at,updated_at FROM resources`,
  // Old photos have no byte-size column. Count each at its original input ceiling until replaced/deleted.
  `INSERT OR IGNORE INTO base_storage_objects(object_key,size_bytes,state,created_at,updated_at)
    SELECT avatar_key,2097152,'ready',created_at,updated_at FROM users WHERE avatar_key IS NOT NULL`,
];
