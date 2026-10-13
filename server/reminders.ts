import { createHash, randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { applicationDefault, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { subjectAccess } from './academic.js';
import { publicUser, type Clock, type CurrentUser } from './auth.js';
import type { AppConfig } from './config.js';
import {
  first,
  inWriteTransaction,
  numberValue,
  rows,
  stringValue,
  type Database,
  type SqlRow,
} from './db.js';
import { ApiError, requireCondition } from './errors.js';
import { classAccess, routeId, type RouteContext } from './routes.js';
import { getSettings, requireFeature, requireWritable } from './site-settings.js';

export const REMINDER_OFFSETS = [0, 15, 60, 1440] as const;
export const REMINDER_LEASE_MS = 120_000;
const MAX_ATTEMPTS = 5;
const MAX_ENABLED_PREFERENCES = 200;
const preferenceForm = z
  .object({
    enabled: z.boolean(),
    offsetMinutes: z
      .union([z.literal(0), z.literal(15), z.literal(60), z.literal(1440)])
      .default(60),
  })
  .strict();
const subscriptionForm = z
  .object({
    installationId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}$/, 'Use a valid Firebase Installation ID.'),
    deviceLabel: z.string().trim().max(80).default('This device'),
  })
  .strict();

export interface ReminderOptions {
  pushEnabled: boolean;
  vapidKey?: string;
  messagingSenderId?: string;
}

export function loadReminderOptions(env: NodeJS.ProcessEnv, config: AppConfig): ReminderOptions {
  const pushEnabled = env.REMINDERS_PUSH_ENABLED === 'true';
  const vapidKey = env.FIREBASE_WEB_PUSH_VAPID_KEY?.trim(),
    messagingSenderId = env.FIREBASE_MESSAGING_SENDER_ID?.trim();
  if (
    pushEnabled &&
    (config.authMode !== 'firebase' || !config.firebase || !vapidKey || !messagingSenderId)
  ) {
    throw new Error(
      'Push reminders require Firebase authentication, FIREBASE_WEB_PUSH_VAPID_KEY, and FIREBASE_MESSAGING_SENDER_ID. Leave REMINDERS_PUSH_ENABLED=false until configured.',
    );
  }
  if (vapidKey && !/^[A-Za-z0-9_-]{60,200}$/.test(vapidKey))
    throw new Error('FIREBASE_WEB_PUSH_VAPID_KEY must be the public Web Push certificate key.');
  if (messagingSenderId && !/^\d{4,30}$/.test(messagingSenderId))
    throw new Error('FIREBASE_MESSAGING_SENDER_ID must be the Firebase project sender number.');
  return { pushEnabled, vapidKey, messagingSenderId };
}

async function deadlineAccess(db: Database, actor: CurrentUser, deadlineId: string) {
  await requireFeature(db, 'reminders');
  await requireFeature(db, 'deadlines');
  const deadline = await first(db, 'SELECT * FROM deadlines WHERE id=? AND deleted_at IS NULL', [
    deadlineId,
  ]);
  requireCondition(deadline, 404, 'deadline_not_found', 'This deadline is not available to you.');
  // Owner management is intentionally separate from student reminder subscriptions.
  requireCondition(
    actor.role !== 'master',
    403,
    'student_account_required',
    'Use your university student account for personal reminders.',
  );
  await classAccess(db, actor, stringValue(deadline.class_id));
  if (deadline.subject_id) {
    await requireFeature(db, 'subjects');
    await subjectAccess(db, actor, stringValue(deadline.subject_id));
  }
  return deadline;
}

async function eligible(
  db: Database,
  userId: string,
  deadlineId: string,
  version: number,
  offsetMinutes: number,
) {
  const user = await first(
    db,
    "SELECT * FROM users WHERE id=? AND status='active' AND role='student'",
    [userId],
  );
  if (!user) return null;
  let deadline: SqlRow;
  try {
    deadline = await deadlineAccess(db, publicUser(user), deadlineId);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.statusCode)) return null;
    throw error;
  }
  if (numberValue(deadline.version) !== version) return null;
  const preference = await first(
    db,
    'SELECT * FROM deadline_reminder_preferences WHERE user_id=? AND deadline_id=? AND enabled=1 AND offset_minutes=?',
    [userId, deadlineId, offsetMinutes],
  );
  if (!preference) return null;
  const completed = await first(
    db,
    'SELECT 1 FROM deadline_completions WHERE user_id=? AND deadline_id=? AND deadline_version=?',
    [userId, deadlineId, version],
  );
  return completed ? null : deadline;
}

