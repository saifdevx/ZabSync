import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Client, InValue } from '@libsql/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
import { DEMO_CLASS_ID, DEMO_OTHER_CLASS_ID, DEMO_USERS } from './demo.js';
import { requireCondition } from './errors.js';
import { sectionScopeSql, subjectScopeSql } from './section-access.js';
import {
  classAccess as baseClassAccess,
  requireMaster,
  routeId,
  type RouteContext,
} from './routes.js';
import { getSettings, requireFeature, requireWritable } from './site-settings.js';
import {
  attachmentDisposition,
  CLASS_STORAGE_BYTES,
  createPrivateStorage,
  MAX_RESOURCE_BYTES,
  loadResourceLimits,
  temporaryUpload,
  validateResourceFile,
  type PrivateStorage,
} from './storage.js';

const uuid = z.uuid();
const boolQuery = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const pageFields = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};
const subjectQuery = z
  .object({ ...pageFields, deleted: boolQuery, q: z.string().trim().max(100).default('') })
  .strict();
const contentQuery = z.object({
  ...pageFields,
  classId: uuid.optional(),
  subjectId: uuid.optional(),
  q: z.string().trim().max(100).default(''),
  saved: boolQuery,
  deleted: boolQuery,
});
const announcementQuery = contentQuery
  .extend({ scope: z.enum(['global', 'class', 'subject']).optional() })
  .strict();
const resourceQuery = contentQuery.strict();
const subjectForm = z
  .object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().max(20).default(''),
    instructor: z.string().trim().max(80).default(''),
    description: z.string().trim().max(2000).default(''),
    color: z.enum(['blue', 'teal', 'purple', 'amber', 'rose']).default('blue'),
  })
  .strict();
const resourceForm = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();
const announcementContent = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(10_000),
    priority: z.enum(['normal', 'important', 'urgent']).default('normal'),
    pinned: z.boolean().default(false),
    resourceIds: z.array(uuid).max(5).default([]),
  })
  .strict();
const announcementForm = announcementContent
  .extend({
    scope: z.enum(['global', 'class', 'subject']),
    classId: uuid.optional(),
    subjectId: uuid.optional(),
  })
  .strict()
  .superRefine((form, context) => {
    if (form.scope === 'global' && (form.classId || form.subjectId || form.resourceIds.length))
      context.addIssue({
        code: 'custom',
        message: 'Global notices cannot contain class-private attachments or class identifiers.',
      });
    if (form.scope !== 'global' && !form.classId)
      context.addIssue({ code: 'custom', message: 'Select a class.' });
    if ((form.scope === 'subject') !== Boolean(form.subjectId))
      context.addIssue({
        code: 'custom',
        message: 'Select a subject only for a subject announcement.',
      });
  });

type ContentFilters = z.infer<typeof resourceQuery>;
type AnnouncementFilters = z.infer<typeof announcementQuery>;

