import { createApp } from './app.js';
import { loadConfig } from './config.js';
import type { FastifyInstance } from 'fastify';

let runningApp: FastifyInstance | undefined;
try {
  const config = loadConfig();
  const app = await createApp({ config });
  runningApp = app;
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await app.listen({ host: config.host, port: config.port });
  if (config.authMode === 'demo') {
    app.log.info(
      'Local demo uses fictional identities. Firebase sign-in, email delivery, and university enrollment are not being simulated as verified services.',
    );
  }
} catch (error) {
  if (runningApp) await runningApp.close().catch(() => undefined);
  console.error(
    `ZabSync could not start: ${error instanceof Error ? error.message : 'Unknown configuration error'}`,
  );
  process.exitCode = 1;
}
