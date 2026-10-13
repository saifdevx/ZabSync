import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Client } from '@libsql/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { audit, publicUser, type Clock, type CurrentUser } from './auth.js';
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
import { requireMaster } from './routes.js';
import {
  featureFlagsSchema,
  getSettings,
  requireFeature,
  requireWritable,
} from './site-settings.js';
import { temporaryUpload, type PrivateStorage } from './storage.js';

export { getSettings, requireFeature } from './site-settings.js';

interface OperationsContext {
  db: Client;
  now: Clock;
  authenticate: (request: FastifyRequest) => Promise<CurrentUser>;
  storage: PrivateStorage;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) =>
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
        !/<\/?[a-z][^>]*>/i.test(value),
      'Use plain text without HTML or control characters.',
    );
const secureLink = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    if (!value) return true;
    if (/[\u0000-\u0020\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname;
    } catch {
      return false;
    }
  }, 'Use a complete HTTPS link or leave this field blank.');

const developerApp = z
  .object({
    name: text(80).min(1),
    description: text(1000),
    url: secureLink.refine((value) => value.length > 0, 'Add an HTTPS link for this app.'),
  })
  .strict();

const developerFields = z
  .object({
    published: z.boolean(),
    title: text(100),
    name: text(100),
    bio: text(4000),
    portfolioUrl: secureLink,
    updatesText: text(4000),
    apps: z.array(developerApp).max(12),
  })
  .strict();

export interface DeveloperProfile extends z.infer<typeof developerFields> {
  version: number;
  updatedAt: string;
}

function developerRecord(row: SqlRow): DeveloperProfile {
  return {
    version: numberValue(row.version),
    published: row.published === 1,
    title: stringValue(row.title),
    name: stringValue(row.name),
    bio: stringValue(row.bio),
    portfolioUrl: stringValue(row.portfolio_url),
    updatesText: stringValue(row.updates_text),
    apps: z
      .array(developerApp)
      .max(12)
      .parse(JSON.parse(stringValue(row.apps_json))),
    updatedAt: stringValue(row.updated_at),
  };
}

async function getDeveloper(db: Database): Promise<DeveloperProfile> {
  const row = await first(db, 'SELECT * FROM developer_profile WHERE id = 1');
  requireCondition(
    row,
    503,
    'developer_unavailable',
    'Developer information is temporarily unavailable.',
  );
  return developerRecord(row);
}

function userId(request: FastifyRequest): string {
  return z
    .string()
    .min(1)
    .max(128)
    .parse((request.params as Record<string, unknown>).id);
}

/** Durable cleanup entries allow replaced/deleted avatars to be removed after a transient storage error. */
async function cleanOldAvatars(
  db: Database,
  storage: PrivateStorage,
  app: FastifyInstance,
): Promise<void> {
  const pending = await rows(
    db,
    'SELECT object_key FROM avatar_cleanup_queue ORDER BY created_at LIMIT 5',
  );
  for (const entry of pending) {
    const key = stringValue(entry.object_key);
    try {
      await storage.delete(key);
      await db.execute({
        sql: 'DELETE FROM avatar_cleanup_queue WHERE object_key = ?',
        args: [key],
      });
    } catch {
      await db
        .execute({
          sql: 'UPDATE avatar_cleanup_queue SET attempts = attempts + 1 WHERE object_key = ?',
          args: [key],
        })
        .catch(() => undefined);
      app.log.warn('An old profile photo is queued for storage cleanup.');
    }
  }
}

async function queueOldAvatar(db: Database, key: unknown, stamp: Date): Promise<void> {
  if (!key) return;
  await db.execute({
    sql: 'INSERT OR IGNORE INTO avatar_cleanup_queue(object_key,created_at) VALUES (?,?)',
    args: [stringValue(key), stamp.toISOString()],
  });
}

