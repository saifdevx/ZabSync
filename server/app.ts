import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import type { Client } from '@libsql/client';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isLoopbackHost, loadConfig, validateConfig, type AppConfig } from './config.js';
import {
  createAuthenticator,
  createFirebaseVerifier,
  ensureIdentityMode,
  type Clock,
  type CurrentUser,
  type TokenVerifier,
} from './auth.js';
import { migrate, openDatabase } from './db.js';
import { seedDemo as seedDemoDatabase } from './demo.js';
import { ApiError } from './errors.js';
import { registerRoutes } from './routes.js';
import { createPrivateStorage, loadStorageConfig, type PrivateStorage } from './storage.js';
import { registerOperationsRoutes } from './operations.js';
import { registerMaintenanceGate } from './site-settings.js';
import { registerAcademicRoutes, seedAcademic } from './academic.js';

export interface CreateAppOptions {
  config?: AppConfig;
  db?: Client;
  databaseUrl?: string;
  seedDemo?: boolean;
  now?: Clock;
  /** A trusted-provider test seam. It is impossible to enable through an HTTP request or in production. */
  verifyFirebaseToken?: TokenVerifier;
  logger?: boolean;
  staticRoot?: string;
  storage?: PrivateStorage;
}

function isLoopbackPeer(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Creates an app without opening a network port. app.close() closes an internally created database. */
export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const suppliedConfig = options.config || loadConfig();
  if (
    options.verifyFirebaseToken &&
    (suppliedConfig.nodeEnv !== 'test' || suppliedConfig.authMode !== 'firebase')
  ) {
    throw new Error(
      'Injected identity verification is allowed only in explicitly configured Firebase-mode tests.',
    );
  }
  const config = validateConfig(
    { ...suppliedConfig, ...(options.databaseUrl ? { databaseUrl: options.databaseUrl } : {}) },
    {
      allowInjectedTestIdentity: Boolean(
        options.verifyFirebaseToken && suppliedConfig.nodeEnv === 'test',
      ),
    },
  );
  const now = options.now || (() => new Date());
  // Validate/create storage before opening an owned database. A storage configuration
  // failure must not leave a database handle or new SQLite file behind.
  const storageConfig = loadStorageConfig(config.nodeEnv === 'test' ? {} : process.env);
  if (
    config.nodeEnv === 'test' &&
    config.databaseUrl.startsWith('file:') &&
    !config.databaseUrl.includes(':memory:')
  ) {
    const databasePath = config.databaseUrl.startsWith('file://')
      ? fileURLToPath(config.databaseUrl)
      : resolve(config.databaseUrl.slice(5));
    storageConfig.localDirectory = resolve(dirname(databasePath), 'private-storage');
  }
  if (config.authMode === 'demo' && storageConfig.driver !== 'local') {
    throw new Error('Local demo mode requires local private file storage.');
  }
  const storage = options.storage || createPrivateStorage(storageConfig);
  let db: Client;
  try {
    db = options.db || (await openDatabase(config.databaseUrl, config.databaseAuthToken));
  } catch (error) {
    await Promise.resolve(storage.close?.()).catch(() => undefined);
    throw error;
  }
  const ownsDatabase = !options.db;
  let closeFirebase: (() => Promise<void>) | undefined;
  let verifyFirebaseToken = options.verifyFirebaseToken;
  let resourcesClosed = false;
  const closeResources = async () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    try {
      if (closeFirebase) await closeFirebase();
    } finally {
      try {
        await storage.close?.();
      } finally {
        if (ownsDatabase) db.close();
      }
    }
  };
  const app = Fastify({
    logger: options.logger ?? config.nodeEnv !== 'test',
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
    // Bounded JSON accommodates the advertised 10,000-character announcement limit, including Unicode.
    bodyLimit: 64 * 1024,
    // Allow a bounded 25 MiB upload on a slower mobile connection.
    requestTimeout: 120_000,
  });
  try {
    await migrate(db);
    await ensureIdentityMode(db, config.authMode);
    if (config.authMode === 'demo' && options.seedDemo !== false) {
      await seedDemoDatabase(db, now());
      await seedAcademic(db, now());
    }
    if (config.authMode === 'firebase' && !verifyFirebaseToken) {
      const provider = await createFirebaseVerifier(config);
      verifyFirebaseToken = provider.verify;
      closeFirebase = provider.close;
    }
    app.addHook('onClose', closeResources);

    app.setErrorHandler((error, request, reply) => {
      if (error instanceof ApiError) {
        return reply
          .code(error.statusCode)
          .send({ error: { code: error.code, message: error.message } });
      }
      if (error instanceof z.ZodError) {
        const issue = error.issues[0];
        const field = issue?.path.join('.');
        const message = issue
          ? `${field ? `${field}: ` : ''}${issue.message}`
          : 'The request is invalid.';
        return reply.code(400).send({ error: { code: 'validation_error', message } });
      }
      const details = error as { code?: string; statusCode?: number; name?: string };
      if (details.code?.includes('SQLITE_CONSTRAINT')) {
        return reply.code(409).send({
          error: {
            code: 'conflict',
            message: 'This change conflicts with the current data. Refresh and try again.',
          },
        });
      }
      if (details.code?.includes('SQLITE_BUSY')) {
        return reply.code(503).send({
          error: {
            code: 'database_busy',
            message: 'The application is busy. Please try again shortly.',
          },
        });
      }
      const statusCode =
        typeof details.statusCode === 'number' &&
        details.statusCode >= 400 &&
        details.statusCode < 500
          ? details.statusCode
          : 500;
      if (statusCode >= 500)
        app.log.error(
          { requestId: request.id, errorName: details.name, errorCode: details.code },
          'Request failed',
        );
      return reply.code(statusCode).send({
        error: {
          code:
            statusCode === 429
              ? 'rate_limited'
              : statusCode === 413
                ? 'payload_too_large'
                : statusCode < 500
                  ? 'invalid_request'
                  : 'internal_error',
          message:
            statusCode === 429
              ? 'Too many requests. Please wait a moment and try again.'
              : statusCode === 413
                ? 'This request is too large.'
                : statusCode < 500
                  ? 'The request is invalid.'
                  : 'Something went wrong. Please try again.',
        },
      });
    });

    const allowedOrigins = new Set(config.allowedOrigins);
    if (isLoopbackHost(config.host)) {
      allowedOrigins.add(`http://localhost:${config.port}`);
      allowedOrigins.add(`http://127.0.0.1:${config.port}`);
      allowedOrigins.add(`http://[::1]:${config.port}`);
    }
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
      if (config.authMode === 'demo') {
        if (!isLoopbackPeer(request.ip))
          throw new ApiError(
            403,
            'demo_local_only',
            'Demo access is available only on this computer.',
          );
        let host: string;
        try {
          host = new URL(`http://${request.headers.host || ''}`).hostname;
        } catch {
          throw new ApiError(403, 'invalid_host', 'This host is not allowed in demo mode.');
        }
        if (!isLoopbackHost(host))
          throw new ApiError(403, 'invalid_host', 'This host is not allowed in demo mode.');
      }
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin))
        throw new ApiError(403, 'origin_not_allowed', 'This application origin is not allowed.');
    });
    await app.register(cors, {
      origin: [...allowedOrigins],
      credentials: false,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    });
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: [
            "'self'",
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://www.googleapis.com',
          ],
          imgSrc: ["'self'", 'data:', 'blob:'],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameSrc: config.firebase
            ? [`https://${config.firebase.authDomain}`, 'https://accounts.google.com']
            : ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    });
    // Only this request reuses its authentication result. Later requests always
    // recheck revocation/account state, so suspension and representative handover
    // remain immediate. Caching rejected promises also avoids a second provider call.
    const authentication = createAuthenticator(db, config, now, verifyFirebaseToken);
    const requestIdentities = new WeakMap<FastifyRequest, Promise<CurrentUser>>();
    const authenticate = (request: FastifyRequest): Promise<CurrentUser> => {
      let identity = requestIdentities.get(request);
      if (!identity) {
        identity = authentication(request);
        requestIdentities.set(request, identity);
      }
      return identity;
    };
    const pathFor = (request: FastifyRequest) => new URL(request.url, 'http://localhost').pathname;
    const isApiRequest = (request: FastifyRequest) => {
      const path = pathFor(request);
      return path === '/api' || path.startsWith('/api/');
    };
    const isPublicApi = (request: FastifyRequest) => {
      const path = pathFor(request);
      return (
        (['GET', 'HEAD'].includes(request.method) &&
          ['/api/config', '/api/health'].includes(path)) ||
        (request.method === 'POST' && path === '/api/demo/session')
      );
    };
    await app.register(rateLimit, {
      hook: 'preHandler',
      max: (_request, key) => (String(key).startsWith('public:') ? 600 : 300),
      timeWindow: '1 minute',
      allowList: (request) => !isApiRequest(request) || request.method === 'OPTIONS',
      keyGenerator: async (request) => {
        if (!isApiRequest(request) || request.method === 'OPTIONS' || isPublicApi(request))
          return `public:${request.ip}`;
        try {
          const user = await authenticate(request);
          return `user:${user.id}`;
        } catch {
          // The route will return the cached authentication error. Counting a failed
          // identity by peer IP prevents invented/rotating bearer strings from
          // bypassing limits, while real classmates retain separate user buckets.
          return `unauthenticated:${request.ip}`;
        }
      },
    });
    // A generous shared-peer bound applies before body parsing or provider work.
    // This uses createRateLimit (not rateLimit), so it does not suppress the later
    // account/endpoint limiter via the plugin's per-request "already ran" marker.
    const peerBurst = app.createRateLimit({
      max: 6000,
      timeWindow: '1 minute',
      keyGenerator: (request) => `peer:${request.ip}`,
      allowList: () => false,
    });
    app.addHook('onRequest', async (request, reply) => {
      if (!isApiRequest(request) || request.method === 'OPTIONS') return;
      const limit = await peerBurst(request);
      if (!limit.isAllowed && limit.isExceeded) {
        reply.header('Retry-After', limit.ttlInSeconds);
        throw new ApiError(
          429,
          'rate_limited',
          'This network is sending many requests. Wait a moment and try again.',
        );
      }
    });

    await app.register(multipart, {
      limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 8, fieldSize: 12000, parts: 9 },
    });
    const context = {
      db,
      config,
      now,
      authenticate,
      storage,
    };
    registerMaintenanceGate(app, context);
    registerRoutes(app, context);
    registerOperationsRoutes(app, context);
    registerAcademicRoutes(app, context);

    const staticRoot = options.staticRoot || resolve(process.cwd(), 'dist/client');
    const serveClient = await isDirectory(staticRoot);
    if (serveClient) {
      await app.register(fastifyStatic, { root: staticRoot, wildcard: false, index: 'index.html' });
    }
    app.setNotFoundHandler(async (request, reply) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (
        serveClient &&
        !pathname.startsWith('/api/') &&
        pathname !== '/api' &&
        ['GET', 'HEAD'].includes(request.method)
      ) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'This endpoint was not found.' } });
    });
    return app;
  } catch (error) {
    await app.close().catch(() => undefined);
    // onClose is registered only after initial setup; this also covers early failures.
    await closeResources().catch(() => undefined);
    throw error;
  }
}
