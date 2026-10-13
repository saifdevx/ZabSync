import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { subjectAccess } from './academic.js';
import { audit, type CurrentUser } from './auth.js';
import {
  first,
  inWriteTransaction,
  numberValue,
  rows,
  stringValue,
  type Database,
  type SqlRow,
} from './db.js';
import { requireCondition } from './errors.js';
import { routeId, type RouteContext } from './routes.js';
import { requireFeature, requireWritable } from './site-settings.js';

export const CHAT_MAX_BODY = 2000;
export const CHAT_MAX_MESSAGES = 10_000;
export const CHAT_MAX_TOTAL_MESSAGES = 100_000;
const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      'Remove control characters.',
    );
const uuid = z.uuid();
const pageQuery = z
  .object({
    before: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(40),
  })
  .strict();
const messageForm = z
  .object({
    body: cleanText(CHAT_MAX_BODY),
    clientKey: uuid,
    resourceId: uuid.nullable().optional(),
  })
  .strict();
const editForm = z
  .object({ body: cleanText(CHAT_MAX_BODY), version: z.number().int().positive() })
  .strict();
const versionForm = z.object({ version: z.number().int().positive() }).strict();
const modeForm = z
  .object({ mode: z.enum(['members', 'admins']), version: z.number().int().min(0) })
  .strict();
const reportForm = z.object({ reason: cleanText(500) }).strict();
const muteForm = z
  .object({
    minutes: z.union([z.literal(0), z.literal(60), z.literal(1440), z.literal(10080)]),
    reason: z.string().trim().max(200).default(''),
  })
  .strict();

function cursor(row: SqlRow) {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url');
}
function readCursor(value: string | undefined): [string, string] | null {
  if (!value) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    decoded = null;
  }
  const result = z.tuple([z.iso.datetime(), uuid]).safeParse(decoded);
  requireCondition(
    result.success,
    400,
    'invalid_cursor',
    'Refresh the conversation and try again.',
  );
  return result.data;
}

async function chatAccess(db: Database, actor: CurrentUser, subjectId: string, manage = false) {
  await requireFeature(db, 'chat');
  await requireFeature(db, 'subjects');
  return subjectAccess(db, actor, subjectId, manage);
}

async function settings(db: Database, subjectId: string) {
  const row = await first(db, 'SELECT * FROM subject_chat_settings WHERE subject_id=?', [
    subjectId,
  ]);
  return {
    mode: row?.mode === 'members' ? ('members' as const) : ('admins' as const),
    version: numberValue(row?.version),
  };
}

/** SQL counter survives restarts and serializes across app instances. Counts edits/reports as well as posts. */
async function consumeWrite(db: Database, userId: string, now: Date) {
  const bucket = now.toISOString().slice(0, 16);
  const day = now.toISOString().slice(0, 10);
  const minute = await first(
    db,
    'SELECT writes FROM chat_write_windows WHERE user_id=? AND bucket=?',
    [userId, bucket],
  );
  const daily = await first(
    db,
    'SELECT COALESCE(SUM(writes),0) AS total FROM chat_write_windows WHERE user_id=? AND bucket>=? AND bucket<?',
    [userId, day, `${day}Z`],
  );
  requireCondition(
    numberValue(minute?.writes) < 12 && numberValue(daily?.total) < 500,
    429,
    'chat_rate_limited',
    'Please slow down. Chat allows 12 changes per minute and 500 per day.',
  );
  await db.execute({
    sql: 'INSERT INTO chat_write_windows(user_id,bucket,writes) VALUES (?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET writes=writes+1',
    args: [userId, bucket],
  });
  // Bounded housekeeping on writes; indexes make this cheap after the first write of each day.
  await db.execute({
    sql: 'DELETE FROM chat_write_windows WHERE bucket<?',
    args: [new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10)],
  });
}

async function canPost(
  db: Database,
  actor: CurrentUser,
  subjectId: string,
  manage: boolean,
  now: Date,
) {
  if (manage) return;
  requireCondition(
    (await settings(db, subjectId)).mode === 'members',
    403,
    'chat_read_only',
    'Only class admins can post in this conversation right now.',
  );
  const mute = await first(
    db,
    'SELECT muted_until FROM subject_chat_mutes WHERE subject_id=? AND user_id=? AND muted_until>?',
    [subjectId, actor.id, now.toISOString()],
  );
  requireCondition(
    !mute,
    403,
    'chat_muted',
    'Posting is temporarily paused for your account in this subject.',
  );
}

async function activeResource(db: Database, subjectId: string, resourceId: string | null) {
  if (!resourceId) return;
  await requireFeature(db, 'resources');
  const resource = await first(
    db,
    "SELECT id FROM resources WHERE id=? AND subject_id=? AND deleted_at IS NULL AND storage_state='ready'",
    [resourceId, subjectId],
  );
  requireCondition(
    resource,
    404,
    'resource_not_found',
    'Choose an available resource from this subject.',
  );
}

