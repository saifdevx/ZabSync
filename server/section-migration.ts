/** Checkpoint 4 migration 7. Keep original memberships as history; never choose between legacy sections. */
export const sectionMigration = [
  `CREATE TABLE student_sections (
    user_id TEXT PRIMARY KEY REFERENCES users(id), class_id TEXT REFERENCES classes(id),
    pending_class_id TEXT REFERENCES classes(id), needs_resolution INTEGER NOT NULL DEFAULT 0 CHECK(needs_resolution IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
  )`,
  `INSERT INTO student_sections(user_id,class_id,pending_class_id,needs_resolution,updated_at)
   SELECT u.id,
    CASE WHEN (SELECT COUNT(*) FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='active' AND c.status='active')=1
      THEN (SELECT m.class_id FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='active' AND c.status='active' LIMIT 1) END,
    CASE WHEN NOT EXISTS(SELECT 1 FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='active' AND c.status='active')
       AND (SELECT COUNT(*) FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='pending' AND c.status='active')=1
      THEN (SELECT m.class_id FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='pending' AND c.status='active' LIMIT 1) END,
    CASE WHEN (SELECT COUNT(*) FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='active' AND c.status='active')>1
       OR (NOT EXISTS(SELECT 1 FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='active' AND c.status='active')
          AND (SELECT COUNT(*) FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=u.id AND m.status='pending' AND c.status='active')>1)
      THEN 1 ELSE 0 END,u.updated_at FROM users u WHERE u.role='student'`,
  `CREATE INDEX student_sections_class ON student_sections(class_id,needs_resolution)`,
  `CREATE TABLE subject_enrollments (
    subject_id TEXT NOT NULL REFERENCES subjects(id),user_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','removed')),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id),
    PRIMARY KEY(subject_id,user_id)
  )`,
  `CREATE INDEX subject_enrollments_user ON subject_enrollments(user_id,status,subject_id)`,
  // Existing members keep their existing subject access only after their one section is resolved.
  `INSERT INTO subject_enrollments(subject_id,user_id,status,created_at,updated_at,reviewed_by)
    SELECT s.id,m.user_id,'active',m.created_at,m.updated_at,m.reviewed_by FROM subjects s
    JOIN memberships m ON m.class_id=s.class_id JOIN users u ON u.id=m.user_id
    WHERE m.status='active' AND u.role='student'`,
  `CREATE TABLE subject_invites (
    id TEXT PRIMARY KEY,subject_id TEXT NOT NULL UNIQUE REFERENCES subjects(id),code_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER section_for_new_student AFTER INSERT ON users WHEN NEW.role='student' BEGIN
    INSERT INTO student_sections(user_id,updated_at) SELECT NEW.id,NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM student_sections WHERE user_id=NEW.id);
  END`,
  // A server-authorized owner transfer may demote an old university owner with
  // historical memberships. Preserve the sole one; never pick among several.
  `CREATE TRIGGER section_for_former_owner AFTER UPDATE OF role ON users WHEN OLD.role='master' AND NEW.role='student' BEGIN
    INSERT INTO student_sections(user_id,updated_at) SELECT NEW.id,NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM student_sections WHERE user_id=NEW.id);
    UPDATE student_sections SET
      class_id=CASE WHEN (SELECT COUNT(*) FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=NEW.id AND m.status='active' AND c.status='active')=1
        THEN (SELECT m.class_id FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=NEW.id AND m.status='active' AND c.status='active' LIMIT 1) END,
      pending_class_id=NULL,
      needs_resolution=CASE WHEN (SELECT COUNT(*) FROM memberships m JOIN classes c ON c.id=m.class_id WHERE m.user_id=NEW.id AND m.status='active' AND c.status='active')>1 THEN 1 ELSE 0 END,
      version=version+1,updated_at=NEW.updated_at WHERE user_id=NEW.id;
    INSERT INTO subject_enrollments(subject_id,user_id,status,created_at,updated_at)
      SELECT s.id,NEW.id,'active',NEW.updated_at,NEW.updated_at FROM subjects s JOIN student_sections b ON b.class_id=s.class_id
      JOIN memberships m ON m.class_id=s.class_id AND m.user_id=NEW.id
      WHERE b.user_id=NEW.id AND b.needs_resolution=0 AND m.status='active'
        AND NOT EXISTS(SELECT 1 FROM subject_enrollments e WHERE e.subject_id=s.id AND e.user_id=NEW.id);
  END`,
  ...['INSERT', 'UPDATE'].map(
    (event) => `CREATE TRIGGER membership_section_guard_${event.toLowerCase()}
    BEFORE ${event} ON memberships WHEN NEW.status IN ('active','pending') AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student') BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM student_sections b WHERE b.user_id=NEW.user_id AND
        (b.needs_resolution=1 OR (b.class_id IS NOT NULL AND b.class_id<>NEW.class_id) OR
          (b.class_id IS NULL AND b.pending_class_id IS NOT NULL AND b.pending_class_id<>NEW.class_id)))
        THEN RAISE(ABORT,'section_conflict') END;
    END`,
  ),
  ...['INSERT', 'UPDATE'].map(
    (event) => `CREATE TRIGGER membership_section_bind_${event.toLowerCase()}
    AFTER ${event} ON memberships WHEN NEW.status IN ('active','pending') AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND role='student') BEGIN
      INSERT INTO student_sections(user_id,updated_at) SELECT NEW.user_id,NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM student_sections WHERE user_id=NEW.user_id);
      UPDATE student_sections SET
        class_id=CASE WHEN NEW.status='active' THEN NEW.class_id ELSE class_id END,
        pending_class_id=CASE WHEN NEW.status='active' THEN NULL WHEN class_id IS NULL THEN NEW.class_id ELSE NULL END,
        updated_at=NEW.updated_at WHERE user_id=NEW.user_id;
    END`,
  ),
  `CREATE TRIGGER subject_enrollment_guard_insert BEFORE INSERT ON subject_enrollments WHEN NEW.status='active' BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM subjects s JOIN student_sections b ON b.class_id=s.class_id
      JOIN memberships m ON m.user_id=b.user_id AND m.class_id=b.class_id
      WHERE s.id=NEW.subject_id AND b.user_id=NEW.user_id AND b.needs_resolution=0 AND m.status='active')
      THEN RAISE(ABORT,'subject_section_conflict') END;
  END`,
  `CREATE TRIGGER subject_enrollment_guard_update BEFORE UPDATE ON subject_enrollments WHEN NEW.status='active' BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM subjects s JOIN student_sections b ON b.class_id=s.class_id
      JOIN memberships m ON m.user_id=b.user_id AND m.class_id=b.class_id
      WHERE s.id=NEW.subject_id AND b.user_id=NEW.user_id AND b.needs_resolution=0 AND m.status='active')
      THEN RAISE(ABORT,'subject_section_conflict') END;
  END`,
];
