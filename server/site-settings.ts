import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CurrentUser } from './auth.js';
import { first, numberValue, stringValue, type Database } from './db.js';
import { ApiError, requireCondition } from './errors.js';

export const featureFlagsSchema = z
  .object({
    subjects: z.boolean(),
    resources: z.boolean(),
    announcements: z.boolean(),
    tutor: z.boolean(),
    profilePhotos: z.boolean(),
  })
  .strict();

export type FeatureFlags = z.infer<typeof featureFlagsSchema>;
export type FeatureKey = keyof FeatureFlags;
export interface SiteSettings {
  version: number;
  features: FeatureFlags;
  maintenance: { enabled: boolean; message: string };
  updatedAt: string;
}

/** Only non-sensitive application controls are returned. Missing/corrupt controls fail closed. */
export async function getSettings(db: Database): Promise<SiteSettings> {
  const row = await first(db, 'SELECT * FROM site_settings WHERE id = 1');
  requireCondition(
    row,
    503,
    'settings_unavailable',
    'Application settings are unavailable. Try again shortly.',
  );
  let features: FeatureFlags;
  try {
    features = featureFlagsSchema.parse(JSON.parse(stringValue(row.features_json)));
  } catch {
    throw new ApiError(
      503,
      'settings_unavailable',
      'Application settings are unavailable. Contact the owner.',
    );
  }
  return {
    version: numberValue(row.version),
    features,
    maintenance: {
      enabled: row.maintenance_enabled === 1,
      message: stringValue(row.maintenance_message),
    },
    updatedAt: stringValue(row.updated_at),
  };
}

/** Feature controls are enforced on the server as well as in navigation. */
export async function requireFeature(db: Database, key: FeatureKey): Promise<void> {
  const settings = await getSettings(db);
  requireCondition(
    settings.features[key] === true,
    404,
    'feature_disabled',
    'This feature is currently turned off by the application owner.',
  );
}

/** Can also be called inside a write transaction to cover a concurrent maintenance change. */
export async function requireWritable(db: Database, actor: CurrentUser): Promise<void> {
  const settings = await getSettings(db);
  if (!settings.maintenance.enabled) return;
  const authoritative = await first(
    db,
    "SELECT role FROM users WHERE id = ? AND status = 'active'",
    [actor.id],
  );
  requireCondition(
    authoritative?.role === 'master',
    503,
    'maintenance_mode',
    settings.maintenance.message || 'Changes are paused during maintenance. Try again later.',
  );
}

/** Read-only maintenance leaves the sign-in/recovery and owner controls available. */
export function registerMaintenanceGate(
  app: FastifyInstance,
  context: { db: Database; authenticate: (request: FastifyRequest) => Promise<CurrentUser> },
): void {
  app.addHook('preHandler', async (request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      return;
    // These endpoints establish/end a session; they never edit academic or profile data.
    if (['/api/demo/session', '/api/logout'].includes(pathname)) return;
    const settings = await getSettings(context.db);
    if (!settings.maintenance.enabled) return;
    const actor = await context.authenticate(request);
    reply.header('Retry-After', '60');
    await requireWritable(context.db, actor);
  });
}
