import type { FastifyInstance } from 'fastify';
import { first, rows, stringValue, numberValue } from './db.js';
import { requireCondition } from './errors.js';
import { getSettings } from './site-settings.js';
import type { RouteContext } from './routes.js';
import { sectionScopeSql, subjectScopeSql } from './section-access.js';

/** Complete visibility manifest for explicit device snapshots; contains no storage keys or roster. */
export function registerOfflineAccess(
  app: FastifyInstance,
  { db, authenticate, now }: RouteContext,
) {
  app.get('/api/offline/access', async (request) => {
    const actor = await authenticate(request);
    const tx = await db.transaction('read');
    try {
      const current = await first(tx, "SELECT role FROM users WHERE id=? AND status='active'", [
        actor.id,
      ]);
      requireCondition(current, 403, 'account_suspended', 'This account is not active.');
      const settings = await getSettings(tx);
      const role = stringValue(current.role);
      const scope = `(?='master' OR ${sectionScopeSql('c.id', '?')})`;
      const classes = await rows(
        tx,
        `SELECT c.id,c.updated_at FROM classes c WHERE c.status='active' AND ${scope} ORDER BY c.id LIMIT 10001`,
        [role, actor.id],
      );
      const subjects = settings.features.subjects
        ? await rows(
            tx,
            `SELECT s.id FROM subjects s JOIN classes c ON c.id=s.class_id WHERE c.status='active' AND s.deleted_at IS NULL AND ${scope} AND (?='master' OR ${subjectScopeSql('s.class_id', 's.id', '?')}) ORDER BY s.id LIMIT 10001`,
            [role, actor.id, role, actor.id],
          )
        : [];
      // A section's weekly timetable is shared, including entries for its subjects. This
      // separate list preserves that schedule offline without granting course-content access.
      const timetableSubjects =
        settings.features.subjects && settings.features.timetable
          ? await rows(
              tx,
              `SELECT s.id FROM subjects s JOIN classes c ON c.id=s.class_id
            WHERE s.deleted_at IS NULL AND c.status='active' AND ${scope} ORDER BY s.id LIMIT 10001`,
              [role, actor.id],
            )
          : [];
      const resourceRows = settings.features.resources
        ? await rows(
            tx,
            `SELECT r.id,r.class_id,r.updated_at,r.filename,r.title,r.mime_type,r.size_bytes FROM resources r JOIN classes c ON c.id=r.class_id LEFT JOIN subjects s ON s.id=r.subject_id WHERE c.status='active' AND r.deleted_at IS NULL AND r.storage_state='ready' AND (r.subject_id IS NULL OR (?=1 AND s.id IS NOT NULL AND s.class_id=r.class_id AND s.deleted_at IS NULL)) AND ${scope} AND (r.subject_id IS NULL OR ?='master' OR ${subjectScopeSql('r.class_id', 'r.subject_id', '?')}) ORDER BY r.id LIMIT 10001`,
            [settings.features.subjects ? 1 : 0, role, actor.id, role, actor.id],
          )
        : [];
      const announcements = settings.features.announcements
        ? await rows(
            tx,
            `SELECT a.id FROM announcements a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.deleted_at IS NULL AND (a.scope='global' OR (c.status='active' AND ${scope})) AND (a.subject_id IS NULL OR (?=1 AND s.id IS NOT NULL AND s.class_id=a.class_id AND s.deleted_at IS NULL)) AND (a.subject_id IS NULL OR ?='master' OR ${subjectScopeSql('a.class_id', 'a.subject_id', '?')}) ORDER BY a.id LIMIT 10001`,
            [role, actor.id, settings.features.subjects ? 1 : 0, role, actor.id],
          )
        : [];
      for (const values of [classes, subjects, timetableSubjects, resourceRows, announcements])
        requireCondition(
          values.length <= 10000,
          413,
          'offline_scope_too_large',
          'This account has too much content for one device snapshot. Continue online and contact the owner.',
        );
      const resources = resourceRows.map((r) => ({
        id: stringValue(r.id),
        classId: stringValue(r.class_id),
        updatedAt: stringValue(r.updated_at),
        filename: stringValue(r.filename),
        title: stringValue(r.title),
        mimeType: stringValue(r.mime_type),
        sizeBytes: numberValue(r.size_bytes),
      }));
      await tx.commit();
      return {
        userId: actor.id,
        generatedAt: now().toISOString(),
        settings,
        features: settings.features,
        classes: classes.map((c) => ({
          id: stringValue(c.id),
          updatedAt: stringValue(c.updated_at),
        })),
        classIds: classes.map((c) => stringValue(c.id)),
        resources,
        resourceIds: resources.map((r) => r.id),
        subjectIds: subjects.map((s) => stringValue(s.id)),
        timetableSubjectIds: timetableSubjects.map((s) => stringValue(s.id)),
        announcementIds: announcements.map((a) => stringValue(a.id)),
      };
    } finally {
      if (!tx.closed) await tx.rollback();
      tx.close();
    }
  });
}