function errorCode(error: unknown): string {
  const raw = (error as { code?: unknown })?.code;
  // Store codes only, never credential values, request bodies, or arbitrary provider error messages.
  return typeof raw === 'string' && /^[A-Za-z0-9_\-/.]{1,100}$/.test(raw) ? raw : 'delivery_failed';
}
function invalidToken(code: string) {
  return [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/mismatched-credential',
  ].includes(code);
}

export interface PushSender {
  send: (installationId: string, notificationId: string) => Promise<void>;
}
export interface ManagedPushSender extends PushSender {
  close: () => Promise<void>;
}

/** Creates a separately owned Firebase app. A token/provider cannot be selected by an HTTP request. */
export function createFirebasePushSender(config: AppConfig): ManagedPushSender {
  if (config.authMode !== 'firebase' || !config.firebase)
    throw new Error('Real Firebase configuration is required for device push.');
  const credential = config.firebaseAdminCredential
    ? cert({
        projectId: config.firebaseAdminCredential.projectId,
        clientEmail: config.firebaseAdminCredential.clientEmail,
        privateKey: config.firebaseAdminCredential.privateKey,
      })
    : config.firebaseUseApplicationDefault
      ? applicationDefault()
      : null;
  if (!credential)
    throw new Error('Firebase Admin server credentials are required for device push.');
  const app = initializeApp(
    { credential, projectId: config.firebase.projectId },
    `zabsync-reminders-${randomUUID()}`,
  );
  const messaging = getMessaging(app);
  return {
    send: async (installationId, id) => {
      // No class name, deadline title, email, or auth token goes to a lock screen. The app rechecks access when opened.
      await messaging.send({
        fid: installationId,
        data: { zabsyncReminderId: id, url: '/reminders' },
        webpush: { headers: { TTL: '3600', Urgency: 'normal' } },
      });
    },
    close: () => deleteApp(app),
  };
}

/** Materialize a bounded horizon. The unique key makes repeated/restarted/multiple schedulers safe. */
export async function prepareReminderJobs(db: Client, now: Date, batchSize = 250) {
  return inWriteTransaction(db, async (tx) => {
    const controls = await getSettings(tx);
    if (
      controls.maintenance.enabled ||
      !controls.features.reminders ||
      !controls.features.deadlines
    )
      return 0;
    const candidates = await rows(
      tx,
      `SELECT p.user_id,p.deadline_id,p.offset_minutes,d.version,d.due_at
      FROM deadline_reminder_preferences p JOIN deadlines d ON d.id=p.deadline_id
      WHERE p.enabled=1 AND d.deleted_at IS NULL AND d.due_at>=? AND d.due_at<=?
        AND NOT EXISTS(SELECT 1 FROM reminder_jobs j WHERE j.user_id=p.user_id AND j.deadline_id=p.deadline_id AND j.deadline_version=d.version AND j.offset_minutes=p.offset_minutes)
      ORDER BY d.due_at,p.user_id LIMIT ?`,
      [
        new Date(now.getTime() - 15 * 60000).toISOString(),
        new Date(now.getTime() + 2 * 86400000).toISOString(),
        batchSize,
      ],
    );
    let added = 0;
    for (const row of candidates) {
      const current = await eligible(
        tx,
        stringValue(row.user_id),
        stringValue(row.deadline_id),
        numberValue(row.version),
        numberValue(row.offset_minutes),
      );
      // A cancelled placeholder also records a deliberately skipped revision, avoiding an endless rescan.
      const runAt = new Date(
        Date.parse(stringValue(row.due_at)) - numberValue(row.offset_minutes) * 60000,
      ).toISOString();
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO reminder_jobs(id,user_id,deadline_id,deadline_version,offset_minutes,scheduled_for,status,next_attempt_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [
          randomUUID(),
          stringValue(row.user_id),
          stringValue(row.deadline_id),
          numberValue(row.version),
          numberValue(row.offset_minutes),
          runAt,
          current ? 'pending' : 'cancelled',
          runAt,
          now.toISOString(),
        ],
      });
      if (current) added++;
    }
    return added;
  });
}