/** Management visibility is also needed for read-only trash. Mutations call requireWritable separately. */
async function classAccess(db: Database, actor: CurrentUser, classId: string, manage = false) {
  const access = await baseClassAccess(db, actor, classId);
  requireCondition(
    !manage || access.role !== 'student',
    403,
    'admin_required',
    'Only this class’s admins can do this.',
  );
  return access;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function userAllowedSql(): string {
  return "EXISTS (SELECT 1 FROM users actor WHERE actor.id = ? AND actor.status = 'active')";
}

/** The same SQL access predicate powers feeds, bookmarks, notifications and counts. */
function visibilitySql(
  alias: 'a' | 'r',
  userId: string,
  subjectsEnabled: boolean,
  deleted = false,
) {
  const section = `(EXISTS(SELECT 1 FROM classes classroom WHERE classroom.id=${alias}.class_id AND classroom.status='active')
    AND (viewer.role='master' OR ${sectionScopeSql(`${alias}.class_id`, 'viewer.id', deleted)}))`;
  const global =
    alias === 'a' ? `(a.scope='global'${deleted ? " AND viewer.role='master'" : ''}) OR ` : '';
  return {
    sql: `EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=? AND viewer.status='active' AND (${global}${section})
      AND (${alias}.subject_id IS NULL OR (${subjectsEnabled ? '1=1' : '0=1'}
        AND EXISTS(SELECT 1 FROM subjects parent WHERE parent.id=${alias}.subject_id AND parent.class_id=${alias}.class_id AND parent.deleted_at IS NULL)
        AND (viewer.role='master' OR ${subjectScopeSql(`${alias}.class_id`, `${alias}.subject_id`, 'viewer.id')}))))
      AND ${alias}.deleted_at IS ${deleted ? 'NOT ' : ''}NULL${alias === 'r' && !deleted ? " AND r.storage_state='ready'" : ''}`,
    args: [userId] as InValue[],
  };
}

function manageSql(alias: 'a' | 'r' | 's') {
  return `(EXISTS(SELECT 1 FROM users owner WHERE owner.id=? AND owner.status='active' AND owner.role='master')
    OR ${sectionScopeSql(`${alias}.class_id`, '?', true)}) AS can_manage`;
}

function bookmarkSql(alias: 'a' | 'r', kind: 'announcement' | 'resource') {
  return `EXISTS(SELECT 1 FROM bookmarks b WHERE b.user_id=? AND b.kind='${kind}' AND b.target_id=${alias}.id) AS saved`;
}

function resourceRecord(row: SqlRow) {
  return {
    id: stringValue(row.id),
    classId: stringValue(row.class_id),
    subjectId: row.subject_id ? stringValue(row.subject_id) : null,
    className: stringValue(row.class_name),
    subjectName: row.subject_name ? stringValue(row.subject_name) : null,
    title: stringValue(row.title),
    description: stringValue(row.description),
    filename: stringValue(row.filename),
    mimeType: stringValue(row.mime_type),
    sizeBytes: numberValue(row.size_bytes),
    authorName: stringValue(row.author_name),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    deletedAt: row.deleted_at ? stringValue(row.deleted_at) : null,
    canManage: numberValue(row.can_manage) === 1,
    saved: numberValue(row.saved) === 1,
    storageState: stringValue(row.storage_state),
  };
}

function subjectRecord(row: SqlRow, canManage: boolean) {
  return {
    id: stringValue(row.id),
    classId: stringValue(row.class_id),
    className: stringValue(row.class_name),
    name: stringValue(row.name),
    code: stringValue(row.code),
    instructor: stringValue(row.instructor),
    description: stringValue(row.description),
    color: stringValue(row.color),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    deletedAt: row.deleted_at ? stringValue(row.deleted_at) : null,
    canManage,
    resourceCount: numberValue(row.resource_count),
    announcementCount: numberValue(row.announcement_count),
  };
}

const subjectSelect = `SELECT s.*, c.name AS class_name,
  (SELECT COUNT(*) FROM resources r WHERE r.subject_id=s.id AND r.deleted_at IS NULL AND r.storage_state='ready') AS resource_count,
  (SELECT COUNT(*) FROM announcements a WHERE a.subject_id=s.id AND a.deleted_at IS NULL) AS announcement_count
  FROM subjects s JOIN classes c ON c.id=s.class_id`;
const resourceFrom =
  'FROM resources r JOIN classes c ON c.id=r.class_id LEFT JOIN subjects s ON s.id=r.subject_id JOIN users u ON u.id=r.created_by';
const announcementFrom =
  'FROM announcements a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects s ON s.id=a.subject_id JOIN users u ON u.id=a.created_by';

export async function subjectAccess(
  db: Database,
  actor: CurrentUser,
  id: string,
  manage = false,
  allowDeleted = false,
) {
  await requireFeature(db, 'subjects');
  const subject = await first(db, `${subjectSelect} WHERE s.id=?`, [id]);
  requireCondition(subject, 404, 'subject_not_found', 'This subject is not available to you.');
  const access = await classAccess(db, actor, stringValue(subject.class_id), manage);
  requireCondition(
    allowDeleted || !subject.deleted_at,
    404,
    'subject_not_found',
    'This subject is not available to you.',
  );
  if (access.role === 'student') {
    const enrollment = await first(
      db,
      "SELECT status FROM subject_enrollments WHERE subject_id=? AND user_id=? AND status='active'",
      [id, actor.id],
    );
    requireCondition(
      enrollment,
      404,
      'subject_not_found',
      'Join this subject with its code before opening it.',
    );
  }
  return {
    subject,
    access,
    classId: stringValue(subject.class_id),
    canManage: access.role !== 'student',
  };
}

async function contentAccess(
  db: Database,
  actor: CurrentUser,
  id: string,
  kind: 'resource' | 'announcement',
  manage = false,
  allowDeleted = false,
) {
  await requireFeature(db, kind === 'resource' ? 'resources' : 'announcements');
  const table = kind === 'resource' ? 'resources' : 'announcements';
  const row = await first(db, `SELECT * FROM ${table} WHERE id=?`, [id]);
  requireCondition(row, 404, 'content_not_found', 'This content is not available to you.');
  if (kind === 'announcement' && row.scope === 'global') {
    if (manage || allowDeleted) await requireMaster(db, actor);
    else
      requireCondition(
        await first(db, "SELECT id FROM users WHERE id=? AND status='active'", [actor.id]),
        403,
        'account_suspended',
        'This account is not active.',
      );
  } else {
    await classAccess(db, actor, stringValue(row.class_id), manage || allowDeleted);
  }
  if (row.subject_id) {
    const parent = await subjectAccess(
      db,
      actor,
      stringValue(row.subject_id),
      manage || allowDeleted,
    );
    requireCondition(
      parent.subject.class_id === row.class_id,
      404,
      'content_not_found',
      'This content is not available to you.',
    );
  }
  requireCondition(
    allowDeleted || !row.deleted_at,
    404,
    'content_not_found',
    'This content is not available to you.',
  );
  if (kind === 'resource' && !allowDeleted)
    requireCondition(
      row.storage_state === 'ready',
      404,
      'file_unavailable',
      'This file is not available.',
    );
  return row;
}

async function resourceView(db: Database, actor: CurrentUser, id: string) {
  const row = await first(
    db,
    `SELECT r.*,c.name AS class_name,s.name AS subject_name,u.display_name AS author_name,${manageSql('r')},${bookmarkSql('r', 'resource')} ${resourceFrom} WHERE r.id=?`,
    [actor.id, actor.id, actor.id, id],
  );
  requireCondition(row, 404, 'resource_not_found', 'This file was not found.');
  return resourceRecord(row);
}

async function announcementRecords(db: Database, actor: CurrentUser, list: SqlRow[]) {
  const settings = await getSettings(db);
  const attachments = new Map<string, ReturnType<typeof resourceRecord>[]>();
  // At most 100 notices, each at most 5 attachments; one bounded query avoids N+1 database round trips.
  if (list.length && settings.features.resources) {
    const visible = visibilitySql('r', actor.id, settings.features.subjects);
    const linked = await rows(
      db,
      `SELECT r.*,ar.announcement_id,c.name AS class_name,s.name AS subject_name,u.display_name AS author_name,${manageSql('r')},${bookmarkSql('r', 'resource')}
       ${resourceFrom} JOIN announcement_resources ar ON ar.resource_id=r.id
       WHERE ar.announcement_id IN (${list.map(() => '?').join(',')}) AND ${visible.sql} ORDER BY r.title LIMIT 500`,
      [actor.id, actor.id, actor.id, ...list.map((row) => stringValue(row.id)), ...visible.args],
    );
    for (const resource of linked) {
      const id = stringValue(resource.announcement_id);
      attachments.set(id, [...(attachments.get(id) || []), resourceRecord(resource)]);
    }
  }
  return list.map((row) => ({
    id: stringValue(row.id),
    scope: stringValue(row.scope) as 'global' | 'class' | 'subject',
    classId: row.class_id ? stringValue(row.class_id) : null,
    subjectId: row.subject_id ? stringValue(row.subject_id) : null,
    className: row.class_name ? stringValue(row.class_name) : null,
    subjectName: row.subject_name ? stringValue(row.subject_name) : null,
    title: stringValue(row.title),
    body: stringValue(row.body),
    priority: stringValue(row.priority),
    pinned: numberValue(row.pinned) === 1,
    authorName: stringValue(row.author_name),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    deletedAt: row.deleted_at ? stringValue(row.deleted_at) : null,
    canManage: numberValue(row.can_manage) === 1,
    saved: numberValue(row.saved) === 1,
    resources: attachments.get(stringValue(row.id)) || [],
  }));
}

async function announcementView(db: Database, actor: CurrentUser, id: string) {
  const row = await first(
    db,
    `SELECT a.*,c.name AS class_name,s.name AS subject_name,u.display_name AS author_name,${manageSql('a')},${bookmarkSql('a', 'announcement')} ${announcementFrom} WHERE a.id=?`,
    [actor.id, actor.id, actor.id, id],
  );
  requireCondition(row, 404, 'announcement_not_found', 'This announcement was not found.');
  return (await announcementRecords(db, actor, [row]))[0]!;
}

async function contentWhere(
  db: Database,
  actor: CurrentUser,
  kind: 'resource' | 'announcement',
  query: ContentFilters | AnnouncementFilters,
) {
  if (query.classId) await classAccess(db, actor, query.classId, query.deleted);
  if (query.subjectId) {
    const parent = await subjectAccess(db, actor, query.subjectId, query.deleted);
    requireCondition(
      !query.classId || query.classId === parent.subject.class_id,
      400,
      'subject_class_mismatch',
      'This subject does not belong to the selected class.',
    );
  }
  const settings = await getSettings(db);
  const alias = kind === 'resource' ? 'r' : 'a';
  const visible = visibilitySql(alias, actor.id, settings.features.subjects, query.deleted);
  const clauses = [visible.sql];
  const args = [...visible.args];
  if (query.classId) {
    clauses.push(kind === 'announcement' ? "(a.class_id=? OR a.scope='global')" : 'r.class_id=?');
    args.push(query.classId);
  }
  if (query.subjectId) {
    clauses.push(`${alias}.subject_id=?`);
    args.push(query.subjectId);
  }
  if (kind === 'announcement' && 'scope' in query && query.scope) {
    clauses.push('a.scope=?');
    args.push(query.scope);
  }
  if (query.q) {
    clauses.push(
      kind === 'resource'
        ? "(r.title LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\' OR r.filename LIKE ? ESCAPE '\\')"
        : "(a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\')",
    );
    args.push(likePattern(query.q), likePattern(query.q));
    if (kind === 'resource') args.push(likePattern(query.q));
  }
  if (query.saved) {
    clauses.push(
      `EXISTS(SELECT 1 FROM bookmarks b WHERE b.user_id=? AND b.kind=? AND b.target_id=${alias}.id)`,
    );
    args.push(actor.id, kind);
  }
  return { sql: clauses.join(' AND '), args };
}

async function checkAttachments(
  db: Database,
  actor: CurrentUser,
  form: { scope: string; classId?: string; subjectId?: string; resourceIds: string[] },
) {
  requireCondition(
    new Set(form.resourceIds).size === form.resourceIds.length,
    400,
    'duplicate_attachment',
    'A file can only be attached once.',
  );
  requireCondition(
    form.scope !== 'global' || !form.resourceIds.length,
    400,
    'private_attachment',
    'Global notices cannot attach class-private files.',
  );
  for (const id of form.resourceIds) {
    const resource = await contentAccess(db, actor, id, 'resource', true);
    requireCondition(
      resource.class_id === form.classId &&
        (form.scope !== 'subject' || resource.subject_id === form.subjectId),
      400,
      'attachment_scope',
      'Attach a file from the same class or subject as this notice.',
    );
  }
}

async function updateAttachments(db: Database, announcementId: string, resourceIds: string[]) {
  await db.execute({
    sql: 'DELETE FROM announcement_resources WHERE announcement_id=?',
    args: [announcementId],
  });
  for (const resourceId of resourceIds)
    await db.execute({
      sql: 'INSERT INTO announcement_resources(announcement_id,resource_id) VALUES (?,?)',
      args: [announcementId, resourceId],
    });
}

export function registerAcademicRoutes(
  app: FastifyInstance,
  context: RouteContext & { storage?: PrivateStorage },
): void {
  const { db, now, authenticate } = context;
  const storage = context.storage || createPrivateStorage();
  const limits = loadResourceLimits(context.config.nodeEnv === 'test' ? {} : process.env);

  app.get('/api/classes/:id/subjects', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'subjects');
    const classId = routeId(request);
    const query = subjectQuery.parse(request.query);
    const access = await classAccess(db, actor, classId, query.deleted);
    const where = `s.class_id=? AND s.deleted_at IS ${query.deleted ? 'NOT ' : ''}NULL AND (s.name LIKE ? ESCAPE '\\' OR s.code LIKE ? ESCAPE '\\')${access.role === 'student' ? " AND EXISTS(SELECT 1 FROM subject_enrollments e WHERE e.subject_id=s.id AND e.user_id=? AND e.status='active')" : ''}`;
    const args = [
      classId,
      likePattern(query.q),
      likePattern(query.q),
      ...(access.role === 'student' ? [actor.id] : []),
    ];
    const list = await rows(
      db,
      `${subjectSelect} WHERE ${where} ORDER BY s.name COLLATE NOCASE,s.id LIMIT ? OFFSET ?`,
      [...args, query.limit, query.offset],
    );
    const count = await first(db, `SELECT COUNT(*) AS n FROM subjects s WHERE ${where}`, args);
    const flags = (await getSettings(db)).features;
    return {
      subjects: list.map((row) =>
        subjectRecord(
          {
            ...row,
            resource_count: flags.resources ? row.resource_count : 0,
            announcement_count: flags.announcements ? row.announcement_count : 0,
          } as SqlRow,
          access.role !== 'student',
        ),
      ),
      pagination: { limit: query.limit, offset: query.offset, total: numberValue(count?.n) },
    };
  });

  app.post(
    '/api/classes/:id/subjects',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await authenticate(request);
      const classId = routeId(request);
      const form = subjectForm.parse(request.body);
      const subject = await inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, actor);
        await requireFeature(tx, 'subjects');
        await classAccess(tx, actor, classId, true);
        const count = await first(
          tx,
          'SELECT COUNT(*) AS n FROM subjects WHERE class_id=? AND deleted_at IS NULL',
          [classId],
        );
        requireCondition(
          numberValue(count?.n) < 100,
          409,
          'subject_limit',
          'This class already has 100 active subjects.',
        );
        const id = randomUUID(),
          stamp = now();
        await tx.execute({
          sql: 'INSERT INTO subjects(id,class_id,name,code,instructor,description,color,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            classId,
            form.name,
            form.code,
            form.instructor,
            form.description,
            form.color,
            actor.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await audit(tx, actor.id, 'subject.created', id, stamp, { classId });
        return subjectRecord((await first(tx, `${subjectSelect} WHERE s.id=?`, [id]))!, true);
      });
      return reply.code(201).send({ subject });
    },
  );

  app.get('/api/subjects/:id', async (request) => {
    const actor = await authenticate(request);
    const found = await subjectAccess(db, actor, routeId(request));
    const flags = (await getSettings(db)).features;
    return {
      subject: subjectRecord(
        {
          ...found.subject,
          resource_count: flags.resources ? found.subject.resource_count : 0,
          announcement_count: flags.announcements ? found.subject.announcement_count : 0,
        } as SqlRow,
        found.access.role !== 'student',
      ),
    };
  });

  app.patch('/api/subjects/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = subjectForm.parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await subjectAccess(tx, actor, id, true);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE subjects SET name=?,code=?,instructor=?,description=?,color=?,updated_at=? WHERE id=?',
        args: [
          form.name,
          form.code,
          form.instructor,
          form.description,
          form.color,
          stamp.toISOString(),
          id,
        ],
      });
      await audit(tx, actor.id, 'subject.updated', id, stamp);
      return {
        subject: subjectRecord((await first(tx, `${subjectSelect} WHERE s.id=?`, [id]))!, true),
      };
    });
  });

  for (const action of ['trash', 'restore'] as const) {
    app.route({
      method: action === 'trash' ? 'DELETE' : 'POST',
      url: `/api/subjects/:id${action === 'restore' ? '/restore' : ''}`,
      handler: async (request) => {
        const actor = await authenticate(request),
          id = routeId(request);
        return inWriteTransaction(db, async (tx) => {
          await requireWritable(tx, actor);
          const { subject } = await subjectAccess(tx, actor, id, true, true);
          if (action === 'restore' && subject.deleted_at) {
            const count = await first(
              tx,
              'SELECT COUNT(*) AS n FROM subjects WHERE class_id=? AND deleted_at IS NULL',
              [stringValue(subject.class_id)],
            );
            requireCondition(
              numberValue(count?.n) < 100,
              409,
              'subject_limit',
              'This class already has 100 active subjects.',
            );
          }
          const stamp = now();
          await tx.execute({
            sql: 'UPDATE subjects SET deleted_at=?,updated_at=? WHERE id=?',
            args: [action === 'trash' ? stamp.toISOString() : null, stamp.toISOString(), id],
          });
          await audit(
            tx,
            actor.id,
            `subject.${action === 'trash' ? 'trashed' : 'restored'}`,
            id,
            stamp,
          );
          return {
            subject: subjectRecord((await first(tx, `${subjectSelect} WHERE s.id=?`, [id]))!, true),
          };
        });
      },
    });
  }

  app.get('/api/resources', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'resources');
    const query = resourceQuery.parse(request.query),
      where = await contentWhere(db, actor, 'resource', query);
    const list = await rows(
      db,
      `SELECT r.*,c.name AS class_name,s.name AS subject_name,u.display_name AS author_name,${manageSql('r')},${bookmarkSql('r', 'resource')} ${resourceFrom}
       WHERE ${where.sql} ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?`,
      [actor.id, actor.id, actor.id, ...where.args, query.limit, query.offset],
    );
    const count = await first(
      db,
      `SELECT COUNT(*) AS n ${resourceFrom} WHERE ${where.sql}`,
      where.args,
    );
    let storageUsedBytes: number | null = null;
    if (query.classId)
      storageUsedBytes = numberValue(
        (
          await first(
            db,
            'SELECT COALESCE(SUM(size_bytes),0) AS n FROM resources WHERE class_id=?',
            [query.classId],
          )
        )?.n,
      );
    return {
      resources: list.map(resourceRecord),
      pagination: { limit: query.limit, offset: query.offset, total: numberValue(count?.n) },
      limits,
      storageUsedBytes,
    };
  });

  app.post(
    '/api/classes/:id/resources',
    {
      bodyLimit: limits.fileBytes + 128 * 1024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const actor = await authenticate(request),
        classId = routeId(request);
      await requireFeature(db, 'resources');
      await classAccess(db, actor, classId, true);
      await requireWritable(db, actor);
      const upload = await temporaryUpload(request, limits.fileBytes);
      let objectKey: string | null = null;
      try {
        const form = resourceForm
          .extend({ subjectId: z.preprocess((v) => (v === '' ? undefined : v), uuid.optional()) })
          .strict()
          .parse(upload.fields);
        if (form.subjectId) {
          const parent = await subjectAccess(db, actor, form.subjectId, true);
          requireCondition(
            parent.subject.class_id === classId,
            400,
            'subject_class_mismatch',
            'This subject belongs to another class.',
          );
        }
        const mimeType = await validateResourceFile(upload, limits),
          id = randomUUID();
        objectKey = `resources/${id}${extname(upload.filename).toLowerCase()}`;
        await storage.putFile(objectKey, upload.path, mimeType, {
          userId: actor.id,
          filename: upload.filename,
        });
        const resource = await inWriteTransaction(db, async (tx) => {
          await requireWritable(tx, actor);
          await requireFeature(tx, 'resources');
          await classAccess(tx, actor, classId, true);
          if (form.subjectId) {
            const parent = await subjectAccess(tx, actor, form.subjectId, true);
            requireCondition(
              parent.subject.class_id === classId,
              400,
              'subject_class_mismatch',
              'This subject belongs to another class.',
            );
          }
          const usage = await first(
            tx,
            'SELECT COALESCE(SUM(size_bytes),0) AS n FROM resources WHERE class_id=?',
            [classId],
          );
          requireCondition(
            numberValue(usage?.n) + upload.size <= limits.classBytes,
            409,
            'storage_quota',
            'This section has reached its configured document allowance. Contact the owner or remove unneeded files from trash.',
          );
          const stamp = now();
          await tx.execute({
            sql: 'INSERT INTO resources(id,class_id,subject_id,title,description,filename,mime_type,size_bytes,storage_key,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            args: [
              id,
              classId,
              form.subjectId || null,
              form.title,
              form.description,
              upload.filename,
              mimeType,
              upload.size,
              objectKey!,
              actor.id,
              stamp.toISOString(),
              stamp.toISOString(),
            ],
          });
          await audit(tx, actor.id, 'resource.uploaded', id, stamp, {
            classId,
            subjectId: form.subjectId || null,
            sizeBytes: upload.size,
          });
          return resourceView(tx, actor, id);
        });
        // A successfully committed record owns this object from this point onward.
        objectKey = null;
        return reply.code(201).send({ resource });
      } catch (error) {
        // Delete even after a partially failed remote put; private unreferenced bytes never become a download URL.
        if (objectKey)
          await storage
            .delete(objectKey)
            .catch(() =>
              app.log.error(
                { orphanedPrivateObject: objectKey },
                'A private upload needs storage reconciliation.',
              ),
            );
        throw error;
      } finally {
        await upload.cleanup();
      }
    },
  );

  app.get('/api/resources/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request);
    await contentAccess(db, actor, id, 'resource');
    return { resource: await resourceView(db, actor, id) };
  });

  app.get(
    '/api/resources/:id/download',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await authenticate(request),
        id = routeId(request);
      const record = await contentAccess(db, actor, id, 'resource');
      const object = await storage.open(stringValue(record.storage_key));
      if (object.size !== numberValue(record.size_bytes)) {
        object.stream.destroy();
        requireCondition(
          false,
          503,
          'file_unavailable',
          'This file is temporarily unavailable. Contact your class admin.',
        );
      }
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "sandbox; default-src 'none'")
        .header('Content-Disposition', attachmentDisposition(stringValue(record.filename)))
        .header('Content-Length', object.size)
        .type(stringValue(record.mime_type))
        .send(object.stream);
    },
  );

  app.patch('/api/resources/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = resourceForm.parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await contentAccess(tx, actor, id, 'resource', true);
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE resources SET title=?,description=?,updated_at=? WHERE id=?',
        args: [form.title, form.description, stamp.toISOString(), id],
      });
      await audit(tx, actor.id, 'resource.updated', id, stamp);
      return { resource: await resourceView(tx, actor, id) };
    });
  });

  for (const action of ['trash', 'restore'] as const) {
    app.route({
      method: action === 'trash' ? 'DELETE' : 'POST',
      url: `/api/resources/:id${action === 'restore' ? '/restore' : ''}`,
      handler: async (request) => {
        const actor = await authenticate(request),
          id = routeId(request);
        return inWriteTransaction(db, async (tx) => {
          await requireWritable(tx, actor);
          const resource = await contentAccess(tx, actor, id, 'resource', true, true);
          requireCondition(
            resource.storage_state === 'ready',
            409,
            'file_deleting',
            'Finish permanently removing this file before continuing.',
          );
          const stamp = now();
          await tx.execute({
            sql: 'UPDATE resources SET deleted_at=?,updated_at=? WHERE id=?',
            args: [action === 'trash' ? stamp.toISOString() : null, stamp.toISOString(), id],
          });
          await audit(
            tx,
            actor.id,
            `resource.${action === 'trash' ? 'trashed' : 'restored'}`,
            id,
            stamp,
          );
          return { resource: await resourceView(tx, actor, id) };
        });
      },
    });
  }

  app.post('/api/resources/:id/purge', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request);
    const key = await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const resource = await contentAccess(tx, actor, id, 'resource', true, true);
      requireCondition(
        resource.deleted_at,
        409,
        'trash_first',
        'Move this file to trash before permanently removing it.',
      );
      await tx.execute({
        sql: "UPDATE resources SET storage_state='deleting' WHERE id=?",
        args: [id],
      });
      return stringValue(resource.storage_key);
    });
    await storage.delete(key);
    await inWriteTransaction(db, async (tx) => {
      // Finish cleanup even if the initiating class admin changes role after deleting the object.
      // This only completes an already authorized, durable deletion; it cannot change another object.
      const row = await first(
        tx,
        "SELECT id FROM resources WHERE id=? AND storage_key=? AND storage_state='deleting' AND deleted_at IS NOT NULL",
        [id, key],
      );
      if (!row) return;
      await tx.execute({
        sql: "DELETE FROM bookmarks WHERE kind='resource' AND target_id=?",
        args: [id],
      });
      await tx.execute({ sql: 'DELETE FROM resources WHERE id=?', args: [id] });
      await audit(tx, actor.id, 'resource.purged', id, now());
    });
    return { ok: true };
  });

  app.get('/api/announcements', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'announcements');
    const query = announcementQuery.parse(request.query),
      where = await contentWhere(db, actor, 'announcement', query);
    const list = await rows(
      db,
      `SELECT a.*,c.name AS class_name,s.name AS subject_name,u.display_name AS author_name,${manageSql('a')},${bookmarkSql('a', 'announcement')} ${announcementFrom}
       WHERE ${where.sql} ORDER BY a.pinned DESC, CASE a.priority WHEN 'urgent' THEN 2 WHEN 'important' THEN 1 ELSE 0 END DESC,a.created_at DESC,a.id LIMIT ? OFFSET ?`,
      [actor.id, actor.id, actor.id, ...where.args, query.limit, query.offset],
    );
    const count = await first(
      db,
      `SELECT COUNT(*) AS n ${announcementFrom} WHERE ${where.sql}`,
      where.args,
    );
    return {
      announcements: await announcementRecords(db, actor, list),
      pagination: { limit: query.limit, offset: query.offset, total: numberValue(count?.n) },
    };
  });

  app.post(
    '/api/announcements',
    { bodyLimit: 48 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const actor = await authenticate(request),
        form = announcementForm.parse(request.body);
      const announcement = await inWriteTransaction(db, async (tx) => {
        await requireWritable(tx, actor);
        await requireFeature(tx, 'announcements');
        if (form.scope === 'global') await requireMaster(tx, actor);
        else await classAccess(tx, actor, form.classId!, true);
        if (form.subjectId) {
          const parent = await subjectAccess(tx, actor, form.subjectId, true);
          requireCondition(
            parent.subject.class_id === form.classId,
            400,
            'subject_class_mismatch',
            'This subject does not belong to the selected class.',
          );
        }
        await checkAttachments(tx, actor, form);
        const id = randomUUID(),
          stamp = now();
        await tx.execute({
          sql: 'INSERT INTO announcements(id,scope,class_id,subject_id,title,body,priority,pinned,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          args: [
            id,
            form.scope,
            form.classId || null,
            form.subjectId || null,
            form.title,
            form.body,
            form.priority,
            form.pinned ? 1 : 0,
            actor.id,
            stamp.toISOString(),
            stamp.toISOString(),
          ],
        });
        await updateAttachments(tx, id, form.resourceIds);
        await audit(tx, actor.id, 'announcement.created', id, stamp, {
          scope: form.scope,
          classId: form.classId || null,
        });
        return announcementView(tx, actor, id);
      });
      return reply.code(201).send({ announcement });
    },
  );

  app.get('/api/announcements/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request);
    await contentAccess(db, actor, id, 'announcement');
    return { announcement: await announcementView(db, actor, id) };
  });

  app.patch('/api/announcements/:id', { bodyLimit: 48 * 1024 }, async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = announcementContent
        .extend({ resourceIds: z.array(uuid).max(5).optional() })
        .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const previous = await contentAccess(tx, actor, id, 'announcement', true);
      if (form.resourceIds !== undefined)
        await checkAttachments(tx, actor, {
          scope: stringValue(previous.scope),
          classId: previous.class_id ? stringValue(previous.class_id) : undefined,
          subjectId: previous.subject_id ? stringValue(previous.subject_id) : undefined,
          resourceIds: form.resourceIds,
        });
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE announcements SET title=?,body=?,priority=?,pinned=?,updated_at=? WHERE id=?',
        args: [form.title, form.body, form.priority, form.pinned ? 1 : 0, stamp.toISOString(), id],
      });
      if (form.resourceIds !== undefined) await updateAttachments(tx, id, form.resourceIds);
      await audit(tx, actor.id, 'announcement.updated', id, stamp);
      return { announcement: await announcementView(tx, actor, id) };
    });
  });

  for (const action of ['trash', 'restore'] as const) {
    app.route({
      method: action === 'trash' ? 'DELETE' : 'POST',
      url: `/api/announcements/:id${action === 'restore' ? '/restore' : ''}`,
      handler: async (request) => {
        const actor = await authenticate(request),
          id = routeId(request);
        return inWriteTransaction(db, async (tx) => {
          await requireWritable(tx, actor);
          await contentAccess(tx, actor, id, 'announcement', true, true);
          const stamp = now();
          await tx.execute({
            sql: 'UPDATE announcements SET deleted_at=?,updated_at=? WHERE id=?',
            args: [action === 'trash' ? stamp.toISOString() : null, stamp.toISOString(), id],
          });
          await audit(
            tx,
            actor.id,
            `announcement.${action === 'trash' ? 'trashed' : 'restored'}`,
            id,
            stamp,
          );
          return { announcement: await announcementView(tx, actor, id) };
        });
      },
    });
  }

  for (const saved of [true, false]) {
    app.route({
      method: saved ? 'POST' : 'DELETE',
      url: '/api/bookmarks/:kind/:id',
      handler: async (request) => {
        const actor = await authenticate(request),
          id = routeId(request);
        const { kind } = z
          .object({ kind: z.enum(['resource', 'announcement']) })
          .parse(request.params);
        return inWriteTransaction(db, async (tx) => {
          await requireWritable(tx, actor);
          await contentAccess(tx, actor, id, kind);
          if (saved)
            await tx.execute({
              sql: 'INSERT OR IGNORE INTO bookmarks(user_id,kind,target_id,created_at) VALUES (?,?,?,?)',
              args: [actor.id, kind, id, now().toISOString()],
            });
          else
            await tx.execute({
              sql: 'DELETE FROM bookmarks WHERE user_id=? AND kind=? AND target_id=?',
              args: [actor.id, kind, id],
            });
          return { saved };
        });
      },
    });
  }

  app.get('/api/notifications', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'announcements');
    const query = z
      .object({ ...pageFields, unread: boolQuery })
      .strict()
      .parse(request.query);
    const flags = (await getSettings(db)).features;
    const visible = visibilitySql('a', actor.id, flags.subjects);
    const isUnread = '(ar.read_at IS NULL OR ar.read_at<a.updated_at)';
    const from =
      'FROM announcements a LEFT JOIN announcement_reads ar ON ar.announcement_id=a.id AND ar.user_id=?';
    const where = `${visible.sql}${query.unread ? ` AND ${isUnread}` : ''}`;
    const args = [actor.id, ...visible.args];
    const list = await rows(
      db,
      `SELECT a.*,ar.read_at ${from} WHERE ${where} ORDER BY a.updated_at DESC,a.id LIMIT ? OFFSET ?`,
      [...args, query.limit, query.offset],
    );
    const count = await first(db, `SELECT COUNT(*) AS n ${from} WHERE ${where}`, args);
    const unreadCount = await first(
      db,
      `SELECT COUNT(*) AS n ${from} WHERE ${visible.sql} AND ${isUnread}`,
      args,
    );
    return {
      notifications: list.map((row) => ({
        id: stringValue(row.id),
        announcementId: stringValue(row.id),
        title: stringValue(row.title),
        body: stringValue(row.body),
        scope: stringValue(row.scope),
        classId: row.class_id ? stringValue(row.class_id) : null,
        subjectId: row.subject_id ? stringValue(row.subject_id) : null,
        priority: stringValue(row.priority),
        createdAt: stringValue(row.created_at),
        read: Boolean(row.read_at && stringValue(row.read_at) >= stringValue(row.updated_at)),
      })),
      pagination: { limit: query.limit, offset: query.offset, total: numberValue(count?.n) },
      unreadCount: numberValue(unreadCount?.n),
    };
  });

  app.post('/api/notifications/:id/read', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await contentAccess(tx, actor, id, 'announcement');
      await tx.execute({
        sql: 'INSERT INTO announcement_reads(user_id,announcement_id,read_at) VALUES (?,?,?) ON CONFLICT(user_id,announcement_id) DO UPDATE SET read_at=excluded.read_at',
        args: [actor.id, id, now().toISOString()],
      });
      return { ok: true };
    });
  });

  app.post('/api/notifications/read-all', async (request) => {
    const actor = await authenticate(request);
    return inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await requireFeature(tx, 'announcements');
      const flags = (await getSettings(tx)).features;
      const visible = visibilitySql('a', actor.id, flags.subjects);
      await tx.execute({
        sql: `INSERT INTO announcement_reads(user_id,announcement_id,read_at)
        SELECT ?,a.id,? FROM announcements a WHERE ${visible.sql}
        ON CONFLICT(user_id,announcement_id) DO UPDATE SET read_at=excluded.read_at`,
        args: [actor.id, now().toISOString(), ...visible.args],
      });
      return { ok: true };
    });
  });
}

