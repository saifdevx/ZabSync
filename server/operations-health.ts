import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { first, inWriteTransaction, numberValue, rows } from './db.js';
import { requireMaster, type RouteContext } from './routes.js';
import { type ReminderOptions } from './reminders.js';
import { loadResourceLimits } from './storage.js';

/** Owner-only operational summaries; provider secrets and complete database URLs are never returned. */
export function registerOperationsHealth(
  app: FastifyInstance,
  context: RouteContext,
  reminders: ReminderOptions,
) {
  const { db, authenticate, config, now } = context;
  app.get('/api/admin/operations', async (request) => {
    await requireMaster(db, await authenticate(request));
    const counts = await first(
      db,
      `SELECT
      (SELECT count(*) FROM users WHERE status='active' AND role='student') AS students,
      (SELECT count(*) FROM classes WHERE status='active') AS sections,
      (SELECT count(*) FROM subjects WHERE deleted_at IS NULL) AS subjects,
      (SELECT count(*) FROM student_sections WHERE needs_resolution=1) AS sectionConflicts,
      (SELECT count(*) FROM subject_chat_reports WHERE resolved_at IS NULL) AS openChatReports,
      (SELECT count(*) FROM reminder_jobs WHERE status='failed') AS failedReminders,
      (SELECT count(*) FROM reminder_jobs WHERE status IN ('pending','leased')) AS pendingReminders,
      (SELECT count(*) FROM reminder_push_deliveries WHERE status='failed') AS failedPush,
      (SELECT count(*) FROM resources WHERE deleted_at IS NULL) AS resources`,
    );
    const limits = loadResourceLimits(config.nodeEnv === 'test' ? {} : process.env);
    return {
      version: '0.4.0',
      checkedAt: now().toISOString(),
      runtime: {
        auth: config.authMode,
        database: config.databaseUrl.startsWith('file:') ? 'local' : 'remote',
        pushEnabled: reminders.pushEnabled,
        googleSignInEnabled: config.googleSignInEnabled,
      },
      counts: Object.fromEntries(
        Object.entries(counts || {}).map(([key, value]) => [key, numberValue(value)]),
      ),
      schemaVersions: (
        await rows(db, 'SELECT version FROM schema_migrations ORDER BY version')
      ).map((row) => numberValue(row.version)),
      uploadLimits: {
        documents: limits.documentBytes,
        video: limits.videoBytes,
        perSection: limits.classBytes,
      },
    };
  });
  app.post('/api/admin/operations/retry-reminders', async (request) => {
    const actor = await authenticate(request);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      const stamp = now().toISOString();
      const result = await tx.execute({
        sql: `UPDATE reminder_jobs SET status='pending', attempts=0, lease_token=NULL,lease_until=NULL,last_error_code=NULL,next_attempt_at=? WHERE id IN (SELECT id FROM reminder_jobs WHERE status='failed' ORDER BY scheduled_for LIMIT 50)`,
        args: [stamp],
      });
      await tx.execute({
        sql: 'INSERT INTO audit_logs(id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?)',
        args: [
          randomUUID(),
          actor.id,
          'reminders.retry_failed',
          JSON.stringify({ count: result.rowsAffected }),
          stamp,
        ],
      });
      // The worker checks current consent, deadline version, completion and enrollment again before delivery.
      return { requeued: result.rowsAffected };
    });
  });
}
