/** Checkpoint 4 migration 10. Durable jobs and inbox are the source of truth; push is optional delivery. */
export const reminderMigration = [
  `CREATE TABLE IF NOT EXISTS deadline_reminder_preferences (
    user_id TEXT NOT NULL REFERENCES users(id), deadline_id TEXT NOT NULL REFERENCES deadlines(id),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), offset_minutes INTEGER NOT NULL DEFAULT 60 CHECK(offset_minutes IN (0,15,60,1440)),
    updated_at TEXT NOT NULL, PRIMARY KEY(user_id,deadline_id)
  )`,
  `CREATE INDEX IF NOT EXISTS reminders_enabled ON deadline_reminder_preferences(enabled,deadline_id,user_id)`,
  `CREATE TABLE IF NOT EXISTS reminder_jobs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), deadline_id TEXT NOT NULL REFERENCES deadlines(id),
    deadline_version INTEGER NOT NULL, offset_minutes INTEGER NOT NULL, scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','delivered','cancelled','failed')),
    next_attempt_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT, created_at TEXT NOT NULL, delivered_at TEXT,
    UNIQUE(user_id,deadline_id,deadline_version,offset_minutes)
  )`,
  `CREATE INDEX IF NOT EXISTS reminder_jobs_due ON reminder_jobs(status,next_attempt_at,lease_until)`,
  `CREATE TABLE IF NOT EXISTS reminder_inbox (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES reminder_jobs(id), user_id TEXT NOT NULL REFERENCES users(id),
    deadline_id TEXT NOT NULL REFERENCES deadlines(id), deadline_version INTEGER NOT NULL,
    created_at TEXT NOT NULL, read_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS reminder_inbox_user ON reminder_inbox(user_id,created_at DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS reminder_push_subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), destination_hash TEXT NOT NULL UNIQUE, installation_id TEXT NOT NULL,
    device_label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS reminder_subscriptions_user ON reminder_push_subscriptions(user_id,disabled_at)`,
  `CREATE TABLE IF NOT EXISTS reminder_push_deliveries (
    id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES reminder_inbox(id), subscription_id TEXT NOT NULL REFERENCES reminder_push_subscriptions(id),
    user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','sent','cancelled','failed')),
    next_attempt_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT, created_at TEXT NOT NULL, sent_at TEXT, UNIQUE(notification_id,subscription_id)
  )`,
  `CREATE INDEX IF NOT EXISTS reminder_push_due ON reminder_push_deliveries(status,next_attempt_at,lease_until)`,
];