function record(row: SqlRow, actorId: string, canManage: boolean) {
  const deleted = Boolean(row.deleted_at);
  return {
    id: stringValue(row.id),
    userId: stringValue(row.user_id),
    authorName: stringValue(row.author_name),
    body: deleted ? '' : stringValue(row.body),
    resourceId: !deleted && row.resource_available ? stringValue(row.resource_id) : null,
    resourceTitle: !deleted && row.resource_available ? stringValue(row.resource_title) : null,
    resourceUnavailable: !deleted && Boolean(row.resource_id) && !row.resource_available,
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    deleted,
    version: numberValue(row.version),
    canEdit: !deleted && row.user_id === actorId,
    canDelete: !deleted && (row.user_id === actorId || canManage),
    canMute: canManage && numberValue(row.author_can_be_muted) === 1 && row.user_id !== actorId,
    reportCount: canManage ? numberValue(row.report_count) : 0,
    mutedUntil: canManage && row.muted_until ? stringValue(row.muted_until) : null,
  };
}

const messageSelect = `SELECT m.*,u.display_name AS author_name,r.title AS resource_title,
  CASE WHEN r.id IS NOT NULL AND r.subject_id=m.subject_id AND r.deleted_at IS NULL AND r.storage_state='ready' THEN 1 ELSE 0 END AS resource_available,
  (SELECT COUNT(*) FROM subject_chat_reports report WHERE report.message_id=m.id AND report.resolved_at IS NULL) AS report_count,
  (SELECT muted_until FROM subject_chat_mutes mute WHERE mute.subject_id=m.subject_id AND mute.user_id=m.user_id) AS muted_until
  ,CASE WHEN u.role='student' AND u.status='active' AND EXISTS(SELECT 1 FROM memberships member
    JOIN subjects parent ON parent.class_id=member.class_id JOIN student_sections binding ON binding.user_id=member.user_id AND binding.class_id=member.class_id
    JOIN subject_enrollments enrollment ON enrollment.subject_id=parent.id AND enrollment.user_id=member.user_id
    WHERE parent.id=m.subject_id AND member.user_id=u.id AND member.role='student' AND member.status='active' AND binding.needs_resolution=0 AND enrollment.status='active') THEN 1 ELSE 0 END AS author_can_be_muted
  FROM subject_chat_messages m JOIN users u ON u.id=m.user_id LEFT JOIN resources r ON r.id=m.resource_id`;

