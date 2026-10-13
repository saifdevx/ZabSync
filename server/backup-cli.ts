import 'dotenv/config';
import { mkdir, open, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import {
  assertPrivateBackupPath,
  exportDatabaseBackup,
  inspectDatabaseBackup,
  restoreDatabaseBackup,
} from './backup.js';
import { ApiError, requireCondition } from './errors.js';

const usage = `Usage:
  npm run backup -- export --output data/backups/NAME.ndjson
  npm run backup -- inspect --input data/backups/NAME.ndjson
  npm run backup -- restore --input data/backups/NAME.ndjson --target file:./data/NEW.db
  npm run backup -- rehearse --input data/backups/NAME.ndjson --target file:./data/NEW-rehearsal.db

Export reads DATABASE_URL and DATABASE_AUTH_TOKEN without changing its schema.
Restore/rehearse require a new target; existing local files and nonempty databases
are refused. A remote target may use BACKUP_TARGET_AUTH_TOKEN. There is no --force.
Backups contain private SQL rows, including encrypted credentials; not resource
file bytes. Protect the file and your separate key recovery material.
See docs/BACKUP_AND_RESTORE.md.`;

function filePath(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  requireCondition(
    !url.includes(':memory:') && !url.includes('?') && !url.includes('#'),
    400,
    'backup_file_url_invalid',
    'Use an explicit persistent file: database path without query parameters.',
  );
  return url.startsWith('file://') ? fileURLToPath(url) : resolve(url.slice(5));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const action = args.shift();
  requireCondition(
    ['export', 'inspect', 'restore', 'rehearse'].includes(action || ''),
    400,
    'backup_arguments',
    usage,
  );
  const flags: Record<string, string> = Object.create(null);
  while (args.length) {
    const flag = args.shift()!,
      value = args.shift();
    requireCondition(
      ['--input', '--output', '--target'].includes(flag) &&
        value &&
        !value.startsWith('--') &&
        !flags[flag],
      400,
      'backup_arguments',
      usage,
    );
    flags[flag] = value;
  }
  const expected =
    action === 'export'
      ? ['--output']
      : action === 'inspect'
        ? ['--input']
        : ['--input', '--target'];
  requireCondition(
    Object.keys(flags).length === expected.length && expected.every((key) => flags[key]),
    400,
    'backup_arguments',
    usage,
  );
  if (action === 'inspect') {
    console.log(
      JSON.stringify(
        { mode: 'inspect', ...(await inspectDatabaseBackup(flags['--input']!)) },
        null,
        2,
      ),
    );
    return;
  }
  if (action === 'export') {
    const url = process.env.DATABASE_URL;
    requireCondition(
      url,
      400,
      'backup_source_missing',
      'Set DATABASE_URL to the existing source database.',
    );
    const path = filePath(url);
    if (path)
      requireCondition(
        (await stat(path).catch(() => null))?.isFile(),
        409,
        'backup_source_missing',
        'The source database does not exist. No new source database was created.',
      );
    const source = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
      intMode: 'bigint',
    });
    try {
      console.log(
        JSON.stringify(
          { mode: 'export', ...(await exportDatabaseBackup(source, flags['--output']!)) },
          null,
          2,
        ),
      );
    } finally {
      source.close();
    }
    return;
  }
  // Reject malformed or damaged backups before creating even an empty target file.
  await inspectDatabaseBackup(flags['--input']!);
  const targetUrl = flags['--target']!;
  requireCondition(
    /^(file:|libsql:\/\/|https:\/\/)/.test(targetUrl),
    400,
    'backup_target_invalid',
    'Target must be a new file: database or compatible libSQL HTTPS endpoint.',
  );
  requireCondition(
    targetUrl !== process.env.DATABASE_URL,
    409,
    'backup_source_is_target',
    'The target is the configured application database. Choose a new recovery database.',
  );
  const path = filePath(targetUrl);
  if (path) {
    assertPrivateBackupPath(path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Atomic exclusive creation also refuses symlinks/existing files; no overwrite option exists.
    const handle = await open(path, 'wx', 0o600);
    await handle.close();
  } else
    requireCondition(
      process.env.BACKUP_TARGET_AUTH_TOKEN,
      400,
      'backup_target_token_missing',
      'Set BACKUP_TARGET_AUTH_TOKEN for the new remote restore target.',
    );
  const target = createClient({
    url: targetUrl,
    authToken: path ? undefined : process.env.BACKUP_TARGET_AUTH_TOKEN,
    intMode: 'bigint',
  });
  try {
    const summary = await restoreDatabaseBackup(target, flags['--input']!);
    console.log(JSON.stringify({ mode: action, ...summary }, null, 2));
    console.log(
      action === 'rehearse'
        ? 'SQL restore rehearsal passed in the new isolated target. Source configuration is unchanged. Check the matching private files and app sign-in separately.'
        : 'SQL restored into the new target. The running app configuration is unchanged; verify files and identities before an explicit cutover.',
    );
  } finally {
    target.close();
  }
}

main().catch((error: unknown) => {
  // SQL, URLs, data rows and provider credentials are never printed in failure diagnostics.
  console.error(
    error instanceof ApiError
      ? error.message
      : (error as NodeJS.ErrnoException).code === 'EEXIST'
        ? 'The output or target file already exists. Choose a new path; nothing was overwritten.'
        : 'Backup operation failed. Check paths, free disk space, database connectivity and docs/BACKUP_AND_RESTORE.md. No private database values are printed.',
  );
  process.exitCode = 1;
});
