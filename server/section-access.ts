import { first, stringValue, type Database } from './db.js';
import { requireCondition } from './errors.js';

/** userExpr must be a trusted SQL expression/placeholder, never request text. One occurrence. */
export function sectionScopeSql(classExpr: string, userExpr: string, manage = false): string {
  return `EXISTS(SELECT 1 FROM student_sections section_binding JOIN memberships section_member
    ON section_member.user_id=section_binding.user_id AND section_member.class_id=section_binding.class_id
    WHERE section_binding.user_id=${userExpr} AND section_binding.class_id=${classExpr}
      AND section_binding.needs_resolution=0 AND section_member.status='active'${manage ? " AND section_member.role='admin'" : ''})`;
}

/** Subject visibility always includes the pinned section and its active membership. One user placeholder. */
export function subjectScopeSql(classExpr: string, subjectExpr: string, userExpr: string): string {
  return `EXISTS(SELECT 1 FROM student_sections subject_binding JOIN memberships subject_member
    ON subject_member.user_id=subject_binding.user_id AND subject_member.class_id=subject_binding.class_id
    WHERE subject_binding.user_id=${userExpr} AND subject_binding.class_id=${classExpr} AND subject_binding.needs_resolution=0
      AND subject_member.status='active' AND (subject_member.role='admin' OR EXISTS(SELECT 1 FROM subject_enrollments enrollment
        WHERE enrollment.user_id=subject_binding.user_id AND enrollment.subject_id=${subjectExpr} AND enrollment.status='active')))`;
}

export async function ensureSectionChoice(db: Database, userId: string, classId: string) {
  const binding = await first(db, 'SELECT * FROM student_sections WHERE user_id=?', [userId]);
  requireCondition(
    !binding?.needs_resolution,
    409,
    'section_resolution_required',
    'Your older account has more than one section. Ask the owner to confirm your correct section.',
  );
  requireCondition(
    !binding?.class_id || binding.class_id === classId,
    409,
    'section_conflict',
    'You already belong to another section. Only the owner can transfer your section.',
  );
  requireCondition(
    binding?.class_id || !binding?.pending_class_id || binding.pending_class_id === classId,
    409,
    'section_request_conflict',
    'A request for another section is pending. Cancel it before using a different subject code.',
  );
  return binding;
}

export async function sectionState(db: Database, userId: string) {
  const row = await first(db, 'SELECT * FROM student_sections WHERE user_id=?', [userId]);
  return {
    classId: row?.class_id ? stringValue(row.class_id) : null,
    pendingClassId: row?.pending_class_id ? stringValue(row.pending_class_id) : null,
    needsResolution: row?.needs_resolution === 1,
    version: Number(row?.version || 1),
  };
}