export function registerOperationsRoutes(app: FastifyInstance, context: OperationsContext): void {
  const { db, now, authenticate, storage } = context;
  app.addHook('onReady', async () => {
    await cleanOldAvatars(db, storage, app);
  });

  app.get('/api/site', async (request) => {
    await authenticate(request);
    return { settings: await getSettings(db) };
  });

  app.get('/api/admin/settings', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    return { settings: await getSettings(db) };
  });

  app.patch('/api/admin/settings', async (request) => {
    const actor = await authenticate(request);
    const input = z
      .object({
        version: z.number().int().positive(),
        features: featureFlagsSchema.partial().optional(),
        maintenance: z
          .object({ enabled: z.boolean(), message: text(500).min(1) })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (value) => value.features !== undefined || value.maintenance !== undefined,
        'Choose a setting to update.',
      )
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      const current = await getSettings(tx);
      requireCondition(
        input.version === current.version,
        409,
        'settings_changed',
        'Settings have changed. Refresh before saving again.',
      );
      const features = { ...current.features, ...input.features };
      const maintenance = input.maintenance || current.maintenance;
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE site_settings SET version = version + 1,features_json = ?,maintenance_enabled = ?,maintenance_message = ?,updated_at = ? WHERE id = 1',
        args: [
          JSON.stringify(features),
          maintenance.enabled ? 1 : 0,
          maintenance.message,
          stamp.toISOString(),
        ],
      });
      await audit(tx, actor.id, 'settings.updated', 'site', stamp, {
        features,
        maintenanceEnabled: maintenance.enabled,
      });
      return { settings: await getSettings(tx) };
    });
  });

  app.get('/api/admin/developer', async (request) => {
    const actor = await authenticate(request);
    await requireMaster(db, actor);
    return { developer: await getDeveloper(db) };
  });

  app.patch('/api/admin/developer', async (request) => {
    const actor = await authenticate(request);
    const input = developerFields
      .partial()
      .extend({ version: z.number().int().positive() })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      const current = await getDeveloper(tx);
      requireCondition(
        current.version === input.version,
        409,
        'developer_changed',
        'Developer information has changed. Refresh before saving again.',
      );
      const { version: _version, ...changes } = input;
      const next = { ...current, ...changes };
      requireCondition(
        !next.published || (next.title.length > 0 && next.name.length > 0 && next.bio.length > 0),
        400,
        'developer_incomplete',
        'Add a title, name, and biography before publishing.',
      );
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE developer_profile SET version=version+1,published=?,title=?,name=?,bio=?,portfolio_url=?,updates_text=?,apps_json=?,updated_at=? WHERE id=1',
        args: [
          next.published ? 1 : 0,
          next.title,
          next.name,
          next.bio,
          next.portfolioUrl,
          next.updatesText,
          JSON.stringify(next.apps),
          stamp.toISOString(),
        ],
      });
      await audit(
        tx,
        actor.id,
        next.published ? 'developer.published' : 'developer.saved_draft',
        'developer',
        stamp,
      );
      return { developer: await getDeveloper(tx) };
    });
  });

  app.get('/api/developer', async (request) => {
    await authenticate(request);
    await requireFeature(db, 'developer');
    const developer = await getDeveloper(db);
    return { developer: developer.published ? developer : null };
  });

  // Old Tutor content is retained only in the legacy database table. The old API
  // cannot accidentally expose or publish it after the application's scope changes.
  app.get('/api/tutor', async (request) => {
    await authenticate(request);
    requireCondition(false, 410, 'feature_retired', 'The Tutor feature has been retired.');
  });
  for (const method of ['GET', 'PATCH'] as const) {
    app.route({
      method,
      url: '/api/admin/tutor',
      handler: async (request) => {
        const actor = await authenticate(request);
        await requireMaster(db, actor);
        requireCondition(false, 410, 'feature_retired', 'The Tutor feature has been retired.');
      },
    });
  }

  app.patch('/api/admin/users/:id/status', async (request) => {
    const actor = await authenticate(request);
    const targetId = userId(request);
    const { status } = z
      .object({ status: z.enum(['active', 'suspended']) })
      .strict()
      .parse(request.body);
    return inWriteTransaction(db, async (tx) => {
      await requireMaster(tx, actor);
      const target = await first(tx, 'SELECT * FROM users WHERE id = ?', [targetId]);
      requireCondition(target, 404, 'user_not_found', 'This account was not found.');
      requireCondition(
        targetId !== actor.id && target.role !== 'master',
        409,
        'owner_protected',
        'The owner account cannot be suspended here.',
      );
      if (target.status === status) return { user: publicUser(target) };
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE users SET status = ?,updated_at = ? WHERE id = ?',
        args: [status, stamp.toISOString(), targetId],
      });
      await audit(
        tx,
        actor.id,
        `account.${status === 'active' ? 'reactivated' : 'suspended'}`,
        targetId,
        stamp,
      );
      return {
        user: publicUser((await first(tx, 'SELECT * FROM users WHERE id = ?', [targetId]))!),
      };
    });
  });

  app.post(
    '/api/me/avatar',
    {
      bodyLimit: 2 * 1024 * 1024 + 16 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => {
      const actor = await authenticate(request);
      await requireFeature(db, 'profilePhotos');
      await requireWritable(db, actor);
      const upload = await temporaryUpload(request, 2 * 1024 * 1024);
      const outputPath = `${upload.path}.webp`;
      const key = `avatars/${randomUUID()}.webp`;
      let storageWriteAttempted = false;
      let committed = false;
      try {
        requireCondition(
          Object.keys(upload.fields).length === 0,
          400,
          'unexpected_field',
          'Upload a single image file without extra fields.',
        );
        requireCondition(
          ['image/jpeg', 'image/png', 'image/webp'].includes(upload.mime),
          400,
          'invalid_photo',
          'Choose a JPEG, PNG, or WebP photo.',
        );
        try {
          const photo = sharp(upload.path, { limitInputPixels: 16_000_000, failOn: 'warning' });
          const metadata = await photo.metadata();
          const formatMimes: Record<string, string> = {
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
          };
          requireCondition(
            metadata.format &&
              formatMimes[metadata.format] === upload.mime &&
              (metadata.pages || 1) === 1 &&
              !!metadata.width &&
              !!metadata.height,
            400,
            'invalid_photo',
            'Choose a single-frame JPEG, PNG, or WebP photo.',
          );
          // Sharp removes original metadata unless keepMetadata/withMetadata is explicitly requested.
          await photo
            .rotate()
            .resize(512, 512, { fit: 'cover', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(outputPath);
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(
            400,
            'invalid_photo',
            'The image could not be read. Choose a photo under 2 MiB and 16 megapixels.',
          );
        }
        storageWriteAttempted = true;
        await storage.putFile(key, outputPath, 'image/webp');
        const result = await inWriteTransaction(db, async (tx) => {
          await requireFeature(tx, 'profilePhotos');
          await requireWritable(tx, actor);
          const current = await first(
            tx,
            "SELECT * FROM users WHERE id = ? AND status = 'active'",
            [actor.id],
          );
          requireCondition(current, 403, 'account_suspended', 'This account is not active.');
          const stamp = now();
          await tx.execute({
            sql: 'UPDATE users SET avatar_key = ?,avatar_version = ?,updated_at = ? WHERE id = ?',
            args: [key, randomUUID(), stamp.toISOString(), actor.id],
          });
          await queueOldAvatar(tx, current.avatar_key, stamp);
          await audit(tx, actor.id, 'profile.photo_updated', actor.id, stamp);
          return {
            user: publicUser((await first(tx, 'SELECT * FROM users WHERE id = ?', [actor.id]))!),
          };
        });
        committed = true;
        await cleanOldAvatars(db, storage, app).catch(() =>
          app.log.warn('Profile photo cleanup will be retried.'),
        );
        return result;
      } finally {
        // A storage provider can write the bytes before reporting a network/IO error.
        // Compensate even when putFile did not resolve successfully.
        if (storageWriteAttempted && !committed) {
          await storage.delete(key).catch(async () => {
            await queueOldAvatar(db, key, now()).catch(() => undefined);
          });
        }
        await rm(outputPath, { force: true });
        await upload.cleanup();
      }
    },
  );

  app.delete('/api/me/avatar', async (request) => {
    const actor = await authenticate(request);
    // Allow a user to remove their own photo even when new profile photos are disabled.
    const result = await inWriteTransaction(db, async (tx) => {
      await requireWritable(tx, actor);
      const current = await first(tx, "SELECT * FROM users WHERE id = ? AND status = 'active'", [
        actor.id,
      ]);
      requireCondition(current, 403, 'account_suspended', 'This account is not active.');
      const stamp = now();
      await tx.execute({
        sql: 'UPDATE users SET avatar_key = NULL,avatar_version = NULL,updated_at = ? WHERE id = ?',
        args: [stamp.toISOString(), actor.id],
      });
      await queueOldAvatar(tx, current.avatar_key, stamp);
      if (current.avatar_key) await audit(tx, actor.id, 'profile.photo_removed', actor.id, stamp);
      return {
        user: publicUser((await first(tx, 'SELECT * FROM users WHERE id = ?', [actor.id]))!),
      };
    });
    await cleanOldAvatars(db, storage, app).catch(() =>
      app.log.warn('Profile photo cleanup will be retried.'),
    );
    return result;
  });

  app.get('/api/users/:id/avatar', async (request, reply) => {
    const actor = await authenticate(request);
    await requireFeature(db, 'profilePhotos');
    const targetId = userId(request);
    const target = await first(
      db,
      "SELECT avatar_key FROM users WHERE id = ? AND status = 'active'",
      [targetId],
    );
    requireCondition(
      target?.avatar_key,
      404,
      'photo_not_found',
      'This profile photo is not available.',
    );
    if (actor.id !== targetId) {
      const authoritative = await first(
        db,
        "SELECT role FROM users WHERE id = ? AND status = 'active'",
        [actor.id],
      );
      requireCondition(authoritative, 403, 'account_suspended', 'This account is not active.');
      const commonClass =
        authoritative?.role === 'master'
          ? true
          : await first(
              db,
              `
        SELECT a.class_id FROM memberships a JOIN memberships b ON b.class_id = a.class_id
        JOIN student_sections sa ON sa.user_id = a.user_id AND sa.class_id = a.class_id AND sa.needs_resolution = 0
        JOIN student_sections sb ON sb.user_id = b.user_id AND sb.class_id = b.class_id AND sb.needs_resolution = 0
        JOIN classes c ON c.id = a.class_id
        WHERE a.user_id = ? AND b.user_id = ? AND a.status = 'active' AND b.status = 'active' AND c.status = 'active' LIMIT 1`,
              [actor.id, targetId],
            );
      requireCondition(commonClass, 404, 'photo_not_found', 'This profile photo is not available.');
    }
    const file = await storage.open(stringValue(target.avatar_key));
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Content-Length', file.size)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', 'inline; filename="profile.webp"')
      .type('image/webp')
      .send(file.stream);
  });
}
