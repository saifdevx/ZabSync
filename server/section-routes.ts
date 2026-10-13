import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, hashSecret } from './auth.js';
import { subjectAccess } from './academic.js';
import { first, inWriteTransaction, rows, stringValue } from './db.js';
import { requireCondition } from './errors.js';
import { classAccess, requireMaster, routeId, type RouteContext } from './routes.js';
import { ensureSectionChoice, sectionState } from './section-access.js';
import { requireFeature, requireWritable } from './site-settings.js';

const accountId = z.string().min(1).max(128);
const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = [...randomBytes(12)].map((v) => alphabet[v & 31]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function registerSectionRoutes(
  app: FastifyInstance,
  { db, authenticate, now }: RouteContext,
) {
  app.post(
    '/api/subjects/join',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const actor = await authenticate(request);
      const { code } = z
        .object({ code: z.string().trim().min(1).max(64) })
        .strict()
        .parse(request.body);
      const plain = normalizeCode(code);
      requireCondition(
        /^[A-HJ-NP-Z2-9]{12}$/.test(plain),
        400,
        'invalid_invite',
        'This subject code is invalid or has expired.',
      );
      return inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, actor);
        await requireFeature(tx, 'subjects');
        const current = await first(tx, "SELECT role FROM users WHERE id=? AND status='active'", [
          actor.id,
        ]);
        requireCondition(current, 403, 'account_suspended', 'This account is not active.');
        requireCondition(
          current.role !== 'master',
          403,
          'owner_membership_forbidden',
          'Use your university account to join subjects.',
        );
        const stamp = now();
        const invite = await first(
          tx,
          `SELECT s.id,s.class_id FROM subject_invites i JOIN subjects s ON s.id=i.subject_id
        JOIN classes c ON c.id=s.class_id WHERE i.code_hash=? AND i.active=1 AND i.expires_at>? AND s.deleted_at IS NULL AND c.status='active'`,
          [hashSecret(plain), stamp.toISOString()],
        );
        requireCondition(
          invite,
          400,
          'invalid_invite',
          'This subject code is invalid or has expired.',
        );
        const classId = stringValue(invite.class_id),
          subjectId = stringValue(invite.id);
        await ensureSectionChoice(tx, actor.id, classId);
        const member = await first(
          tx,
          'SELECT id,status FROM memberships WHERE class_id=? AND user_id=?',
          [classId, actor.id],
        );
        const active = member?.status === 'active';
        const status = active ? 'active' : 'pending';
        const id = member ? stringValue(member.id) : randomUUID();
        if (!active) {
          await tx.execute({
            sql: `INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,requested_at)
          VALUES (?,?,?,'student','pending',?,?,?) ON CONFLICT(class_id,user_id) DO UPDATE SET role='student',status='pending',updated_at=excluded.updated_at,requested_at=excluded.requested_at,reviewed_by=NULL`,
            args: [
              id,
              classId,
              actor.id,
              stamp.toISOString(),
              stamp.toISOString(),
              stamp.toISOString(),
            ],
          });
        }
        await tx.execute({
          sql: `INSERT INTO subject_enrollments(subject_id,user_id,status,created_at,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(subject_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,reviewed_by=NULL`,
          args: [subjectId, actor.id, status, stamp.toISOString(), stamp.toISOString()],
        });
        await audit(
          tx,
          actor.id,
          active ? 'subject.joined' : 'subject.admission_requested',
          subjectId,
          stamp,
          { classId },
        );
        return {
          membership: { id, classId, subjectId, status },
          message: active
            ? 'Subject joined. It is available in My Subjects.'
            : 'Your class admin will confirm your section and admit you to this subject.',
        };
      });
    },
  );

  app.delete('/api/me/section-request', async (request) => {
    const actor = await authenticate(request);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const state = await sectionState(tx, actor.id);
      requireCondition(
        !state.needsResolution,
        409,
        'section_resolution_required',
        'Ask the owner to resolve your previous sections.',
      );
      const stamp = now();
      await tx.execute({
        sql: "UPDATE subject_enrollments SET status='removed',updated_at=? WHERE user_id=? AND status='pending'",
        args: [stamp.toISOString(), actor.id],
      });
      await tx.execute({
        sql: "UPDATE memberships SET status='removed',updated_at=? WHERE user_id=? AND status='pending'",
        args: [stamp.toISOString(), actor.id],
      });
      await tx.execute({
        sql: 'UPDATE student_sections SET pending_class_id=NULL,version=version+1,updated_at=? WHERE user_id=?',
        args: [stamp.toISOString(), actor.id],
      });
      await audit(tx, actor.id, 'section.request_cancelled', actor.id, stamp);
      return { cancelled: true };
    });
  });

  app.get('/api/subjects/:id/invite', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request);
    await subjectAccess(db, actor, id, true);
    const row = await first(
      db,
      'SELECT expires_at,active FROM subject_invites WHERE subject_id=?',
      [id],
    );
    return {
      invite: row
        ? {
            expiresAt: stringValue(row.expires_at),
            active: row.active === 1 && stringValue(row.expires_at) > now().toISOString(),
          }
        : null,
    };
  });

  app.post(
    '/api/subjects/:id/invite',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const actor = await authenticate(request),
        id = routeId(request);
      if (request.body !== undefined) z.object({}).strict().parse(request.body);
      return inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, actor);
        const { classId } = await subjectAccess(tx, actor, id, true);
        const code = inviteCode(),
          stamp = now(),
          expiresAt = new Date(stamp.getTime() + 7 * 86400000).toISOString();
        await tx.execute({
          sql: `INSERT INTO subject_invites(id,subject_id,code_hash,expires_at,active,created_by,created_at) VALUES (?,?,?,?,1,?,?)
        ON CONFLICT(subject_id) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,active=1,created_by=excluded.created_by,created_at=excluded.created_at`,
          args: [
            randomUUID(),
            id,
            hashSecret(normalizeCode(code)),
            expiresAt,
            actor.id,
            stamp.toISOString(),
          ],
        });
        await audit(tx, actor.id, 'subject.invite_rotated', id, stamp, { classId });
        return { code, expiresAt };
      });
    },
  );

  app.delete('/api/subjects/:id/invite', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await subjectAccess(tx, actor, id, true);
      await tx.execute({
        sql: 'UPDATE subject_invites SET active=0 WHERE subject_id=?',
        args: [id],
      });
      await audit(tx, actor.id, 'subject.invite_revoked', id, now());
      return { revoked: true };
    });
  });

  app.get('/api/admin/users/:userId/section', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    const userId = accountId.parse((request.params as Record<string, unknown>).userId);
    const user = await first(db, 'SELECT id,display_name,email FROM users WHERE id=?', [userId]);
    requireCondition(user, 404, 'user_not_found', 'This account was not found.');
    return {
      section: await sectionState(db, userId),
      memberships: await rows(
        db,
        `SELECT m.class_id AS classId,c.name AS className,m.role,m.status FROM memberships m JOIN classes c ON c.id=m.class_id
        WHERE m.user_id=? ORDER BY m.created_at,m.id`,
        [userId],
      ),
    };
  });

  app.put('/api/admin/users/:userId/section', async (request) => {
    const actor = await authenticate(request);
    const userId = accountId.parse((request.params as Record<string, unknown>).userId);
    const form = z
      .object({
        classId: z.uuid(),
        version: z.number().int().positive(),
        reason: z.string().trim().min(5).max(500),
        subjectIds: z.array(z.uuid()).max(100).default([]),
      })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      await classAccess(tx, actor, form.classId, true);
      const target = await first(tx, "SELECT role FROM users WHERE id=? AND status='active'", [
        userId,
      ]);
      requireCondition(
        target && target.role !== 'master',
        400,
        'student_required',
        'Choose an active university student account.',
      );
      const previous = await sectionState(tx, userId);
      requireCondition(
        previous.version === form.version,
        409,
        'section_version_conflict',
        'This section assignment changed. Refresh before trying again.',
      );
      for (const subjectId of form.subjectIds) {
        const subject = await first(
          tx,
          'SELECT id FROM subjects WHERE id=? AND class_id=? AND deleted_at IS NULL',
          [subjectId, form.classId],
        );
        requireCondition(
          subject,
          400,
          'subject_class_mismatch',
          'Choose subjects from the new section.',
        );
      }
      const stamp = now();
      // Removal preserves old records and audit history; no authority moves to the new section.
      await tx.execute({
        sql: `UPDATE memberships SET status=CASE WHEN status='pending' THEN 'rejected' ELSE 'removed' END,
        role='student',updated_at=?,reviewed_by=? WHERE user_id=? AND class_id<>? AND status IN ('active','pending')`,
        args: [stamp.toISOString(), actor.id, userId, form.classId],
      });
      await tx.execute({
        sql: `UPDATE subject_enrollments SET status='removed',updated_at=?,reviewed_by=? WHERE user_id=?
        AND subject_id IN(SELECT id FROM subjects WHERE class_id<>?) AND status IN ('active','pending')`,
        args: [stamp.toISOString(), actor.id, userId, form.classId],
      });
      await tx.execute({
        sql: `INSERT INTO student_sections(user_id,class_id,pending_class_id,needs_resolution,version,updated_at) VALUES (?,?,NULL,0,?,?)
        ON CONFLICT(user_id) DO UPDATE SET class_id=excluded.class_id,pending_class_id=NULL,needs_resolution=0,version=excluded.version,updated_at=excluded.updated_at`,
        args: [userId, form.classId, previous.version + 1, stamp.toISOString()],
      });
      await tx.execute({
        sql: `INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by) VALUES (?,?,?,'student','active',?,?,?)
        ON CONFLICT(class_id,user_id) DO UPDATE SET role='student',status='active',updated_at=excluded.updated_at,reviewed_by=excluded.reviewed_by`,
        args: [
          randomUUID(),
          form.classId,
          userId,
          stamp.toISOString(),
          stamp.toISOString(),
          actor.id,
        ],
      });
      for (const subjectId of new Set(form.subjectIds))
        await tx.execute({
          sql: `INSERT INTO subject_enrollments(subject_id,user_id,status,created_at,updated_at,reviewed_by)
        VALUES (?,?,'active',?,?,?) ON CONFLICT(subject_id,user_id) DO UPDATE SET status='active',updated_at=excluded.updated_at,reviewed_by=excluded.reviewed_by`,
          args: [subjectId, userId, stamp.toISOString(), stamp.toISOString(), actor.id],
        });
      await audit(tx, actor.id, 'section.assigned_by_owner', userId, stamp, {
        previousClassId: previous.classId,
        resolvedConflict: previous.needsResolution,
        classId: form.classId,
        reason: form.reason,
        subjectIds: form.subjectIds,
      });
      return { section: await sectionState(tx, userId) };
    });
  });
}