async function claimJob(db: Client, now: Date): Promise<SqlRow | null> {
  return inWriteTransaction(db, async (tx) => {
    const controls = await getSettings(tx);
    if (
      controls.maintenance.enabled ||
      !controls.features.reminders ||
      !controls.features.deadlines
    )
      return null;
    await tx.execute({
      sql: "UPDATE reminder_jobs SET status='failed',lease_token=NULL,lease_until=NULL,last_error_code='lease_exhausted' WHERE status='leased' AND lease_until<=? AND attempts>=?",
      args: [now.toISOString(), MAX_ATTEMPTS],
    });
    const job = await first(
      tx,
      `SELECT * FROM reminder_jobs WHERE ((status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?)) AND attempts<? ORDER BY scheduled_for,id LIMIT 1`,
      [now.toISOString(), now.toISOString(), MAX_ATTEMPTS],
    );
    if (!job) return null;
    const token = randomUUID();
    await tx.execute({
      sql: "UPDATE reminder_jobs SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=?",
      args: [token, new Date(now.getTime() + REMINDER_LEASE_MS).toISOString(), stringValue(job.id)],
    });
    return { ...job, lease_token: token, attempts: numberValue(job.attempts) + 1 };
  });
}

async function deliverInbox(db: Client, job: SqlRow, now: Date, pushEnabled: boolean) {
  return inWriteTransaction(db, async (tx) => {
    const lease = await first(
      tx,
      "SELECT * FROM reminder_jobs WHERE id=? AND status='leased' AND lease_token=? AND lease_until>?",
      [stringValue(job.id), stringValue(job.lease_token), now.toISOString()],
    );
    if (!lease) return 'lost' as const;
    const controls = await getSettings(tx);
    if (
      controls.maintenance.enabled ||
      !controls.features.reminders ||
      !controls.features.deadlines
    ) {
      await tx.execute({
        sql: "UPDATE reminder_jobs SET status='pending',lease_token=NULL,lease_until=NULL,attempts=attempts-1,next_attempt_at=? WHERE id=?",
        args: [new Date(now.getTime() + 60000).toISOString(), stringValue(job.id)],
      });
      return 'paused' as const;
    }
    const deadline = await eligible(
      tx,
      stringValue(job.user_id),
      stringValue(job.deadline_id),
      numberValue(job.deadline_version),
      numberValue(job.offset_minutes),
    );
    // Don't send a misleading alert hours after the due time following an outage.
    if (!deadline || Date.parse(stringValue(deadline.due_at)) < now.getTime() - 15 * 60000) {
      await tx.execute({
        sql: "UPDATE reminder_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,last_error_code='no_longer_eligible' WHERE id=?",
        args: [stringValue(job.id)],
      });
      return 'cancelled' as const;
    }
    const notificationId = stringValue(job.id);
    await tx.execute({
      sql: 'INSERT OR IGNORE INTO reminder_inbox(id,job_id,user_id,deadline_id,deadline_version,created_at) VALUES (?,?,?,?,?,?)',
      args: [
        notificationId,
        stringValue(job.id),
        stringValue(job.user_id),
        stringValue(job.deadline_id),
        numberValue(job.deadline_version),
        now.toISOString(),
      ],
    });
    if (pushEnabled) {
      const subscriptions = await rows(
        tx,
        'SELECT id FROM reminder_push_subscriptions WHERE user_id=? AND disabled_at IS NULL LIMIT 5',
        [stringValue(job.user_id)],
      );
      for (const subscription of subscriptions)
        await tx.execute({
          sql: 'INSERT OR IGNORE INTO reminder_push_deliveries(id,notification_id,subscription_id,user_id,next_attempt_at,created_at) VALUES (?,?,?,?,?,?)',
          args: [
            randomUUID(),
            notificationId,
            stringValue(subscription.id),
            stringValue(job.user_id),
            now.toISOString(),
            now.toISOString(),
          ],
        });
    }
    await tx.execute({
      sql: "UPDATE reminder_jobs SET status='delivered',lease_token=NULL,lease_until=NULL,delivered_at=?,last_error_code=NULL WHERE id=?",
      args: [now.toISOString(), stringValue(job.id)],
    });
    return 'delivered' as const;
  });
}

