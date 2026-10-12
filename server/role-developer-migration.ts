/** Checkpoint 3 migration 5. Previous migrations remain frozen for safe upgrades. */
export const roleDeveloperMigration = [
  `CREATE TABLE memberships_v5 (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
    status TEXT NOT NULL CHECK (status IN ('pending','active','rejected','removed')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id), requested_at TEXT,
    UNIQUE (class_id,user_id)
  )`,
  `INSERT INTO memberships_v5(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by,requested_at)
   SELECT id,class_id,user_id,CASE WHEN role IN ('cr','gr') THEN 'admin' ELSE 'student' END,
   status,created_at,updated_at,reviewed_by,requested_at FROM memberships`,
  'DROP TABLE memberships',
  'ALTER TABLE memberships_v5 RENAME TO memberships',
  'CREATE INDEX memberships_user_status ON memberships(user_id,status,class_id)',
  'CREATE INDEX memberships_class_status ON memberships(class_id,status,created_at)',
  'CREATE INDEX memberships_request_history ON memberships(user_id,requested_at DESC) WHERE requested_at IS NOT NULL',
  "CREATE INDEX memberships_active_admin ON memberships(user_id,class_id) WHERE role='admin' AND status='active'",
  'CREATE INDEX classes_semester_sections ON classes(status,semester,section,name)',
  `UPDATE site_settings SET features_json=json_set(json_remove(features_json,'$.tutor'),
    '$.developer',json('true'),'$.timetable',json('true'),'$.deadlines',json('true')),
    version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1`,
  `UPDATE site_settings SET maintenance_message='We are updating ZabSync. You can read your classes while changes are paused.'
    WHERE maintenance_message='We are updating XVIA. You can read your classes while changes are paused.'`,
  `CREATE TABLE developer_profile (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1,
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
    title TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '',
    portfolio_url TEXT NOT NULL DEFAULT '', updates_text TEXT NOT NULL DEFAULT '',
    apps_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
  )`,
  // Tutor content remains in its legacy table. No biography, promotions or URLs are copied/published.
  "INSERT INTO developer_profile(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
];
