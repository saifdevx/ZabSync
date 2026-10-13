import { randomUUID } from 'node:crypto';
import type { InValue } from '@libsql/client';
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
import { requireCondition } from './errors.js';
import { requireMaster, routeId, type RouteContext } from './routes.js';
import { requireFeature, requireWritable } from './site-settings.js';

export type HelpCategory = 'app' | 'university' | 'developer';
export interface HelpArticle {
  id: string;
  title: string;
  category: HelpCategory;
  body: string;
  sourceUrl: string | null;
  status: 'draft' | 'published';
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
}
export interface HelpAssistant {
  status: (
    actor: CurrentUser,
  ) => Promise<{ enabled: boolean; message: string; remainingToday?: number }>;
  answer: (
    actor: CurrentUser,
    question: string,
  ) => Promise<{ answer: string; sourceIds: string[]; remainingToday?: number }>;
}
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      'Remove control characters.',
    );
const category = z.enum(['app', 'university', 'developer']);
const source = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .default(null)
  .transform((value) => value || null)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use a complete HTTPS source URL.');
const contentForm = z
  .object({
    title: plain(160),
    category,
    body: plain(12000),
    sourceUrl: source,
    status: z.enum(['draft', 'published']).default('draft'),
  })
  .strict();
function checkSource(form: z.infer<typeof contentForm>) {
  requireCondition(
    form.category !== 'university' || Boolean(form.sourceUrl),
    400,
    'source_required',
    'Add the original university source URL before saving university information.',
  );
}
const listingQuery = z
  .object({
    q: z.string().trim().max(160).default(''),
    category: category.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
    offset: z.coerce.number().int().min(0).max(5000).default(0),
  })
  .strict();
function record(row: SqlRow): HelpArticle {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    category: stringValue(row.category) as HelpCategory,
    body: stringValue(row.body),
    sourceUrl: row.source_url ? stringValue(row.source_url) : null,
    status: row.status === 'published' ? 'published' : 'draft',
    version: numberValue(row.version),
    updatedAt: stringValue(row.updated_at),
    publishedAt: row.published_at ? stringValue(row.published_at) : null,
    deletedAt: row.deleted_at ? stringValue(row.deleted_at) : null,
  };
}
function like(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
const stopWords = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'be',
  'to',
  'in',
  'of',
  'and',
  'or',
  'for',
  'do',
  'does',
  'can',
  'how',
  'what',
  'where',
  'when',
  'who',
  'i',
  'my',
  'me',
  'this',
  'that',
  'it',
  'on',
  'with',
  'about',
  'please',
]);

export function helpSearchTokens(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1 && !stopWords.has(word)),
    ),
  ].slice(0, 8);
}

/** Returns only owner-published help; never queries personal, class, chat, or file tables. */
export async function searchPublishedHelp(
  db: Database,
  query: { q?: string; limit?: number; offset?: number; category?: HelpCategory } = {},
) {
  const tokens = helpSearchTokens(query.q || '');
  const filters = ["status='published'", 'deleted_at IS NULL'],
    args: InValue[] = [];
  if (query.category) {
    filters.push('category=?');
    args.push(query.category);
  }
  if (tokens.length) {
    filters.push(
      `(${tokens.map(() => "(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')").join(' OR ')})`,
    );
    for (const token of tokens) args.push(like(token), like(token));
  }
  const total = await first(
    db,
    `SELECT COUNT(*) AS n FROM help_articles WHERE ${filters.join(' AND ')}`,
    args,
  );
  const found = await rows(
    db,
    `SELECT * FROM help_articles WHERE ${filters.join(' AND ')} ORDER BY category,title COLLATE NOCASE,id LIMIT ? OFFSET ?`,
    [
      ...args,
      Math.max(1, Math.min(50, query.limit || 30)),
      Math.max(0, Math.min(5000, query.offset || 0)),
    ],
  );
  return { articles: found.map(record), total: numberValue(total?.n) };
}