async function failInbox(db: Client, job: SqlRow, now: Date, error: unknown) {
  await db.execute({
    sql: "UPDATE reminder_jobs SET status=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,last_error_code=? WHERE id=? AND status='leased' AND lease_token=?",
    args: [
      numberValue(job.attempts) >= MAX_ATTEMPTS ? 'failed' : 'pending',
      new Date(
        now.getTime() + Math.min(3600, 30 * 2 ** numberValue(job.attempts)) * 1000,
      ).toISOString(),
      errorCode(error),
      stringValue(job.id),
      stringValue(job.lease_token),
    ],
  });
}

async function claimPush(
  db: Client,
  now: Date,
): Promise<{ cancelled: true } | { cancelled: false; item: SqlRow } | null> {
  return inWriteTransaction(db, async (tx) => {
    const controls = await getSettings(tx);
    if (
      controls.maintenance.enabled ||
      !controls.features.reminders ||
      !controls.features.deadlines
    )
      return null;
    await tx.execute({
      sql: "UPDATE reminder_push_deliveries SET status='failed',lease_token=NULL,lease_until=NULL,last_error_code='lease_exhausted' WHERE status='leased' AND lease_until<=? AND attempts>=?",
      args: [now.toISOString(), MAX_ATTEMPTS],
    });
    const item = await first(
      tx,
      `SELECT delivery.*,s.installation_id,s.disabled_at,s.user_id AS subscription_user,j.deadline_id,j.deadline_version,j.offset_minutes
      FROM reminder_push_deliveries delivery JOIN reminder_push_subscriptions s ON s.id=delivery.subscription_id
      JOIN reminder_inbox i ON i.id=delivery.notification_id JOIN reminder_jobs j ON j.id=i.job_id
      WHERE ((delivery.status='pending' AND delivery.next_attempt_at<=?) OR (delivery.status='leased' AND delivery.lease_until<=?)) AND delivery.attempts<? ORDER BY delivery.created_at,delivery.id LIMIT 1`,
      [now.toISOString(), now.toISOString(), MAX_ATTEMPTS],
    );
    if (!item) return null;
    const deadline = await eligible(
      tx,
      stringValue(item.user_id),
      stringValue(item.deadline_id),
      numberValue(item.deadline_version),
      numberValue(item.offset_minutes),
    );
    if (
      !deadline ||
      item.disabled_at ||
      item.user_id !== item.subscription_user ||
      Date.parse(stringValue(deadline.due_at)) < now.getTime() - 15 * 60000
    ) {
      await tx.execute({
        sql: "UPDATE reminder_push_deliveries SET status='cancelled',lease_token=NULL,lease_until=NULL,last_error_code='no_longer_eligible' WHERE id=?",
        args: [stringValue(item.id)],
      });
      return { cancelled: true as const };
    }
    const token = randomUUID();
    await tx.execute({
      sql: "UPDATE reminder_push_deliveries SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=?",
      args: [
        token,
        new Date(now.getTime() + REMINDER_LEASE_MS).toISOString(),
        stringValue(item.id),
      ],
    });
    return {
      cancelled: false as const,
      item: { ...item, lease_token: token, attempts: numberValue(item.attempts) + 1 },
    };
  });
}

