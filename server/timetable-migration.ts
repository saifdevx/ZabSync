/** Additive Checkpoint 3 planning schema; the shared runner applies this as migration 6. */
export const timetableMigration = [
  `CREATE TABLE IF NOT EXISTS timetable_entries (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT REFERENCES subjects(id),
    title TEXT NOT NULL, weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
    start_time TEXT NOT NULL, end_time TEXT NOT NULL CHECK(end_time>start_time),
    teacher TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS timetable_class_weekday ON timetable_entries(class_id,deleted_at,weekday,start_time)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS timetable_exact_active ON timetable_entries(class_id,weekday,start_time,end_time,title COLLATE NOCASE,COALESCE(subject_id,'')) WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), entry_id TEXT REFERENCES timetable_entries(id),
    original_date TEXT, date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('extra','rescheduled','cancelled')),
    subject_id TEXT REFERENCES subjects(id), title TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL CHECK(end_time>start_time),
    teacher TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    CHECK((kind='extra' AND entry_id IS NULL AND original_date IS NULL)
       OR (kind IN ('rescheduled','cancelled') AND entry_id IS NOT NULL AND original_date IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS exceptions_class_date ON schedule_exceptions(class_id,deleted_at,date)`,
  `CREATE INDEX IF NOT EXISTS exceptions_class_original ON schedule_exceptions(class_id,deleted_at,original_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS exceptions_one_occurrence ON schedule_exceptions(entry_id,original_date) WHERE deleted_at IS NULL AND entry_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS exceptions_exact_extra ON schedule_exceptions(class_id,date,start_time,end_time,title COLLATE NOCASE,COALESCE(subject_id,'')) WHERE deleted_at IS NULL AND kind='extra'`,
  `CREATE TABLE IF NOT EXISTS deadlines (
    id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), subject_id TEXT REFERENCES subjects(id),
    kind TEXT NOT NULL CHECK(kind IN ('quiz','assignment','event')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL, due_time TEXT NOT NULL, due_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS deadlines_class_due ON deadlines(class_id,deleted_at,due_date,due_time)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS deadlines_exact_active ON deadlines(class_id,kind,title COLLATE NOCASE,due_at,COALESCE(subject_id,'')) WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS deadline_completions (
    user_id TEXT NOT NULL REFERENCES users(id), deadline_id TEXT NOT NULL REFERENCES deadlines(id),
    deadline_version INTEGER NOT NULL CHECK(deadline_version>0), completed_at TEXT NOT NULL,
    PRIMARY KEY(user_id,deadline_id)
  )`,
];
