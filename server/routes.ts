import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ALLOWED_EMAIL_DOMAIN, type AppConfig } from './config.js';
import {
  audit,
  createDemoSession,
  hashSecret,
  publicUser,
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
    "SELECT role FROM memberships WHERE class_id = ? AND user_id = ? AND status = 'active'",
    [classId, actor.id],
  );
  // A pending request or knowledge of a class ID is not access to its contents.
  requireCondition(membership, 404, 'class_not_found', 'This class is not available to you.');
  const role = stringValue(membership.role) as 'student' | 'cr' | 'gr';
  if (manage)
    requireCondition(
      role === 'cr' || role === 'gr',
      403,
      'representative_required',
      'Only this class’s representatives can do this.',
    );
  return { classroom, role };
}

function makeInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const plain = [...randomBytes(12)].map((value) => alphabet[value & 31]).join('');
  return `${plain.slice(0, 4)}-${plain.slice(4, 8)}-${plain.slice(8)}`;
}

function normalizedCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  const { db, config, now, authenticate } = context;

  app.get('/api/health', async () => {
    await db.execute('SELECT 1');
    return { status: 'ok', checkpoint: 2 };
  });

  app.get('/api/config', async () => ({
    appName: config.appName,
    allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
    universityUrl: config.universityUrl,
    timezone: config.timezone,
    authMode: config.authMode,
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
        .object({ persona: z.enum(['student', 'cr', 'gr', 'master']) })
        .strict()
        .parse(request.body);
      return { token: await createDemoSession(db, DEMO_USERS[persona].id, now()) };
    },
  );

  app.get('/api/me', async (request) => {
    const user = await authenticate(request);
    const classRows = await rows(
      db,
      `SELECT c.*, m.role,
       (SELECT COUNT(*) FROM memberships m2 JOIN users u2 ON u2.id = m2.user_id
        WHERE m2.class_id = c.id AND m2.status = 'active' AND u2.status = 'active') AS member_count
       FROM memberships m JOIN classes c ON c.id = m.class_id
       WHERE m.user_id = ? AND m.status = 'active' AND c.status = 'active'
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

  app.post(
    '/api/class-requests',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = await authenticate(request);
      const form = classForm.parse(request.body);
      const created = await inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, user);
        const activeUser = await first(
          tx,
          "SELECT id FROM users WHERE id = ? AND status = 'active'",
          [user.id],
        );
        requireCondition(activeUser, 403, 'account_suspended', 'This account is not active.');
        const count = await first(
          tx,
          "SELECT COUNT(*) AS n FROM class_requests WHERE requester_id = ? AND status = 'pending'",
          [user.id],
        );
        requireCondition(
          numberValue(count?.n) < 5,
          429,
          'request_limit',
          'You already have five pending class requests. Wait for a review.',
        );
        const duplicate = await first(
          tx,
          `SELECT id FROM class_requests WHERE requester_id = ? AND status = 'pending' AND name = ? COLLATE NOCASE
         AND program = ? COLLATE NOCASE AND semester = ? AND section = ? COLLATE NOCASE`,
          [user.id, form.name, form.program, form.semester, form.section],
        );
        requireCondition(!duplicate, 409, 'duplicate_request', 'You already requested this class.');
        const id = randomUUID();
        const stamp = now();
        await tx.execute({
          sql: 'INSERT INTO class_requests(id,requester_id,name,program,semester,section,description,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            user.id,
            form.name,
            form.program,
            form.semester,
            form.section,
            form.description,
            'pending',
            stamp.toISOString(),
          ],
        });
        await audit(tx, user.id, 'class.requested', id, stamp);
        return requestRecord((await first(tx, 'SELECT * FROM class_requests WHERE id = ?', [id]))!);
      });
      return reply.code(201).send({ request: created });
    },
  );

  app.post(
    '/api/join',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await authenticate(request);
      const { code } = z
        .object({ code: z.string().trim().min(1).max(64) })
        .strict()
        .parse(request.body);
      const plain = normalizedCode(code);
      requireCondition(
        /^[A-HJ-NP-Z2-9]{12}$/.test(plain),
        400,
        'invalid_invite',
        'This class code is invalid or has expired.',
      );
      return inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, user);
        const activeUser = await first(
          tx,
          "SELECT id FROM users WHERE id = ? AND status = 'active'",
          [user.id],
        );
        requireCondition(activeUser, 403, 'account_suspended', 'This account is not active.');
        const stamp = now();
        const invite = await first(
          tx,
          `SELECT i.class_id FROM class_invites i JOIN classes c ON c.id = i.class_id
         WHERE i.code_hash = ? AND i.active = 1 AND i.expires_at > ? AND c.status = 'active'`,
          [hashSecret(plain), stamp.toISOString()],
        );
        requireCondition(
          invite,
          400,
          'invalid_invite',
          'This class code is invalid or has expired.',
        );
        const classId = stringValue(invite.class_id);
        const existing = await first(
          tx,
          'SELECT id, status FROM memberships WHERE class_id = ? AND user_id = ?',
          [classId, user.id],
        );
        if (existing && (existing.status === 'active' || existing.status === 'pending')) {
          return {
            membership: {
              id: stringValue(existing.id),
              classId,
              status: stringValue(existing.status),
            },
            message:
              existing.status === 'active'
                ? 'You already belong to this class.'
                : 'Your request is awaiting representative approval.',
          };
        }
        const id = existing ? stringValue(existing.id) : randomUUID();
        if (existing) {
          await tx.execute({
            sql: "UPDATE memberships SET role = 'student', status = 'pending', created_at = ?, updated_at = ?, requested_at = ?, reviewed_by = NULL WHERE id = ?",
            args: [stamp.toISOString(), stamp.toISOString(), stamp.toISOString(), id],
          });
        } else {
          await tx.execute({
            sql: 'INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,requested_at) VALUES (?,?,?,?,?,?,?,?)',
            args: [
              id,
              classId,
              user.id,
              'student',
              'pending',
              stamp.toISOString(),
              stamp.toISOString(),
              stamp.toISOString(),
            ],
          });
        }
        await audit(tx, user.id, 'membership.requested', id, stamp, { classId });
        return {
          membership: { id, classId, status: 'pending' },
          message: 'Your request is awaiting representative approval.',
        };
      });
    },
  );

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
          "SELECT COUNT(*) AS n FROM memberships WHERE class_id = ? AND status = 'active'",
          [classId],
        )
      )?.n,
    );
    let pendingMembersTotal = 0;
    const memberRows = await rows(
      db,
      `SELECT m.user_id,m.role,m.status,u.display_name,u.username,u.avatar_version${manages ? ',u.email' : ''} FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.class_id = ? AND m.status = 'active' ORDER BY CASE m.role WHEN 'cr' THEN 0 WHEN 'gr' THEN 1 ELSE 2 END,u.display_name COLLATE NOCASE,u.id
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
      ...(manages ? { email: stringValue(row.email) } : {}),
    }));
    if (manages) {
      const pendingRows = await rows(
        db,
        `SELECT m.id,m.user_id,m.created_at,u.email,u.display_name,u.username,u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.class_id = ? AND m.status = 'pending' ORDER BY m.created_at LIMIT ? OFFSET ?`,
        [classId, page.limit, page.offset],
      );
      pendingMembers = pendingRows.map((row) => ({
        id: stringValue(row.id),
        userId: stringValue(row.user_id),
        email: stringValue(row.email),
        displayName: stringValue(row.display_name),
        username: row.username ? stringValue(row.username) : null,
        avatarVersion: row.avatar_version ? stringValue(row.avatar_version) : null,
        createdAt: stringValue(row.created_at),
      }));
      const inviteRow = await first(
        db,
        'SELECT expires_at,active FROM class_invites WHERE class_id = ?',
        [classId],
      );
      if (inviteRow)
        invite = {
          expiresAt: stringValue(inviteRow.expires_at),
          active: inviteRow.active === 1 && stringValue(inviteRow.expires_at) > now().toISOString(),
        };
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

  app.post(
    '/api/classes/:id/invite',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await authenticate(request);
      const classId = routeId(request);
      if (request.body !== undefined) z.object({}).strict().parse(request.body);
      return inWriteTransaction(db, async (tx) => {
        await classAccess(tx, user, classId, true);
        const code = makeInviteCode();
        const stamp = now();
        const expiresAt = new Date(stamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await tx.execute({
          sql: `INSERT INTO class_invites(id,class_id,code_hash,expires_at,active,created_by,created_at) VALUES (?,?,?,?,1,?,?)
              ON CONFLICT(class_id) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,
              active=1,created_by=excluded.created_by,created_at=excluded.created_at`,
          args: [
            randomUUID(),
            classId,
            hashSecret(normalizedCode(code)),
            expiresAt,
            user.id,
            stamp.toISOString(),
          ],
        });
        await audit(tx, user.id, 'invite.rotated', classId, stamp);
        return { code, expiresAt };
      });
    },
  );

  app.post('/api/classes/:id/memberships/:membershipId/decision', async (request) => {
    const user = await authenticate(request);
    const classId = routeId(request);
    const membershipId = routeId(request, 'membershipId');
    const { decision } = decisionSchema.parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await classAccess(tx, user, classId, true);
      const membership = await first(
        tx,
        `SELECT m.*,u.status AS account_status FROM memberships m JOIN users u ON u.id = m.user_id
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
      if (decision === 'approve')
        requireCondition(
          membership.account_status === 'active',
          409,
          'account_inactive',
          'This account is not active.',
        );
      const status = decision === 'approve' ? 'active' : 'rejected';
      const stamp = now();
      await tx.execute({
        sql: "UPDATE memberships SET role = 'student', status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?",
        args: [status, user.id, stamp.toISOString(), membershipId],
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
          'representative_protected',
          'Only the owner can change a representative’s membership.',
        );
      requireCondition(
        membership.role !== 'cr',
        409,
        'last_cr_required',
        'Assign a replacement CR before removing the current CR.',
      );
      const stamp = now();
      await tx.execute({
        sql: "UPDATE memberships SET role = 'student', status = 'removed', updated_at = ?, reviewed_by = ? WHERE id = ?",
        args: [stamp.toISOString(), user.id, membership.id],
      });
      await audit(tx, user.id, 'membership.removed', targetUserId, stamp, { classId });
      return { userId: targetUserId, status: 'removed' };
    });
  });

  app.get('/api/admin/overview', async (request) => {
    const user = await authenticate(request);
    await requireMaster(db, user);
    const page = pageSchema.parse(request.query);
    const stats = {
      users: numberValue((await first(db, 'SELECT COUNT(*) AS n FROM users'))?.n),
      classes: numberValue(
        (await first(db, "SELECT COUNT(*) AS n FROM classes WHERE status = 'active'"))?.n,
      ),
      pendingRequests: numberValue(
        (await first(db, "SELECT COUNT(*) AS n FROM class_requests WHERE status = 'pending'"))?.n,
      ),
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
      `SELECT c.*,(SELECT COUNT(*) FROM memberships m WHERE m.class_id = c.id AND m.status = 'active') AS member_count
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
        requestsTotal: numberValue(
          (await first(db, 'SELECT COUNT(*) AS n FROM class_requests'))?.n,
        ),
        usersTotal: stats.users,
        classesTotal: stats.classes,
        auditTotal: numberValue((await first(db, 'SELECT COUNT(*) AS n FROM audit_logs'))?.n),
      },
    };
  });

  app.post('/api/admin/class-requests/:id/decision', async (request) => {
    const user = await authenticate(request);
    const requestId = routeId(request);
    const form = z
      .object({
        decision: z.enum(['approve', 'reject']),
        note: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, user);
      const pending = await first(
        tx,
        'SELECT r.*,u.status AS account_status FROM class_requests r JOIN users u ON u.id = r.requester_id WHERE r.id = ?',
        [requestId],
      );
      requireCondition(pending, 404, 'request_not_found', 'This class request was not found.');
      requireCondition(
        pending.status === 'pending',
        409,
        'already_reviewed',
        'This class request has already been reviewed.',
      );
      const stamp = now();
      let classId: string | null = null;
      if (form.decision === 'approve') {
        requireCondition(
          pending.account_status === 'active',
          409,
          'account_inactive',
          'The requester’s account is not active.',
        );
        classId = randomUUID();
        await tx.execute({
          sql: 'INSERT INTO classes(id,name,program,semester,section,description,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          args: [
            classId,
            pending.name,
            pending.program,
            pending.semester,
            pending.section,
            pending.description,
            user.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await tx.execute({
          sql: 'INSERT INTO memberships(id,class_id,user_id,role,status,created_at,updated_at,reviewed_by) VALUES (?,?,?,?,?,?,?,?)',
          args: [
            randomUUID(),
            classId,
            pending.requester_id,
            'cr',
            'active',
            stamp.toISOString(),
            stamp.toISOString(),
            user.id,
          ],
        });
      }
      const status = form.decision === 'approve' ? 'approved' : 'rejected';
      await tx.execute({
        sql: 'UPDATE class_requests SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, class_id = ? WHERE id = ?',
        args: [status, form.note || null, user.id, stamp.toISOString(), classId, requestId],
      });
      await audit(tx, user.id, `class_request.${status}`, requestId, stamp, {
        classId,
        requesterId: pending.requester_id,
      });
      return { requestId, status, classId };
    });
  });

  app.post('/api/admin/classes/:id/representatives', async (request) => {
    const user = await authenticate(request);
    const classId = routeId(request);
    const { userId, role } = z
      .object({ userId: z.string().min(1).max(128), role: z.enum(['cr', 'gr', 'student']) })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, user);
      await classAccess(tx, user, classId, true);
      const target = await first(
        tx,
        `SELECT m.id,m.role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.class_id = ? AND m.user_id = ? AND m.status = 'active' AND u.status = 'active'`,
        [classId, userId],
      );
      requireCondition(
        target,
        404,
        'membership_not_found',
        'Choose an active member of this class.',
      );
      if (target.role === role) return { userId, role, classId };
      requireCondition(
        !(target.role === 'cr' && role !== 'cr'),
        409,
        'last_cr_required',
        'Assign a replacement CR before changing the current CR’s role.',
      );
      const stamp = now();
      if (role === 'cr' || role === 'gr') {
        await tx.execute({
          sql: "UPDATE memberships SET role = 'student', updated_at = ?, reviewed_by = ? WHERE class_id = ? AND role = ? AND status = 'active'",
          args: [stamp.toISOString(), user.id, classId, role],
        });
      }
      await tx.execute({
        sql: 'UPDATE memberships SET role = ?, updated_at = ?, reviewed_by = ? WHERE id = ?',
        args: [role, stamp.toISOString(), user.id, target.id],
      });
      await audit(tx, user.id, 'representative.assigned', userId, stamp, { classId, role });
      return { userId, role, classId };
    });
  });
}