export interface ReminderCycleResult {
  prepared: number;
  inboxDelivered: number;
  cancelled: number;
  pushSent: number;
  errors: number;
}
export async function runReminderCycle(
  db: Client,
  options: { now?: Clock; pushSender?: PushSender; batchSize?: number } = {},
): Promise<ReminderCycleResult> {
  const clock = options.now || (() => new Date()),
    batchSize = Math.max(1, Math.min(500, options.batchSize || 100));
  const result: ReminderCycleResult = {
    prepared: await prepareReminderJobs(db, clock(), batchSize),
    inboxDelivered: 0,
    cancelled: 0,
    pushSent: 0,
    errors: 0,
  };
  for (let i = 0; i < batchSize; i++) {
    const job = await claimJob(db, clock());
    if (!job) break;
    try {
      const state = await deliverInbox(db, job, clock(), Boolean(options.pushSender));
      if (state === 'delivered') result.inboxDelivered++;
      if (state === 'cancelled') result.cancelled++;
    } catch (error) {
      result.errors++;
      await failInbox(db, job, clock(), error);
    }
  }
  if (options.pushSender)
    for (let i = 0; i < batchSize; i++) {
      const next = await claimPush(db, clock());
      if (!next) break;
      if (next.cancelled) {
        result.cancelled++;
        continue;
      }
      const { item } = next;
      try {
        // Access is checked in the claim immediately before contacting the provider. A provider call and SQL cannot share an atomic transaction.
        await options.pushSender.send(
          stringValue(item.installation_id),
          stringValue(item.notification_id),
        );
        const updated = await db.execute({
          sql: "UPDATE reminder_push_deliveries SET status='sent',lease_token=NULL,lease_until=NULL,sent_at=?,last_error_code=NULL WHERE id=? AND status='leased' AND lease_token=?",
          args: [clock().toISOString(), stringValue(item.id), stringValue(item.lease_token)],
        });
        if (updated.rowsAffected) result.pushSent++;
      } catch (error) {
        result.errors++;
        const code = errorCode(error),
          permanent = invalidToken(code);
        await inWriteTransaction(db, async (tx) => {
          await tx.execute({
            sql: "UPDATE reminder_push_deliveries SET status=?,lease_token=NULL,lease_until=NULL,next_attempt_at=?,last_error_code=? WHERE id=? AND status='leased' AND lease_token=?",
            args: [
              permanent || numberValue(item.attempts) >= MAX_ATTEMPTS ? 'failed' : 'pending',
              new Date(
                clock().getTime() + Math.min(3600, 30 * 2 ** numberValue(item.attempts)) * 1000,
              ).toISOString(),
              code,
              stringValue(item.id),
              stringValue(item.lease_token),
            ],
          });
          if (permanent)
            await tx.execute({
              sql: 'UPDATE reminder_push_subscriptions SET disabled_at=? WHERE id=? AND user_id=?',
              args: [
                clock().toISOString(),
                stringValue(item.subscription_id),
                stringValue(item.user_id),
              ],
            });
        });
      }
    }
  return result;
}

/** One non-overlapping loop per process. SQL leases still coordinate separate workers. */
export function startReminderRunner(
  db: Client,
  options: {
    now?: Clock;
    pushSender?: PushSender;
    intervalMs?: number;
    keepAlive?: boolean;
    onError?: (error: unknown) => void;
  } = {},
) {
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> = Promise.resolve();
  const tick = () => {
    if (stopped) return;
    running = runReminderCycle(db, options)
      .catch((error) => options.onError?.(error))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, Math.max(15000, options.intervalMs || 60000));
          if (!options.keepAlive) timer.unref?.();
        }
      });
  };
  tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}

