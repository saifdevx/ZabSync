import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import { createFirebaseVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { ApiError, requireCondition } from './errors.js';
import { applyOwnerTransfer, reviewOwnerTransfer } from './owner-transfer.js';

const usage = `Usage: npm run owner:transfer -- --from-uid CURRENT_OWNER_UID [--apply]

Without --apply this only previews the transfer. The target comes from private
MASTER_ADMIN_EMAIL and MASTER_ADMIN_UID configuration and is checked with the
configured Firebase project's Admin API. Stop the application and back up its
database before applying. See docs/OWNER_ACCOUNT.md.`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const apply = args.includes('--apply');
  const identityArgs = args.filter((arg) => arg !== '--apply');
  requireCondition(
    identityArgs.length === 2 &&
      identityArgs[0] === '--from-uid' &&
      !identityArgs[1]!.startsWith('--') &&
      args.filter((arg) => arg === '--apply').length <= 1,
    400,
    'owner_transfer_arguments',
    usage,
  );
  const config = loadConfig();
  requireCondition(
    config.authMode === 'firebase' && config.masterAdminEmail && config.masterAdminUid,
    400,
    'owner_transfer_configuration',
    'Set AUTH_MODE=firebase, MASTER_ADMIN_EMAIL and MASTER_ADMIN_UID for the intended new owner. See docs/OWNER_ACCOUNT.md.',
  );
  // A mistyped local path must not create a new database during a preview.
  if (config.databaseUrl.startsWith('file:')) {
    const path = config.databaseUrl.startsWith('file://')
      ? fileURLToPath(config.databaseUrl)
      : resolve(config.databaseUrl.slice(5));
    const existing = await stat(path).catch(() => null);
    requireCondition(
      existing?.isFile(),
      409,
      'owner_database_missing',
      'The configured application database does not exist. Check DATABASE_URL; no database was created.',
    );
  }
  let firebase: Awaited<ReturnType<typeof createFirebaseVerifier>> | undefined;
  let db: Client | undefined;
  try {
    firebase = await createFirebaseVerifier(config);
    const target = await firebase.lookupUser(config.masterAdminUid);
    db = await openDatabase(config.databaseUrl, config.databaseAuthToken);
    const plan = apply
      ? await applyOwnerTransfer(db, config, identityArgs[1]!, target)
      : await reviewOwnerTransfer(db, config, identityArgs[1]!, target);
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', ...plan }, null, 2));
    console.log(
      apply
        ? 'Ownership transferred and audited. Restart the application with this owner configuration. Existing memberships and content were preserved.'
        : 'Preview only: no account, role, membership or audit record was changed. Review both identities; rerun with --apply only for this intended transfer.',
    );
  } finally {
    db?.close();
    await firebase?.close();
  }
}

main().catch((error: unknown) => {
  // Do not dump provider errors, environment values, database URLs or credentials.
  console.error(
    error instanceof ApiError
      ? error.message
      : 'Owner transfer could not complete. Check the server configuration, Firebase Admin access and database schema using docs/OWNER_ACCOUNT.md. No provider credentials are printed.',
  );
  process.exitCode = 1;
});