export const DEMO_SUBJECT_IDS = {
  os: '20000000-0000-4000-8000-000000000001',
  db: '20000000-0000-4000-8000-000000000002',
  other: '20000000-0000-4000-8000-000000000003',
} as const;

/** Only fictional, explicitly labelled content. Does not upload invented lecture files. */
export async function seedAcademic(db: Client, now = new Date()): Promise<void> {
  await inWriteTransaction(db, async (tx) => {
    const mode = await first(tx, "SELECT value FROM app_metadata WHERE key='identity_mode'");
    requireCondition(
      mode?.value === 'demo',
      500,
      'demo_only',
      'Academic examples are only available in the local demo.',
    );
    const stamp = now.toISOString();
    for (const item of [
      [DEMO_SUBJECT_IDS.os, DEMO_CLASS_ID, 'OS Lab', 'CS-OSL', 'teal'],
      [DEMO_SUBJECT_IDS.db, DEMO_CLASS_ID, 'Database Systems', 'CS-DB', 'purple'],
      [DEMO_SUBJECT_IDS.other, DEMO_OTHER_CLASS_ID, 'Separate class sample', 'DEMO', 'amber'],
    ]) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO subjects(id,class_id,name,code,instructor,description,color,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        args: [
          item[0]!,
          item[1]!,
          item[2]!,
          item[3]!,
          '',
          'Fictional demo subject — replace with your real course details.',
          item[4]!,
          DEMO_USERS.master.id,
          stamp,
          stamp,
        ],
      });
    }
    await tx.execute({
      sql: `INSERT OR IGNORE INTO subject_enrollments(subject_id,user_id,status,created_at,updated_at)
      SELECT s.id,m.user_id,'active',?,? FROM subjects s JOIN memberships m ON m.class_id=s.class_id
      JOIN student_sections b ON b.user_id=m.user_id AND b.class_id=m.class_id AND b.needs_resolution=0
      WHERE m.status='active' AND s.created_by IN(SELECT id FROM users WHERE identity_source='demo')`,
      args: [stamp, stamp],
    });
    for (const item of [
      {
        id: '30000000-0000-4000-8000-000000000001',
        scope: 'global',
        classId: null,
        subjectId: null,
        title: 'Welcome to ZABSync',
        body: 'Demo announcement from the owner. Global notices appear for every signed-in university account.',
        pinned: 1,
        author: DEMO_USERS.master.id,
      },
      {
        id: '30000000-0000-4000-8000-000000000002',
        scope: 'class',
        classId: DEMO_CLASS_ID,
        subjectId: null,
        title: 'Your class, in one place',
        body: 'Fictional demo notice: class-wide announcements appear on Home. Add your own announcement when your class is ready.',
        pinned: 0,
        author: DEMO_USERS.admin.id,
      },
      {
        id: '30000000-0000-4000-8000-000000000003',
        scope: 'subject',
        classId: DEMO_CLASS_ID,
        subjectId: DEMO_SUBJECT_IDS.os,
        title: 'OS Lab resources start here',
        body: 'Fictional demo notice: upload a sample PDF or PowerPoint file, then attach it to a subject announcement.',
        pinned: 0,
        author: DEMO_USERS.admin.id,
      },
      {
        id: '30000000-0000-4000-8000-000000000004',
        scope: 'class',
        classId: DEMO_OTHER_CLASS_ID,
        subjectId: null,
        title: 'Separate class sample notice',
        body: 'This fictional notice belongs to another class and must stay hidden from the 5D student and class admins.',
        pinned: 0,
        author: DEMO_USERS.otherAdmin.id,
      },
    ]) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO announcements(id,scope,class_id,subject_id,title,body,priority,pinned,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        args: [
          item.id,
          item.scope,
          item.classId,
          item.subjectId,
          item.title,
          item.body,
          'normal',
          item.pinned,
          item.author,
          stamp,
          stamp,
        ],
      });
    }
  });
}