export function registerReminderRoutes(
  app: FastifyInstance,
  context: RouteContext,
  options: ReminderOptions = { pushEnabled: false },
) {
  const { db, authenticate, now, config } = context;
  app.get('/api/reminders/config', async (request) => {
    await authenticate(request);
    await requireFeature(db, 'reminders');
    return {
      pushAvailable: options.pushEnabled,
      publicFirebase:
        options.pushEnabled && config.firebase
          ? { ...config.firebase, messagingSenderId: options.messagingSenderId }
          : null,
      vapidKey: options.pushEnabled ? options.vapidKey : null,
      offsetMinutes: REMINDER_OFFSETS,
      timezone: 'Asia/Karachi',
    };
  });
  app.get('/api/deadlines/:id/reminder', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      deadline = await deadlineAccess(db, actor, id);
    const preference = await first(
      db,
      'SELECT * FROM deadline_reminder_preferences WHERE user_id=? AND deadline_id=?',
      [actor.id, id],
    );
    return {
      enabled: preference?.enabled === 1,
      offsetMinutes: preference ? numberValue(preference.offset_minutes) : 60,
      dueAt: stringValue(deadline.due_at),
      deadlineVersion: numberValue(deadline.version),
    };
  });
  app.post('/api/deadlines/:id/reminder', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = preferenceForm.parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const deadline = await deadlineAccess(tx, actor, id);
      requireCondition(
        !form.enabled || Date.parse(stringValue(deadline.due_at)) > timestamp.getTime(),
        400,
        'deadline_passed',
        'Choose an upcoming deadline for a reminder.',
      );
      if (form.enabled) {
        const count = await first(
          tx,
          'SELECT COUNT(*) AS total FROM deadline_reminder_preferences WHERE user_id=? AND enabled=1 AND deadline_id<>?',
          [actor.id, id],
        );
        requireCondition(
          numberValue(count?.total) < MAX_ENABLED_PREFERENCES,
          409,
          'reminder_limit',
          'Turn off an old reminder before adding another. You can keep 200 enabled.',
        );
      }
      await tx.execute({
        sql: `INSERT INTO deadline_reminder_preferences(user_id,deadline_id,enabled,offset_minutes,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,deadline_id) DO UPDATE SET enabled=excluded.enabled,offset_minutes=excluded.offset_minutes,updated_at=excluded.updated_at`,
        args: [actor.id, id, form.enabled ? 1 : 0, form.offsetMinutes, timestamp.toISOString()],
      });
      await tx.execute({
        sql: "UPDATE reminder_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,last_error_code='preference_changed' WHERE user_id=? AND deadline_id=? AND status IN ('pending','leased') AND (?=0 OR offset_minutes<>?)",
        args: [actor.id, id, form.enabled ? 1 : 0, form.offsetMinutes],
      });
      if (form.enabled) {
        // Re-enabling before delivery may revive a cancelled matching job; a delivered job never duplicates the inbox.
        await tx.execute({
          sql: "UPDATE reminder_jobs SET status='pending',attempts=0,lease_token=NULL,lease_until=NULL,last_error_code=NULL,next_attempt_at=scheduled_for WHERE user_id=? AND deadline_id=? AND deadline_version=? AND offset_minutes=? AND status IN ('cancelled','failed')",
          args: [actor.id, id, numberValue(deadline.version), form.offsetMinutes],
        });
      }
    });
    await prepareReminderJobs(db, timestamp);
    return { enabled: form.enabled, offsetMinutes: form.offsetMinutes };
  });
  app.get('/api/reminders', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'reminders');
    const query = z
      .object({
        before: z.string().max(300).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(30),
      })
      .strict()
      .parse(request.query);
    let boundary: [string, string] | null = null;
    if (query.before) {
      let value: unknown;
      try {
        value = JSON.parse(Buffer.from(query.before, 'base64url').toString('utf8'));
      } catch {
        value = null;
      }
      const parsed = z.tuple([z.iso.datetime(), z.uuid()]).safeParse(value);
      requireCondition(
        parsed.success,
        400,
        'invalid_cursor',
        'Refresh the reminders and try again.',
      );
      boundary = parsed.data;
    }
    const candidates = await rows(
      db,
      `SELECT i.*,j.offset_minutes,d.title,d.due_at,d.class_id,d.subject_id,c.name AS class_name,s.name AS subject_name
      FROM reminder_inbox i JOIN reminder_jobs j ON j.id=i.job_id JOIN deadlines d ON d.id=i.deadline_id JOIN classes c ON c.id=d.class_id LEFT JOIN subjects s ON s.id=d.subject_id
      WHERE i.user_id=? ${boundary ? 'AND (i.created_at<? OR (i.created_at=? AND i.id<?))' : ''}
      ORDER BY i.created_at DESC,i.id DESC LIMIT ?`,
      [actor.id, ...(boundary ? [boundary[0], boundary[0], boundary[1]] : []), query.limit + 1],
    );
    const more = candidates.length > query.limit;
    if (more) candidates.pop();
    const items = [];
    for (const row of candidates) {
      if (
        !(await eligible(
          db,
          actor.id,
          stringValue(row.deadline_id),
          numberValue(row.deadline_version),
          numberValue(row.offset_minutes),
        ))
      )
        continue;
      items.push({
        id: stringValue(row.id),
        deadlineId: stringValue(row.deadline_id),
        title: stringValue(row.title),
        dueAt: stringValue(row.due_at),
        classId: stringValue(row.class_id),
        className: stringValue(row.class_name),
        subjectId: row.subject_id ? stringValue(row.subject_id) : null,
        subjectName: row.subject_name ? stringValue(row.subject_name) : null,
        createdAt: stringValue(row.created_at),
        readAt: row.read_at ? stringValue(row.read_at) : null,
      });
    }
    return {
      items,
      nextCursor:
        more && candidates.length
          ? Buffer.from(
              JSON.stringify([candidates.at(-1)!.created_at, candidates.at(-1)!.id]),
            ).toString('base64url')
          : null,
    };
  });
  app.patch('/api/reminders/:id/read', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      form = z.object({ read: z.boolean() }).strict().parse(request.body),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const row = await first(
        tx,
        'SELECT i.*,j.offset_minutes FROM reminder_inbox i JOIN reminder_jobs j ON j.id=i.job_id WHERE i.id=? AND i.user_id=?',
        [id, actor.id],
      );
      requireCondition(
        row &&
          (await eligible(
            tx,
            actor.id,
            stringValue(row.deadline_id),
            numberValue(row.deadline_version),
            numberValue(row.offset_minutes),
          )),
        404,
        'reminder_not_found',
        'This reminder is no longer available.',
      );
      await tx.execute({
        sql: 'UPDATE reminder_inbox SET read_at=? WHERE id=? AND user_id=?',
        args: [form.read ? timestamp.toISOString() : null, id, actor.id],
      });
    });
    return { ok: true };
  });
  app.get('/api/reminders/push-subscriptions', async (request) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'reminders');
    const subscriptions = await rows(
      db,
      'SELECT id,device_label,updated_at FROM reminder_push_subscriptions WHERE user_id=? AND disabled_at IS NULL ORDER BY updated_at DESC',
      [actor.id],
    );
    return {
      subscriptions: subscriptions.map((row) => ({
        id: stringValue(row.id),
        deviceLabel: stringValue(row.device_label),
        updatedAt: stringValue(row.updated_at),
      })),
    };
  });
  app.post('/api/reminders/push-subscriptions', async (request) => {
    const actor = await authenticate(request),
      form = subscriptionForm.parse(request.body),
      timestamp = now();
    requireCondition(
      options.pushEnabled,
      503,
      'push_unavailable',
      'Device notifications have not been configured. In-app reminders remain available.',
    );
    requireCondition(
      actor.role !== 'master',
      403,
      'student_account_required',
      'Use your university student account for personal reminders.',
    );
    const destinationHash = createHash('sha256').update(form.installationId).digest('hex');
    const id = await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      await requireFeature(tx, 'reminders');
      const existing = await first(
        tx,
        'SELECT * FROM reminder_push_subscriptions WHERE destination_hash=?',
        [destinationHash],
      );
      const count = await first(
        tx,
        'SELECT COUNT(*) AS total FROM reminder_push_subscriptions WHERE user_id=? AND disabled_at IS NULL AND destination_hash<>?',
        [actor.id, destinationHash],
      );
      requireCondition(
        numberValue(count?.total) < 5,
        409,
        'device_limit',
        'Remove an old device before enabling another. Up to five devices are supported.',
      );
      if (existing) {
        // Rebinding this browser after an account switch cancels deliveries for its previous account.
        if (existing.user_id !== actor.id)
          await tx.execute({
            sql: "UPDATE reminder_push_deliveries SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND status IN ('pending','leased')",
            args: [stringValue(existing.id)],
          });
        await tx.execute({
          sql: 'UPDATE reminder_push_subscriptions SET user_id=?,installation_id=?,device_label=?,updated_at=?,disabled_at=NULL WHERE id=?',
          args: [
            actor.id,
            form.installationId,
            form.deviceLabel,
            timestamp.toISOString(),
            stringValue(existing.id),
          ],
        });
        return stringValue(existing.id);
      }
      const key = randomUUID();
      await tx.execute({
        sql: 'INSERT INTO reminder_push_subscriptions(id,user_id,destination_hash,installation_id,device_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        args: [
          key,
          actor.id,
          destinationHash,
          form.installationId,
          form.deviceLabel,
          timestamp.toISOString(),
          timestamp.toISOString(),
        ],
      });
      return key;
    });
    return { id, deviceLabel: form.deviceLabel };
  });
  app.delete('/api/reminders/push-subscriptions/:id', async (request) => {
    const actor = await authenticate(request),
      id = routeId(request),
      timestamp = now();
    await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const result = await tx.execute({
        sql: 'UPDATE reminder_push_subscriptions SET disabled_at=? WHERE id=? AND user_id=?',
        args: [timestamp.toISOString(), id, actor.id],
      });
      requireCondition(
        result.rowsAffected > 0,
        404,
        'device_not_found',
        'This device registration is not available.',
      );
      await tx.execute({
        sql: "UPDATE reminder_push_deliveries SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE subscription_id=? AND user_id=? AND status IN ('pending','leased')",
        args: [id, actor.id],
      });
    });
    return { ok: true };
  });
}
