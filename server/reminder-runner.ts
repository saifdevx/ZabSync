import { loadConfig } from './config.js';
import { migrate, openDatabase } from './db.js';
import {
  createFirebasePushSender,
  loadReminderOptions,
  runReminderCycle,
  startReminderRunner,
} from './reminders.js';

/** CLI only. No public scheduler endpoint or client-supplied provider keys. */
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--once', '--watch'].includes(arg)) ||
    (args.includes('--once') && args.includes('--watch'))
  )
    throw new Error('Use --once for a scheduled invocation or --watch for a persistent worker.');
  const config = loadConfig(),
    options = loadReminderOptions(process.env, config),
    db = await openDatabase(config.databaseUrl, config.databaseAuthToken);
  let sender: ReturnType<typeof createFirebasePushSender> | undefined;
  try {
    await migrate(db);
    if (options.pushEnabled) sender = createFirebasePushSender(config);
    if (!args.includes('--watch')) {
      const result = await runReminderCycle(db, { pushSender: sender, batchSize: 250 });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.errors) process.exitCode = 1;
    } else {
      const stop = startReminderRunner(db, {
        pushSender: sender,
        keepAlive: true,
        onError: () =>
          process.stderr.write(
            'Reminder cycle failed. Check database/provider configuration; no private payload is logged.\n',
          ),
      });
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      await stop();
    }
  } finally {
    await sender?.close();
    db.close();
  }
}
main().catch(() => {
  process.stderr.write(
    'The reminder worker could not start or complete. Verify private environment settings and database access.\n',
  );
  process.exitCode = 1;
});
