import type { Client } from '@libsql/client';
import {
  assertApplicationIdentity,
  audit,
  type AcceptedIdentity,
  type VerifiedIdentity,
} from './auth.js';
import type { AppConfig } from './config.js';
import { first, inWriteTransaction, rows, stringValue, type Database } from './db.js';
import { requireCondition } from './errors.js';

/** Produced by Firebase Admin getUser, never by an HTTP request or browser payload. */
export type OwnerProviderRecord = VerifiedIdentity & { disabled: boolean };

export interface OwnerTransferPlan {
  previousOwner: { id: string; email: string };
  nextOwner: { id: string; email: string };
  targetAccountExists: boolean;
  membershipsChanged: false;
}

function targetIdentity(config: AppConfig, providerRecord: OwnerProviderRecord): AcceptedIdentity {
  requireCondition(
    config.authMode === 'firebase' && config.masterAdminEmail && config.masterAdminUid,
    400,
    'owner_transfer_configuration',
    'Owner transfer requires Firebase mode and both MASTER_ADMIN_EMAIL and MASTER_ADMIN_UID for the intended new owner.',
  );
  requireCondition(
    providerRecord.disabled === false,
    403,
    'owner_target_disabled',
    'The intended owner account is disabled in Firebase. Resolve that before transferring ownership.',
  );
  const accepted = assertApplicationIdentity(providerRecord, config);
  requireCondition(
    accepted.configuredOwner,
    403,
    'owner_target_mismatch',
    'The Firebase account does not match both configured owner identity values.',
  );
  return accepted;
}

async function validateTransfer(
  db: Database,
  expectedCurrentOwnerId: string,
  target: AcceptedIdentity,
): Promise<OwnerTransferPlan> {
  requireCondition(
    expectedCurrentOwnerId.length > 0 && expectedCurrentOwnerId.length <= 128,
    400,
    'owner_source_required',
    'Provide the exact current owner Firebase UID using --from-uid.',
  );
  const mode = await first(db, "SELECT value FROM app_metadata WHERE key='identity_mode'");
  const incompatible = await first(
    db,
    "SELECT id FROM users WHERE identity_source!='firebase' LIMIT 1",
  );
  requireCondition(
    mode?.value === 'firebase' && !incompatible,
    409,
    'owner_database_mode',
    'This must be an existing Firebase application database. A demo database cannot receive a real owner.',
  );
  const owners = await rows(db, "SELECT id,email FROM users WHERE role='master'");
  requireCondition(
    owners.length === 1 && owners[0]!.id === expectedCurrentOwnerId,
    409,
    'owner_source_mismatch',
    'The current database owner does not match --from-uid. No ownership was changed.',
  );
  requireCondition(
    target.id !== expectedCurrentOwnerId,
    409,
    'owner_target_unchanged',
    'The intended account is already the owner. No transfer is needed.',
  );
  const targetRow = await first(db, 'SELECT * FROM users WHERE id=?', [target.id]);
  requireCondition(
    !targetRow || (targetRow.identity_source === 'firebase' && targetRow.status === 'active'),
    409,
    'owner_target_inactive',
    'The intended owner is not an active Firebase application account. Resolve that account status first.',
  );
  const conflictingEmail = await first(db, 'SELECT id FROM users WHERE email=? AND id!=?', [
    target.email,
    target.id,
  ]);
  requireCondition(
    !conflictingEmail,
    409,
    'identity_conflict',
    'The intended owner email belongs to a different application UID. Resolve the identity conflict first.',
  );
  return {
    previousOwner: { id: stringValue(owners[0]!.id), email: stringValue(owners[0]!.email) },
    nextOwner: { id: target.id, email: target.email },
    targetAccountExists: Boolean(targetRow),
    membershipsChanged: false,
  };
}

/** Read-only preview. It does not migrate, insert users, bootstrap, or modify an account. */
export async function reviewOwnerTransfer(
  db: Client,
  config: AppConfig,
  expectedCurrentOwnerId: string,
  providerRecord: OwnerProviderRecord,
): Promise<OwnerTransferPlan> {
  return validateTransfer(db, expectedCurrentOwnerId, targetIdentity(config, providerRecord));
}

/** Server operator only; deliberately not registered as an HTTP endpoint. */
export async function applyOwnerTransfer(
  db: Client,
  config: AppConfig,
  expectedCurrentOwnerId: string,
  providerRecord: OwnerProviderRecord,
  now: Date = new Date(),
): Promise<OwnerTransferPlan> {
  const target = targetIdentity(config, providerRecord);
  return inWriteTransaction(db, async (tx) => {
    const plan = await validateTransfer(tx, expectedCurrentOwnerId, target);
    const stamp = now.toISOString();
    await tx.execute({
      sql: "UPDATE users SET role='student',updated_at=? WHERE id=? AND role='master'",
      args: [stamp, expectedCurrentOwnerId],
    });
    if (plan.targetAccountExists) {
      await tx.execute({
        sql: "UPDATE users SET role='master',email=?,updated_at=? WHERE id=?",
        args: [target.email, stamp, target.id],
      });
    } else {
      await tx.execute({
        sql: "INSERT INTO users(id,email,display_name,role,status,identity_source,created_at,updated_at) VALUES (?,?,?,'master','active','firebase',?,?)",
        args: [target.id, target.email, target.displayName, stamp, stamp],
      });
    }
    await audit(tx, null, 'owner.transferred', target.id, now, {
      previousOwnerId: expectedCurrentOwnerId,
      source: 'server-command',
      membershipsChanged: false,
    });
    return plan;
  });
}
