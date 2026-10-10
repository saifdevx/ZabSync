import { loadConfig } from './config.js';
import { migrate, openDatabase } from './db.js';
import { ensureIdentityMode } from './auth.js';

try {
  const config = loadConfig();
  const db = await openDatabase(config.databaseUrl, config.databaseAuthToken);
  try {
    await migrate(db);
    await ensureIdentityMode(db, config.authMode);
    console.log(
      'Database schema is up to date. No demo identities were added by this migration command.',
    );
  } finally {
    db.close();
  }
} catch (error) {
  console.error(
    `Migration failed: ${error instanceof Error ? error.message : 'Unknown configuration error'}`,
  );
  process.exitCode = 1;
}
