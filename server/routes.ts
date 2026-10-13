import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ALLOWED_EMAIL_DOMAIN, type AppConfig } from './config.js';
import {
  audit,
  createDemoSession,
  publicUser,
  universityRollNumber,
  type Clock,
  type CurrentUser,
} from './auth.js';
import {
  first,
  inWriteTransaction,
  numberValue,
  rows,
  stringValue,
  type Database,
  type SqlRow,
} from './db.js';
import { DEMO_USERS } from './demo.js';
import { requireCondition } from './errors.js';
import { requireWritable } from './site-settings.js';
import { ensureSectionChoice, sectionScopeSql, sectionState } from './section-access.js';
import { registerSectionRoutes } from './section-routes.js';

const classForm = z
  .object({
    name: z.string().trim().min(1, 'Enter a class name.').max(80),
    program: z.string().trim().min(2, 'Enter a program name.').max(100),
    semester: z.coerce.number().int().min(1).max(12),
    section: z.string().trim().min(1, 'Enter a section.').max(20),
    description: z.string().trim().max(1000).default(''),
  })
  .strict();
const pageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']) }).strict();
const idSchema = z.uuid();

export interface RouteContext {
  db: Client;
  config: AppConfig;
  now: Clock;
  authenticate: (request: FastifyRequest) => Promise<CurrentUser>;
}

export function routeId(request: FastifyRequest, name = 'id'): string {
  return idSchema.parse((request.params as Record<string, unknown>)[name]);
}

function classRecord(row: SqlRow) {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    program: stringValue(row.program),
    semester: numberValue(row.semester),
    section: stringValue(row.section),
    description: stringValue(row.description),
    createdAt: stringValue(row.created_at),
  };
}

function requestRecord(row: SqlRow) {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    program: stringValue(row.program),
    semester: numberValue(row.semester),
    section: stringValue(row.section),
    description: stringValue(row.description),
    status: stringValue(row.status),
    reviewNote: row.review_note === null ? null : stringValue(row.review_note),
    createdAt: stringValue(row.created_at),
    classId: row.class_id ? stringValue(row.class_id) : null,
  };
}

export async function requireMaster(db: Database, actor: CurrentUser): Promise<void> {
  const row = await first(db, "SELECT role FROM users WHERE id = ? AND status = 'active'", [
    actor.id,
  ]);
  requireCondition(
    row?.role === 'master',
    403,
    'master_required',
    'Only the application owner can do this.',
  );
}

export async function canCreateClass(db: Database, actor: CurrentUser): Promise<boolean> {
  const user = await first(db, "SELECT role FROM users WHERE id=? AND status='active'", [actor.id]);
  return user?.role === 'master';
}

export async function classAccess(
  db: Database,
  actor: CurrentUser,
  classId: string,
  manage = false,
) {
  if (manage) await requireWritable(db, actor);
  // Read authoritative account and membership state, including inside each write transaction.
  const currentUser = await first(db, "SELECT role FROM users WHERE id = ? AND status = 'active'", [
    actor.id,
  ]);
  requireCondition(currentUser, 403, 'account_suspended', 'This account is not active.');
  const classroom = await first(db, "SELECT * FROM classes WHERE id = ? AND status = 'active'", [
    classId,
  ]);
  requireCondition(classroom, 404, 'class_not_found', 'This class is not available to you.');
  if (currentUser.role === 'master') return { classroom, role: 'master' as const };
  const membership = await first(
    db,
    `SELECT m.role FROM memberships m JOIN student_sections binding ON binding.user_id=m.user_id
      WHERE m.class_id=? AND m.user_id=? AND m.status='active' AND binding.class_id=m.class_id AND binding.needs_resolution=0`,
    [classId, actor.id],
  );
  // A pending request or knowledge of a class ID is not access to its contents.
  requireCondition(membership, 404, 'class_not_found', 'This class is not available to you.');
  const role = stringValue(membership.role) as 'student' | 'admin';
  if (manage)
    requireCondition(
      role === 'admin',
      403,
      'admin_required',
      'Only this class’s admins can do this.',
    );
  return { classroom, role };
}

