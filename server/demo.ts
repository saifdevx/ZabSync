import { randomUUID } from 'node:crypto';
import type { Client } from '@libsql/client';
import { first, inWriteTransaction } from './db.js';

export const DEMO_CLASS_ID = '10000000-0000-4000-8000-000000000001';
export const DEMO_OTHER_CLASS_ID = '10000000-0000-4000-8000-000000000002';
export const DEMO_USERS = {
  student: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'demo.student@szabist-isb.pk',
    displayName: 'Areeba Khan',
  },
  admin: {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'demo.cr@szabist-isb.pk',
    displayName: 'Hamza Ahmed',
  },
  legacyGr: {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'demo.gr@szabist-isb.pk',
    displayName: 'Sara Ali',
  },
  master: {
    id: '00000000-0000-4000-8000-000000000004',
    email: 'demo.master@szabist-isb.pk',
    displayName: 'ZabSync Owner',
  },
  otherAdmin: {
    id: '00000000-0000-4000-8000-000000000005',
    email: 'demo.other-cr@szabist-isb.pk',
    displayName: 'Bilal Hassan',
  },
} as const;

/** Fictional local fixtures. This routine never sends mail or creates Firebase identities. */
export async function seedDemo(db: Client, now = new Date()): Promise<void> {
  await inWriteTransaction(db, async (tx) => {
    const stamp = now.toISOString();
    const existingMode = await first(
      tx,
      "SELECT value FROM app_metadata WHERE key = 'identity_mode'",
    );
    if (existingMode && existingMode.value !== 'demo')
      throw new Error('Refusing to seed demo identities into a Firebase database.');
    const realUser = await first(
      tx,
      "SELECT id FROM users WHERE identity_source != 'demo' LIMIT 1",
    );
    if (realUser)
      throw new Error('Refusing to seed demo identities into a database containing real users.');
    await tx.execute({
      sql: "INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('identity_mode', 'demo')",
      args: [],
    });
    for (const [persona, user] of Object.entries(DEMO_USERS)) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO users (id,email,display_name,role,status,identity_source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        args: [
          user.id,
          user.email,
          user.displayName,
          persona === 'master' ? 'master' : 'student',
          'active',
          'demo',
          stamp,
          stamp,
        ],
      });
    }
    await tx.execute({
      sql: 'INSERT OR IGNORE INTO classes(id,name,program,semester,section,description,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      args: [
        DEMO_CLASS_ID,
        '5D',
        'BS Computer Science',
        5,
        'D',
        'One place for our class. Your class workspace starts here.',
        DEMO_USERS.master.id,
        stamp,
        stamp,
      ],
    });
    await tx.execute({
      sql: 'INSERT OR IGNORE INTO classes(id,name,program,semester,section,description,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      args: [
        DEMO_OTHER_CLASS_ID,
        '4A',
        'BS Software Engineering',
        4,
        'A',
        'A separate classroom for testing membership boundaries.',
        DEMO_USERS.master.id,
        stamp,
        stamp,
      ],
    });
    // The owner uses its console; existing historical owner memberships are left intact.
    for (const persona of ['student', 'admin', 'legacyGr'] as const) {
      await tx.execute({
        sql: 'INSERT OR IGNORE INTO memberships(id,class_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        args: [
          randomUUID(),
          DEMO_CLASS_ID,
          DEMO_USERS[persona].id,
          persona === 'admin' || persona === 'legacyGr' ? 'admin' : 'student',
          'active',
          stamp,
          stamp,
        ],
      });
    }
    await tx.execute({
      sql: 'INSERT OR IGNORE INTO memberships(id,class_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      args: [
        randomUUID(),
        DEMO_OTHER_CLASS_ID,
        DEMO_USERS.otherAdmin.id,
        'admin',
        'active',
        stamp,
        stamp,
      ],
    });
  });
}