export function registerHelpRoutes(
  app: FastifyInstance,
  context: RouteContext,
  options: { assistant?: HelpAssistant } = {},
) {
  const { db, authenticate, now } = context;
  app.get('/api/help', async (request) => {
    await authenticate(request);
    await requireFeature(db, 'help');
    return searchPublishedHelp(db, listingQuery.parse(request.query));
  });
  app.get('/api/help/assistant-status', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'help');
    return options.assistant
      ? options.assistant.status(actor)
      : {
          enabled: false,
          message: 'The assistant is not enabled yet. Browse or search the approved help articles.',
        };
  });
  app.post('/api/help/ask', async (request) => {
    const actor = await authenticate(request),
      form = z
        .object({ question: plain(1000).min(3) })
        .strict()
        .parse(request.body);
    await requireWritable(db, actor);
    await requireFeature(db, 'help');
    requireCondition(
      options.assistant,
      503,
      'assistant_disabled',
      'The assistant is not enabled yet. Search the approved help articles below.',
    );
    const status = await options.assistant.status(actor);
    requireCondition(status.enabled, 503, 'assistant_disabled', status.message);
    const answer = z
      .object({
        answer: z.string().min(1).max(12000),
        sourceIds: z.array(z.uuid()).max(12),
        remainingToday: z.number().int().min(0).optional(),
      })
      .strict()
      .parse(await options.assistant.answer(actor, form.question));
    const sources = [];
    for (const id of [...new Set(answer.sourceIds)]) {
      const row = await first(
        db,
        "SELECT id,title,source_url FROM help_articles WHERE id=? AND status='published' AND deleted_at IS NULL",
        [id],
      );
      if (row)
        sources.push({
          id: stringValue(row.id),
          title: stringValue(row.title),
          sourceUrl: row.source_url ? stringValue(row.source_url) : null,
        });
    }
    requireCondition(
      sources.length === new Set(answer.sourceIds).size,
      409,
      'help_changed',
      'The approved information changed while answering. Review the current articles and try again.',
    );
    return {
      answer: answer.answer,
      sources,
      ...(answer.remainingToday === undefined ? {} : { remainingToday: answer.remainingToday }),
    };
  });
  app.get('/api/help/:id', async (request) => {
    await authenticate(request);
    await requireFeature(db, 'help');
    const row = await first(
      db,
      "SELECT * FROM help_articles WHERE id=? AND status='published' AND deleted_at IS NULL",
      [routeId(request)],
    );
    requireCondition(row, 404, 'article_not_found', 'This help article is not available.');
    return { article: record(row) };
  });
  app.get('/api/admin/help', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    const query = listingQuery
      .extend({
        status: z.enum(['draft', 'published']).optional(),
        deleted: z.enum(['true', 'false']).default('false'),
      })
      .strict()
      .parse(request.query);
    const filters = [`deleted_at IS ${query.deleted === 'true' ? 'NOT ' : ''}NULL`],
      args: InValue[] = [];
    if (query.status) {
      filters.push('status=?');
      args.push(query.status);
    }
    if (query.category) {
      filters.push('category=?');
      args.push(query.category);
    }
    if (query.q) {
      filters.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      args.push(like(query.q), like(query.q));
    }
    const count = await first(
      db,
      `SELECT COUNT(*) AS n FROM help_articles WHERE ${filters.join(' AND ')}`,
      args,
    );
    const found = await rows(
      db,
      `SELECT * FROM help_articles WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,
      [...args, query.limit, query.offset],
    );
    return { articles: found.map(record), total: numberValue(count?.n) };
  });
  app.post('/api/admin/help', async (request, reply) => {
    const actor = await authenticate(request),
      form = contentForm.parse(request.body),
      timestamp = now();
    checkSource(form);
    const id = await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await requireMaster(tx, actor);
      const count = await first(tx, 'SELECT COUNT(*) AS n FROM help_articles');
      requireCondition(
        numberValue(count?.n) < 500,
        409,
        'help_capacity',
        'Help is limited to 500 articles including trash. Review existing content before adding more.',
      );
      const id = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO help_articles(id,title,category,body,source_url,status,created_by,updated_by,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        args: [
          id,
          form.title,
          form.category,
          form.body,
          form.sourceUrl,
          form.status,
          actor.id,
          actor.id,
          timestamp.toISOString(),
          timestamp.toISOString(),
          form.status === 'published' ? timestamp.toISOString() : null,
        ],
      });
      await audit(tx, actor.id, 'help.created', id, timestamp, {
        category: form.category,
        status: form.status,
      });
      return id;
    });
    return reply.code(201).send({
      article: record((await first(db, 'SELECT * FROM help_articles WHERE id=?', [id]))!),
    });
  });
  app.patch('/api/admin/help/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = contentForm
        .extend({ version: z.number().int().positive() })
        .strict()
        .parse(request.body),
      timestamp = now();
    checkSource(form);
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await requireMaster(tx, actor);
      const row = await first(tx, 'SELECT * FROM help_articles WHERE id=? AND deleted_at IS NULL', [
        id,
      ]);
      requireCondition(row, 404, 'article_not_found', 'This help article is not available.');
      requireCondition(
        numberValue(row.version) === form.version,
        409,
        'record_changed',
        'This article changed. Refresh before saving.',
      );
      await tx.execute({
        sql: 'UPDATE help_articles SET title=?,category=?,body=?,source_url=?,status=?,version=version+1,updated_by=?,updated_at=?,published_at=? WHERE id=?',
        args: [
          form.title,
          form.category,
          form.body,
          form.sourceUrl,
          form.status,
          actor.id,
          timestamp.toISOString(),
          form.status === 'published' ? timestamp.toISOString() : null,
          id,
        ],
      });
      await audit(tx, actor.id, 'help.updated', id, timestamp, {
        category: form.category,
        status: form.status,
      });
    });
    return { article: record((await first(db, 'SELECT * FROM help_articles WHERE id=?', [id]))!) };
  });
  app.delete('/api/admin/help/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = z.object({ version: z.number().int().positive() }).strict().parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await requireMaster(tx, actor);
      const row = await first(tx, 'SELECT * FROM help_articles WHERE id=?', [id]);
      requireCondition(row, 404, 'article_not_found', 'This help article is not available.');
      if (row.deleted_at) return;
      requireCondition(
        numberValue(row.version) === form.version,
        409,
        'record_changed',
        'This article changed. Refresh before removing it.',
      );
      await tx.execute({
        sql: 'UPDATE help_articles SET deleted_at=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?',
        args: [timestamp.toISOString(), actor.id, timestamp.toISOString(), id],
      });
      await audit(tx, actor.id, 'help.removed', id, timestamp);
    });
    return { ok: true };
  });
  app.post('/api/admin/help/:id/restore', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = z.object({ version: z.number().int().positive() }).strict().parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await requireMaster(tx, actor);
      const row = await first(
        tx,
        'SELECT * FROM help_articles WHERE id=? AND deleted_at IS NOT NULL',
        [id],
      );
      requireCondition(row, 404, 'article_not_found', 'This removed article is not available.');
      requireCondition(
        numberValue(row.version) === form.version,
        409,
        'record_changed',
        'This article changed. Refresh before restoring it.',
      );
      // Restored information needs owner review before students can see it again.
      await tx.execute({
        sql: "UPDATE help_articles SET deleted_at=NULL,status='draft',published_at=NULL,updated_by=?,updated_at=?,version=version+1 WHERE id=?",
        args: [actor.id, timestamp.toISOString(), id],
      });
      await audit(tx, actor.id, 'help.restored_draft', id, timestamp);
    });
    return { ok: true };
  });
}