export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  const { db, config, now, authenticate } = context;
  registerSectionRoutes(app, context);

  app.get('/api/health', async () => {
    await db.execute('SELECT 1');
    return { status: 'ok', checkpoint: 4 };
  });

  app.get('/api/config', async () => ({
    appName: config.appName,
    allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
    universityUrl: config.universityUrl,
    timezone: config.timezone,
    authMode: config.authMode,
    googleSignInEnabled: config.googleSignInEnabled,
    firebase: config.authMode === 'firebase' ? config.firebase : null,
  }));

  app.post(
    '/api/demo/session',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      requireCondition(
        config.authMode === 'demo' && config.nodeEnv !== 'production',
        404,
        'not_found',
        'This endpoint is not available.',
      );
      const { persona } = z
        .object({ persona: z.enum(['student', 'admin', 'master']) })
        .strict()
        .parse(request.body);
      return { token: await createDemoSession(db, DEMO_USERS[persona].id, now()) };
    },
  );

  app.get('/api/me', async (request) => {
    const user = await authenticate(request);
    const classRows =
      user.role === 'master'
        ? []
        : await rows(
            db,
            `SELECT c.*, m.role,
       (SELECT COUNT(*) FROM memberships m2 JOIN users u2 ON u2.id = m2.user_id
        WHERE m2.class_id = c.id AND m2.status = 'active' AND u2.status = 'active' AND ${sectionScopeSql('c.id', 'm2.user_id')}) AS member_count
       FROM memberships m JOIN classes c ON c.id = m.class_id
       WHERE m.user_id = ? AND m.status = 'active' AND c.status = 'active' AND ${sectionScopeSql('c.id', 'm.user_id')}
       ORDER BY c.name COLLATE NOCASE LIMIT 100`,
            [user.id],
          );
    const pending = await rows(
      db,
      `SELECT m.id, m.class_id, m.status, c.name AS class_name FROM memberships m
       JOIN classes c ON c.id = m.class_id WHERE m.user_id = ? AND m.requested_at IS NOT NULL AND c.status = 'active'
       ORDER BY m.requested_at DESC,m.id LIMIT 100`,
      [user.id],
    );
    const requests = await rows(
      db,
      'SELECT * FROM class_requests WHERE requester_id = ? ORDER BY created_at DESC LIMIT 100',
      [user.id],
    );
    return {
      user,
      section: await sectionState(db, user.id),
      subjectRequests: await rows(
        db,
        `SELECT e.subject_id AS subjectId,s.name AS subjectName,c.name AS className,e.status FROM subject_enrollments e JOIN subjects s ON s.id=e.subject_id JOIN classes c ON c.id=s.class_id WHERE e.user_id=? AND s.deleted_at IS NULL ORDER BY e.updated_at DESC LIMIT 100`,
        [user.id],
      ),
      canCreateClass: await canCreateClass(db, user),
      classes: classRows.map((row) => ({
        ...classRecord(row),
        role: stringValue(row.role),
        memberCount: numberValue(row.member_count),
      })),
      pendingMemberships: pending.map((row) => ({
        id: stringValue(row.id),
        classId: stringValue(row.class_id),
        className: stringValue(row.class_name),
        status: row.status === 'active' ? 'approved' : stringValue(row.status),
      })),
      classRequests: requests.map(requestRecord),
    };
  });

  app.patch('/api/me', async (request) => {
    const user = await authenticate(request);
    const form = z
      .object({
        displayName: z
          .string()
          .trim()
          .min(2)
          .max(80)
          .refine(
            (value) => !/[\u0000-\u001f\u007f]/.test(value),
            'Use a name without control characters.',
          )
          .optional(),
        username: z.union([z.string().trim().max(25), z.null()]).optional(),
      })
      .strict()
      .refine(
        (value) => value.displayName !== undefined || value.username !== undefined,
        'Choose a profile field to update.',
      )
      .parse(request.body);
    const username =
      form.username === undefined
        ? undefined
        : (form.username || '').replace(/^@/, '').toLowerCase() || null;
    if (username !== undefined && username !== null) {
      requireCondition(
        /^[a-z0-9_]{3,24}$/.test(username),
        400,
        'invalid_username',
        'Use 3–24 letters, numbers, or underscores for your username.',
      );
      const reserved = new Set([
        'admin',
        'administrator',
        'master',
        'master_admin',
        'owner',
        'root',
        'system',
        'support',
        'moderator',
        'official',
        'university',
        'szabist',
        'xvia',
        'zabsync',
        'developer',
        'node_compass_task',
        'nodecompasstask',
        'tutor',
        'api',
        'auth',
        'null',
        'undefined',
        'anonymous',
      ]);
      requireCondition(
        !reserved.has(username),
        400,
        'username_reserved',
        'Choose a different username. This name is reserved.',
      );
    }
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, user);
      const current = await first(tx, "SELECT * FROM users WHERE id = ? AND status = 'active'", [
        user.id,
      ]);
      requireCondition(current, 403, 'account_suspended', 'This account is not active.');
      if (username) {
        const duplicate = await first(
          tx,
          'SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?',
          [username, user.id],
        );
        requireCondition(
          !duplicate,
          409,
          'username_taken',
          'This username is already in use. Choose another.',
        );
      }
      const result = await tx.execute({
        sql: "UPDATE users SET display_name = ?, username = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        args: [
          form.displayName ?? current.display_name,
          username === undefined ? current.username : username,
          now().toISOString(),
          user.id,
        ],
      });
      requireCondition(
        result.rowsAffected === 1,
        403,
        'account_suspended',
        'This account is not active.',
      );
      await audit(tx, user.id, 'profile.updated', user.id, now());
      return {
        user: publicUser((await first(tx, 'SELECT * FROM users WHERE id = ?', [user.id]))!),
      };
    });
  });

  app.post('/api/class-requests', async (request) => {
    await authenticate(request);
    requireCondition(
      false,
      410,
      'workflow_retired',
      'Section requests have been retired. Only the owner creates sections; class admins create subjects.',
    );
  });

  app.get('/api/classes', async (request) => {
    const user = await authenticate(request);
    const { limit, offset } = pageSchema.parse(request.query);
    if (user.role === 'master') return { classes: [], pagination: { limit, offset, total: 0 } };
    const classRows = await rows(
      db,
      `SELECT c.*, m.role,
       (SELECT COUNT(*) FROM memberships m2 JOIN users u2 ON u2.id=m2.user_id
        WHERE m2.class_id=c.id AND m2.status='active' AND u2.status='active' AND ${sectionScopeSql('c.id', 'm2.user_id')}) AS member_count
       FROM memberships m JOIN classes c ON c.id=m.class_id
       WHERE m.user_id=? AND m.status='active' AND c.status='active' AND ${sectionScopeSql('c.id', 'm.user_id')}
       ORDER BY c.name COLLATE NOCASE,c.id LIMIT ? OFFSET ?`,
      [user.id, limit, offset],
    );
    const total = await first(
      db,
      `SELECT COUNT(*) AS count FROM memberships m JOIN classes c ON c.id=m.class_id
       WHERE m.user_id=? AND m.status='active' AND c.status='active' AND ${sectionScopeSql('c.id', 'm.user_id')}`,
      [user.id],
    );
    return {
      classes: classRows.map((row) => ({
        ...classRecord(row),
        role: stringValue(row.role),
        memberCount: numberValue(row.member_count),
      })),
      pagination: { limit, offset, total: numberValue(total?.count) },
    };
  });

  app.post(
    '/api/classes',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await authenticate(request);
      const form = classForm.parse(request.body);
      const classroom = await inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, user);
        requireCondition(
          await canCreateClass(tx, user),
          403,
          'class_creation_forbidden',
          'Only the owner can create a section. Class admins create subjects within their assigned section.',
        );

        const duplicate = await first(
          tx,
          `SELECT id FROM classes WHERE created_by=? AND status='active'
        AND name=? COLLATE NOCASE AND program=? COLLATE NOCASE AND semester=? AND section=? COLLATE NOCASE`,
          [user.id, form.name, form.program, form.semester, form.section],
        );
        requireCondition(
          !duplicate,
          409,
          'duplicate_class',
          'You already created a class with these details.',
        );
        const id = randomUUID(),
          stamp = now();
        await tx.execute({
          sql: 'INSERT INTO classes(id,name,program,semester,section,description,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            form.name,
            form.program,
            form.semester,
            form.section,
            form.description,
            user.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await audit(tx, user.id, 'class.created', id, stamp, { enrolledCreator: false });
        return {
          ...classRecord((await first(tx, 'SELECT * FROM classes WHERE id=?', [id]))!),
          role: null,
          memberCount: 0,
        };
      });
      return reply.code(201).send({ class: classroom });
    },
  );

  app.post('/api/join', async (request) => {
    await authenticate(request);
    requireCondition(
      false,
      410,
      'workflow_retired',
      'Class join codes have been retired. Use a subject code from your class admin.',
    );
  });

  app.get('/api/classes/:id', async (request) => {
    const user = await authenticate(request);
    const classId = routeId(request);
    const page = pageSchema.parse(request.query);
    const access = await classAccess(db, user, classId);
    const manages = access.role !== 'student';
    let pendingMembers: unknown[] = [];
    let invite: { expiresAt: string; active: boolean } | null = null;
    const membersTotal = numberValue(
      (
        await first(
          db,
          `SELECT COUNT(*) AS n FROM memberships m WHERE class_id = ? AND status = 'active' AND ${sectionScopeSql('m.class_id', 'm.user_id')}`,
          [classId],
        )
      )?.n,
    );
    let pendingMembersTotal = 0;
    const memberRows = await rows(
      db,
      `SELECT m.user_id,m.role,m.status,u.status AS account_status,u.display_name,u.username,u.avatar_version${manages ? ',u.email' : ''} FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.class_id = ? AND m.status = 'active' AND ${sectionScopeSql('m.class_id', 'm.user_id')} ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END,u.display_name COLLATE NOCASE,u.id
       LIMIT ? OFFSET ?`,
      [classId, page.limit, page.offset],
    );
    const members = memberRows.map((row) => ({
      userId: stringValue(row.user_id),
      displayName: stringValue(row.display_name),
      username: row.username ? stringValue(row.username) : null,
      avatarVersion: row.avatar_version ? stringValue(row.avatar_version) : null,
      role: stringValue(row.role),
      status: stringValue(row.status),
      accountStatus: stringValue(row.account_status),
      ...(manages
        ? {
            email: stringValue(row.email),
            rollNumber: universityRollNumber(stringValue(row.email)),
          }
        : {}),
    }));
    if (manages) {
      const pendingRows = await rows(
        db,
        `SELECT m.id,m.user_id,m.created_at,u.email,u.status AS account_status,u.display_name,u.username,u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.class_id = ? AND m.status = 'pending' ORDER BY m.created_at LIMIT ? OFFSET ?`,
        [classId, page.limit, page.offset],
      );
      pendingMembers = pendingRows.map((row) => ({
        id: stringValue(row.id),
        userId: stringValue(row.user_id),
        email: stringValue(row.email),
        rollNumber: universityRollNumber(stringValue(row.email)),
        accountStatus: stringValue(row.account_status),
        displayName: stringValue(row.display_name),
        username: row.username ? stringValue(row.username) : null,
        avatarVersion: row.avatar_version ? stringValue(row.avatar_version) : null,
        createdAt: stringValue(row.created_at),
      }));
      pendingMembersTotal = numberValue(
        (
          await first(
            db,
            "SELECT COUNT(*) AS n FROM memberships WHERE class_id = ? AND status = 'pending'",
            [classId],
          )
        )?.n,
      );
    }
    return {
      class: { ...classRecord(access.classroom), memberCount: membersTotal },
      myRole: access.role,
      members,
      pendingMembers,
      invite,
      pagination: { ...page, membersTotal, pendingMembersTotal },
    };
  });

  app.patch('/api/classes/:id', async (request) => {
    const user = await authenticate(request);
    const classId = routeId(request);
    const form = classForm.parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await classAccess(tx, user, classId, true);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE classes SET name = ?, program = ?, semester = ?, section = ?, description = ?, updated_at = ? WHERE id = ?',
        args: [
          form.name,
          form.program,
          form.semester,
          form.section,
          form.description,
          stamp.toISOString(),
          classId,
        ],
      });
      await audit(tx, user.id, 'class.updated', classId, stamp);
      return {
        class: classRecord((await first(tx, 'SELECT * FROM classes WHERE id = ?', [classId]))!),
      };
    });
  });

  app.post('/api/classes/:id/invite', async (request) => {
    const actor = await authenticate(request);
    await classAccess(db, actor, routeId(request), true);
    requireCondition(
      false,
      410,
      'workflow_retired',
      'Share a subject join code from its subject page. Class codes are no longer used.',
    );
  });

  app.post('/api/classes/:id/memberships/:membershipId/decision', async (request) => {
    const user = await authenticate(request);
    const classId = routeId(request);
    const membershipId = routeId(request, 'membershipId');
    const { decision } = decisionSchema.parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await classAccess(tx, user, classId, true);
      const membership = await first(
        tx,
        `SELECT m.*,u.status AS account_status,u.role AS global_role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.id = ? AND m.class_id = ?`,
        [membershipId, classId],
      );
      requireCondition(
        membership,
        404,
        'membership_not_found',
        'This membership request was not found.',
      );
      requireCondition(
        membership.status === 'pending',
        409,
        'already_reviewed',
        'This membership request has already been reviewed.',
      );
      if (decision === 'approve') {
        requireCondition(
          membership.account_status === 'active',
          409,
          'account_inactive',
          'This account is not active.',
        );
        requireCondition(
          membership.global_role !== 'master',
          403,
          'owner_membership_forbidden',
          'The owner account cannot be enrolled. Use a separate university student account.',
        );
      }
      if (decision === 'approve')
        await ensureSectionChoice(tx, stringValue(membership.user_id), classId);
      const status = decision === 'approve' ? 'active' : 'rejected';
      const stamp = now();
      await tx.execute({
        sql: "UPDATE memberships SET role = 'student', status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?",
        args: [status, user.id, stamp.toISOString(), membershipId],
      });
      await tx.execute({
        sql: `UPDATE subject_enrollments SET status=?,updated_at=?,reviewed_by=? WHERE user_id=? AND status='pending'
        AND subject_id IN (SELECT id FROM subjects WHERE class_id=? AND deleted_at IS NULL)`,
        args: [status, stamp.toISOString(), user.id, membership.user_id, classId],
      });
      if (decision === 'reject')
        await tx.execute({
          sql: 'UPDATE student_sections SET pending_class_id=NULL,version=version+1,updated_at=? WHERE user_id=? AND pending_class_id=? AND class_id IS NULL',
          args: [stamp.toISOString(), membership.user_id, classId],
        });
      await audit(
        tx,
        user.id,
        `membership.${decision === 'approve' ? 'approved' : 'rejected'}`,
        membershipId,
        stamp,
        { classId, userId: membership.user_id },
      );
      return { membershipId, status };
    });
  });

  app.delete('/api/classes/:id/members/:userId', async (request) => {
    const user = await authenticate(request);
    const classId = routeId(request);
    const targetUserId = z
      .string()
      .min(1)
      .max(128)
      .parse((request.params as Record<string, unknown>).userId);
    return inWriteTransaction(db, async (tx) => {
      const access = await classAccess(tx, user, classId, true);
      const membership = await first(
        tx,
        "SELECT id,role FROM memberships WHERE class_id = ? AND user_id = ? AND status = 'active'",
        [classId, targetUserId],
      );
      requireCondition(membership, 404, 'membership_not_found', 'This member was not found.');
      if (access.role !== 'master')
        requireCondition(
          membership.role === 'student',
          403,
          'admin_protected',
          'Only the owner can change an admin’s membership.',
        );
      const stamp = now();
      await tx.execute({
        sql: "UPDATE memberships SET role = 'student', status = 'removed', updated_at = ?, reviewed_by = ? WHERE id = ?",
        args: [stamp.toISOString(), user.id, membership.id],
      });
      await tx.execute({
        sql: `UPDATE subject_enrollments SET status='removed',updated_at=?,reviewed_by=? WHERE user_id=? AND subject_id IN (SELECT id FROM subjects WHERE class_id=?) AND status IN ('active','pending')`,
        args: [stamp.toISOString(), user.id, targetUserId, classId],
      });
      await audit(tx, user.id, 'membership.removed', targetUserId, stamp, { classId });
      return { userId: targetUserId, status: 'removed' };
    });
  });

  app.get('/api/admin/overview', async (request) => {
    const user = await authenticate(request);
    await requireMaster(db, user);
    const page = pageSchema.parse(request.query);
    // One statement keeps all independent totals at the same point in time and
    // avoids a separate remote database round trip for every dashboard card.
    const totals = await first(
      db,
      `SELECT
      (SELECT COUNT(*) FROM users) AS user_count,
      (SELECT COUNT(*) FROM classes WHERE status='active') AS class_count,
      (SELECT COUNT(*) FROM users WHERE status='active') AS active_user_count,
      (SELECT COUNT(*) FROM users WHERE status='suspended') AS suspended_user_count,
      (SELECT COUNT(DISTINCT semester) FROM classes WHERE status='active') AS semester_count,
      (SELECT COUNT(DISTINCT m.user_id) FROM memberships m JOIN users u ON u.id=m.user_id JOIN classes c ON c.id=m.class_id
        WHERE m.role='admin' AND m.status='active' AND u.status='active' AND c.status='active' AND ${sectionScopeSql('c.id', 'm.user_id', true)}) AS admin_count,
      (SELECT COUNT(*) FROM memberships m JOIN users u ON u.id=m.user_id JOIN classes c ON c.id=m.class_id
        WHERE m.status='pending' AND u.status='active' AND c.status='active') AS pending_membership_count,
      (SELECT COUNT(*) FROM class_requests) AS legacy_request_count,
      (SELECT COUNT(*) FROM audit_logs) AS audit_count`,
    );
    const stats = {
      users: numberValue(totals?.user_count),
      classes: numberValue(totals?.class_count),
      activeUsers: numberValue(totals?.active_user_count),
      suspendedUsers: numberValue(totals?.suspended_user_count),
      semesters: numberValue(totals?.semester_count),
      admins: numberValue(totals?.admin_count),
      pendingMemberships: numberValue(totals?.pending_membership_count),
      legacyClassRequests: numberValue(totals?.legacy_request_count),
    };
    const requestRows = await rows(
      db,
      `SELECT r.*,u.email AS requester_email,u.display_name AS requester_name FROM class_requests r
       JOIN users u ON u.id = r.requester_id ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT ? OFFSET ?`,
      [page.limit, page.offset],
    );
    const userRows = await rows(
      db,
      'SELECT * FROM users ORDER BY created_at DESC, id LIMIT ? OFFSET ?',
      [page.limit, page.offset],
    );
    const classRows = await rows(
      db,
      `SELECT c.*,(SELECT COUNT(*) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.class_id = c.id AND m.status = 'active' AND u.status='active' AND ${sectionScopeSql('c.id', 'm.user_id')}) AS member_count
       FROM classes c WHERE c.status = 'active' ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`,
      [page.limit, page.offset],
    );
    const auditRows = await rows(
      db,
      `SELECT a.id,a.action,a.target_id,a.created_at,u.email AS actor_email FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,
      [page.limit, page.offset],
    );
    return {
      stats,
      requests: requestRows.map((row) => ({
        ...requestRecord(row),
        requester: {
          id: stringValue(row.requester_id),
          email: stringValue(row.requester_email),
          displayName: stringValue(row.requester_name),
        },
      })),
      users: userRows.map(publicUser),
      classes: classRows.map((row) => ({
        ...classRecord(row),
        memberCount: numberValue(row.member_count),
      })),
      audit: auditRows.map((row) => ({
        id: stringValue(row.id),
        action: stringValue(row.action),
        actorEmail: stringValue(row.actor_email),
        targetId: stringValue(row.target_id),
        createdAt: stringValue(row.created_at),
      })),
      pagination: {
        ...page,
        requestsTotal: stats.legacyClassRequests,
        usersTotal: stats.users,
        classesTotal: stats.classes,
        auditTotal: numberValue(totals?.audit_count),
      },
    };
  });

  app.get('/api/admin/semesters', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    const semesterRows = await rows(
      db,
      `SELECT c.semester,COUNT(DISTINCT c.id) AS class_count,
      COUNT(u.id) AS member_count,
      COALESCE(SUM(CASE WHEN u.id IS NOT NULL AND m.role='student' THEN 1 ELSE 0 END),0) AS student_count,
      COALESCE(SUM(CASE WHEN u.id IS NOT NULL AND m.role='admin' THEN 1 ELSE 0 END),0) AS admin_count
      FROM classes c LEFT JOIN memberships m ON m.class_id=c.id AND m.status='active' AND ${sectionScopeSql('c.id', 'm.user_id')}
      LEFT JOIN users u ON u.id=m.user_id AND u.status='active'
      WHERE c.status='active' GROUP BY c.semester ORDER BY c.semester`,
    );
    const semesters = semesterRows.map((row) => ({
      semester: numberValue(row.semester),
      classCount: numberValue(row.class_count),
      memberCount: numberValue(row.member_count),
      studentCount: numberValue(row.student_count),
      adminCount: numberValue(row.admin_count),
    }));
    const totals = semesters.reduce(
      (total, semester) => ({
        classCount: total.classCount + semester.classCount,
        memberCount: total.memberCount + semester.memberCount,
        studentCount: total.studentCount + semester.studentCount,
        adminCount: total.adminCount + semester.adminCount,
      }),
      { classCount: 0, memberCount: 0, studentCount: 0, adminCount: 0 },
    );
    return { semesters, totals };
  });

  app.get('/api/admin/semesters/:semester/classes', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    const semester = z.coerce
      .number()
      .int()
      .min(1)
      .max(12)
      .parse((request.params as Record<string, unknown>).semester);
    const page = pageSchema.parse(request.query);
    const classRows = await rows(
      db,
      `SELECT c.*,COUNT(u.id) AS member_count,
      COALESCE(SUM(CASE WHEN u.id IS NOT NULL AND m.role='student' THEN 1 ELSE 0 END),0) AS student_count,
      COALESCE(SUM(CASE WHEN u.id IS NOT NULL AND m.role='admin' THEN 1 ELSE 0 END),0) AS admin_count
      FROM classes c LEFT JOIN memberships m ON m.class_id=c.id AND m.status='active' AND ${sectionScopeSql('c.id', 'm.user_id')}
      LEFT JOIN users u ON u.id=m.user_id AND u.status='active'
      WHERE c.status='active' AND c.semester=? GROUP BY c.id
      ORDER BY c.section COLLATE NOCASE,c.name COLLATE NOCASE,c.id LIMIT ? OFFSET ?`,
      [semester, page.limit, page.offset],
    );
    const total = numberValue(
      (
        await first(db, "SELECT COUNT(*) AS n FROM classes WHERE status='active' AND semester=?", [
          semester,
        ])
      )?.n,
    );
    return {
      semester,
      classes: classRows.map((row) => ({
        ...classRecord(row),
        memberCount: numberValue(row.member_count),
        studentCount: numberValue(row.student_count),
        adminCount: numberValue(row.admin_count),
      })),
      pagination: { ...page, total },
    };
  });

  app.post('/api/admin/classes/:id/members', async (request) => {
    const actor = await authenticate(request);
    const classId = routeId(request);
    const { userId } = z
      .object({ userId: z.string().min(1).max(128) })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      await classAccess(tx, actor, classId, true);
      const target = await first(tx, "SELECT id,role FROM users WHERE id=? AND status='active'", [
        userId,
      ]);
      requireCondition(target, 404, 'user_not_found', 'Choose a registered, active account.');
      requireCondition(
        target.role !== 'master',
        403,
        'owner_membership_forbidden',
        'The owner account cannot be enrolled. Choose a separate university student account.',
      );
      await ensureSectionChoice(tx, userId, classId);
      const existing = await first(
        tx,
        'SELECT id,role,status FROM memberships WHERE class_id=? AND user_id=?',
        [classId, userId],
      );
      if (existing?.status === 'active')
        return {
          membership: {
            id: stringValue(existing.id),
            userId,
            classId,
            role: stringValue(existing.role),
            status: 'active',
          },
        };
      const id = existing ? stringValue(existing.id) : randomUUID();
      const stamp = now();
      if (existing) {
        await tx.execute({
          sql: "UPDATE memberships SET role='student',status='active',updated_at=?,reviewed_by=? WHERE id=?",
          args: [stamp.toISOString(), actor.id, id],
        });
      } else {
        await tx.execute({
          sql: "INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by) VALUES (?,?,?,'student','active',?,?,?)",
          args: [id, classId, userId, stamp.toISOString(), stamp.toISOString(), actor.id],
        });
      }
      await audit(tx, actor.id, 'membership.added_by_owner', userId, stamp, {
        classId,
        membershipId: id,
      });
      return { membership: { id, userId, classId, role: 'student', status: 'active' } };
    });
  });

  app.patch('/api/admin/classes/:id/members/:userId/role', async (request) => {
    const actor = await authenticate(request);
    const classId = routeId(request);
    const userId = z
      .string()
      .min(1)
      .max(128)
      .parse((request.params as Record<string, unknown>).userId);
    const { role } = z
      .object({ role: z.enum(['student', 'admin']) })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      await classAccess(tx, actor, classId, true);
      await ensureSectionChoice(tx, userId, classId);
      const target = await first(
        tx,
        `SELECT m.id,m.role,u.role AS global_role FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.class_id=? AND m.user_id=? AND m.status='active' AND u.status='active'`,
        [classId, userId],
      );
      requireCondition(
        target,
        404,
        'membership_not_found',
        'Choose an active member of this class.',
      );
      requireCondition(
        target.global_role !== 'master',
        403,
        'owner_membership_forbidden',
        'The owner account does not need a class role. Use a separate university student account.',
      );
      if (target.role === role) return { userId, classId, role };
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE memberships SET role=?,updated_at=?,reviewed_by=? WHERE id=?',
        args: [role, stamp.toISOString(), actor.id, target.id],
      });
      await audit(tx, actor.id, 'class_admin.role_updated', userId, stamp, { classId, role });
      return { userId, classId, role };
    });
  });

  // Historical approval records survive upgrades, but these old endpoints can no
  // longer create classes or assign roles under the retired CR/GR policy.
  for (const url of [
    '/api/admin/class-requests/:id/decision',
    '/api/admin/classes/:id/representatives',
  ]) {
    app.post(url, async (request) => {
      const actor = await authenticate(request);
      await requireMaster(db, actor);
      requireCondition(
        false,
        410,
        'workflow_retired',
        'This approval workflow has been retired. Use class creation and class admin controls.',
      );
    });
  }
}