export function registerChatRoutes(app: FastifyInstance, context: RouteContext) {
  const { db, authenticate, now } = context;
  app.get('/api/subjects/:id/chat', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      query = pageQuery.parse(request.query);
    const result = await chatAccess(db, actor, subjectId),
      before = readCursor(query.before);
    const list = await rows(
      db,
      `${messageSelect} WHERE m.subject_id=? ${before ? 'AND (m.created_at<? OR (m.created_at=? AND m.id<?))' : ''} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,
      [subjectId, ...(before ? [before[0], before[0], before[1]] : []), query.limit + 1],
    );
    const more = list.length > query.limit;
    if (more) list.pop();
    const mute = await first(
      db,
      'SELECT muted_until FROM subject_chat_mutes WHERE subject_id=? AND user_id=? AND muted_until>?',
      [subjectId, actor.id, now().toISOString()],
    );
    const config = await settings(db, subjectId);
    return {
      messages: list.map((row) => record(row, actor.id, result.canManage)).reverse(),
      nextCursor: more && list.length ? cursor(list[list.length - 1]!) : null,
      settings: {
        ...config,
        canManage: result.canManage,
        canPost: result.canManage || (config.mode === 'members' && !mute),
        mutedUntil: mute ? stringValue(mute.muted_until) : null,
      },
      limits: { maxCharacters: CHAT_MAX_BODY, maxMessages: CHAT_MAX_MESSAGES },
      serverTime: now().toISOString(),
    };
  });

  app.patch('/api/subjects/:id/chat/settings', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      form = modeForm.parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await chatAccess(tx, actor, subjectId, true);
      const current = await settings(tx, subjectId);
      requireCondition(
        form.version === current.version,
        409,
        'record_changed',
        'Chat settings changed. Refresh before saving.',
      );
      await tx.execute({
        sql: `INSERT INTO subject_chat_settings(subject_id,mode,version,updated_by,updated_at) VALUES (?,?,1,?,?)
        ON CONFLICT(subject_id) DO UPDATE SET mode=excluded.mode,version=subject_chat_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        args: [subjectId, form.mode, actor.id, timestamp.toISOString()],
      });
      await audit(tx, actor.id, 'chat.mode_changed', subjectId, timestamp, { mode: form.mode });
    });
    return { settings: await settings(db, subjectId) };
  });

  app.post('/api/subjects/:id/chat/messages', async (request, reply) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      form = messageForm.parse(request.body),
      timestamp = now();
    const result = await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const access = await chatAccess(tx, actor, subjectId);
      const previous = await first(
        tx,
        'SELECT * FROM subject_chat_messages WHERE subject_id=? AND user_id=? AND client_key=?',
        [subjectId, actor.id, form.clientKey],
      );
      if (previous) {
        requireCondition(
          previous.body === form.body &&
            (previous.resource_id || null) === (form.resourceId || null),
          409,
          'idempotency_conflict',
          'This send attempt has already been used. Refresh before sending a new message.',
        );
        return { id: stringValue(previous.id), replayed: true };
      }
      await canPost(tx, actor, subjectId, access.canManage, timestamp);
      await activeResource(tx, subjectId, form.resourceId || null);
      const count = await first(
        tx,
        'SELECT COUNT(*) AS count FROM subject_chat_messages WHERE subject_id=?',
        [subjectId],
      );
      requireCondition(
        numberValue(count?.count) < CHAT_MAX_MESSAGES,
        409,
        'chat_capacity',
        'This conversation has reached its message limit. Ask the owner to review its retention.',
      );
      const total = await first(tx, 'SELECT COUNT(*) AS count FROM subject_chat_messages');
      requireCondition(
        numberValue(total?.count) < CHAT_MAX_TOTAL_MESSAGES,
        409,
        'chat_capacity',
        'The application chat allowance is full. The owner can review its storage and retention.',
      );
      await consumeWrite(tx, actor.id, timestamp);
      const id = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO subject_chat_messages(id,subject_id,user_id,client_key,body,resource_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        args: [
          id,
          subjectId,
          actor.id,
          form.clientKey,
          form.body,
          form.resourceId || null,
          timestamp.toISOString(),
          timestamp.toISOString(),
        ],
      });
      return { id, replayed: false };
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.patch('/api/subjects/:id/chat/messages/:messageId', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      messageId = routeId(request, 'messageId'),
      form = editForm.parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const access = await chatAccess(tx, actor, subjectId);
      await canPost(tx, actor, subjectId, access.canManage, timestamp);
      const row = await first(
        tx,
        'SELECT * FROM subject_chat_messages WHERE id=? AND subject_id=? AND deleted_at IS NULL',
        [messageId, subjectId],
      );
      requireCondition(row, 404, 'message_not_found', 'This message is no longer available.');
      requireCondition(
        row.user_id === actor.id,
        403,
        'message_owner_required',
        'You can edit only your own messages.',
      );
      requireCondition(
        numberValue(row.version) === form.version,
        409,
        'record_changed',
        'This message changed. Refresh before editing.',
      );
      await consumeWrite(tx, actor.id, timestamp);
      await tx.execute({
        sql: 'UPDATE subject_chat_messages SET body=?,version=version+1,updated_at=? WHERE id=?',
        args: [form.body, timestamp.toISOString(), messageId],
      });
    });
    return { ok: true };
  });

  app.delete('/api/subjects/:id/chat/messages/:messageId', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      messageId = routeId(request, 'messageId'),
      form = versionForm.parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const access = await chatAccess(tx, actor, subjectId);
      const row = await first(
        tx,
        'SELECT * FROM subject_chat_messages WHERE id=? AND subject_id=?',
        [messageId, subjectId],
      );
      requireCondition(row, 404, 'message_not_found', 'This message is no longer available.');
      requireCondition(
        access.canManage || row.user_id === actor.id,
        403,
        'message_owner_required',
        'You can remove only your own messages.',
      );
      if (row.deleted_at) return;
      requireCondition(
        numberValue(row.version) === form.version,
        409,
        'record_changed',
        'This message changed. Refresh before deleting.',
      );
      await consumeWrite(tx, actor.id, timestamp);
      await tx.execute({
        sql: "UPDATE subject_chat_messages SET body='',deleted_at=?,deleted_by=?,updated_at=?,version=version+1 WHERE id=?",
        args: [timestamp.toISOString(), actor.id, timestamp.toISOString(), messageId],
      });
      await tx.execute({
        sql: 'UPDATE subject_chat_reports SET resolved_at=?,resolved_by=? WHERE message_id=? AND resolved_at IS NULL',
        args: [timestamp.toISOString(), actor.id, messageId],
      });
      await audit(tx, actor.id, 'chat.message_removed', messageId, timestamp, { subjectId });
    });
    return { ok: true };
  });

  app.post('/api/subjects/:id/chat/messages/:messageId/report', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      messageId = routeId(request, 'messageId'),
      form = reportForm.parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await chatAccess(tx, actor, subjectId);
      const row = await first(
        tx,
        'SELECT user_id FROM subject_chat_messages WHERE id=? AND subject_id=? AND deleted_at IS NULL',
        [messageId, subjectId],
      );
      requireCondition(row, 404, 'message_not_found', 'This message is no longer available.');
      requireCondition(
        row.user_id !== actor.id,
        400,
        'own_message',
        'Remove your own message instead.',
      );
      const prior = await first(
        tx,
        'SELECT message_id FROM subject_chat_reports WHERE message_id=? AND reporter_id=?',
        [messageId, actor.id],
      );
      if (prior) return;
      await consumeWrite(tx, actor.id, timestamp);
      await tx.execute({
        sql: 'INSERT INTO subject_chat_reports(message_id,reporter_id,reason,created_at) VALUES (?,?,?,?)',
        args: [messageId, actor.id, form.reason, timestamp.toISOString()],
      });
    });
    return { ok: true };
  });

  app.get('/api/subjects/:id/chat/reports', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request);
    await chatAccess(db, actor, subjectId, true);
    const reports = await rows(
      db,
      `SELECT report.message_id,report.reason,report.created_at,u.display_name AS reporter_name,m.body
      FROM subject_chat_reports report JOIN subject_chat_messages m ON m.id=report.message_id JOIN users u ON u.id=report.reporter_id
      WHERE m.subject_id=? AND report.resolved_at IS NULL ORDER BY report.created_at ASC LIMIT 100`,
      [subjectId],
    );
    return {
      reports: reports.map((r) => ({
        messageId: stringValue(r.message_id),
        reason: stringValue(r.reason),
        createdAt: stringValue(r.created_at),
        reporterName: stringValue(r.reporter_name),
        body: stringValue(r.body),
      })),
    };
  });

  app.post('/api/subjects/:id/chat/messages/:messageId/resolve-reports', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      messageId = routeId(request, 'messageId'),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await chatAccess(tx, actor, subjectId, true);
      requireCondition(
        await first(tx, 'SELECT id FROM subject_chat_messages WHERE id=? AND subject_id=?', [
          messageId,
          subjectId,
        ]),
        404,
        'message_not_found',
        'This message is no longer available.',
      );
      await tx.execute({
        sql: 'UPDATE subject_chat_reports SET resolved_at=?,resolved_by=? WHERE message_id=? AND resolved_at IS NULL',
        args: [timestamp.toISOString(), actor.id, messageId],
      });
      await audit(tx, actor.id, 'chat.reports_resolved', messageId, timestamp, { subjectId });
    });
    return { ok: true };
  });

  app.post('/api/subjects/:id/chat/mutes/:userId', async (request) => {
    const actor = await authenticate(request),
      subjectId = routeId(request),
      userId = z
        .string()
        .min(1)
        .max(128)
        .parse((request.params as Record<string, string>).userId),
      form = muteForm.parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const access = await chatAccess(tx, actor, subjectId, true);
      const target = await first(
        tx,
        `SELECT u.role AS global_role,m.role FROM users u JOIN memberships m ON m.user_id=u.id
        WHERE u.id=? AND u.status='active' AND m.class_id=? AND m.status='active'`,
        [userId, access.classId],
      );
      requireCondition(target, 404, 'member_not_found', 'This member is not available.');
      requireCondition(
        target.global_role !== 'master' && target.role === 'student',
        400,
        'admin_mute_forbidden',
        'Class admins cannot be muted. The owner manages their role.',
      );
      requireCondition(
        await first(
          tx,
          `SELECT 1 FROM subject_enrollments enrollment JOIN student_sections binding ON binding.user_id=enrollment.user_id
        WHERE enrollment.user_id=? AND enrollment.subject_id=? AND enrollment.status='active' AND binding.class_id=? AND binding.needs_resolution=0`,
          [userId, subjectId, access.classId],
        ),
        404,
        'member_not_found',
        'This subject member is not available.',
      );
      if (form.minutes === 0)
        await tx.execute({
          sql: 'DELETE FROM subject_chat_mutes WHERE subject_id=? AND user_id=?',
          args: [subjectId, userId],
        });
      else
        await tx.execute({
          sql: `INSERT INTO subject_chat_mutes(subject_id,user_id,muted_until,reason,updated_by,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(subject_id,user_id) DO UPDATE SET muted_until=excluded.muted_until,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
          args: [
            subjectId,
            userId,
            new Date(timestamp.getTime() + form.minutes * 60000).toISOString(),
            form.reason,
            actor.id,
            timestamp.toISOString(),
          ],
        });
      await audit(
        tx,
        actor.id,
        form.minutes ? 'chat.member_muted' : 'chat.member_unmuted',
        subjectId,
        timestamp,
        { userId, minutes: form.minutes },
      );
    });
    return { ok: true };
  });
}
