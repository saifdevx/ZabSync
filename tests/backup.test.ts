import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test, { type TestContext } from 'node:test';
import { createClient, type Client, type TransactionMode } from '@libsql/client';
import {
  exportDatabaseBackup,
  inspectDatabaseBackup,
  restoreDatabaseBackup,
} from '../server/backup.js';
import { migrate } from '../server/db.js';
import { seedDemo } from '../server/demo.js';
import { seedAcademic } from '../server/academic.js';
import { seedTimetableDemo } from '../server/timetable.js';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(process.cwd(), 'tests', '.backup-'));
  const clients: Client[] = [];
  function db(name: string) {
    const client = createClient({ url: `file:${join(directory, name)}`, intMode: 'bigint' });
    clients.push(client);
    return client;
  }
  t.after(async () => {
    for (const client of clients) client.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, db };
}

async function sourceData(db: Client) {
  await db.executeMultiple(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE parents(id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE children(id INTEGER PRIMARY KEY AUTOINCREMENT,parent TEXT REFERENCES parents(id),data BLOB,number INTEGER,real REAL,note TEXT);
    CREATE INDEX children_parent ON children(parent);
    CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,message TEXT);
    CREATE TRIGGER child_log AFTER INSERT ON children BEGIN INSERT INTO audit(message) VALUES ('child created'); END;
    CREATE VIEW child_view AS SELECT children.id,parents.name FROM children JOIN parents ON parents.id=children.parent;
    CREATE TABLE odd_rows(value TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT) WITHOUT ROWID;
    CREATE TABLE computed(a INTEGER,b INTEGER GENERATED ALWAYS AS (a*2) STORED);
    INSERT INTO parents VALUES ('p','Parent');
    INSERT INTO children(id,parent,data,number,real,note) VALUES (1,'p',X'00FF10',9223372036854775807,1.25,'before');
    INSERT INTO children(id,parent,note) VALUES (100,'p','removed high ID');
    DELETE FROM children WHERE id=100;
    INSERT INTO odd_rows(rowid,value) VALUES (7,'first'),(42,'second');
    INSERT INTO settings VALUES ('token','encrypted-token-sample');
    INSERT INTO computed(a) VALUES (3);
    PRAGMA user_version=14;
    PRAGMA application_id=123456;
  `);
  await db.execute({
    sql: 'UPDATE children SET note=? WHERE id=1',
    args: ['Unicode سٹوڈنٹ\nquoted "text"\0 end; DROP TABLE parents;'],
  });
}

test('SQL backup and restore preserve schema, blobs, full integers, rowids, triggers, generated columns and sequences', async (t) => {
  const f = await fixture(t),
    source = f.db('source.db'),
    target = f.db('target.db');
  await sourceData(source);
  const path = join(f.directory, 'snapshot.ndjson');
  const summary = await exportDatabaseBackup(source, path, new Date('2026-10-12T00:00:00Z'));
  assert.equal(summary.tables, 6);
  assert.equal(summary.rows, 8);
  assert.equal(summary.storageObjectsIncluded, false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await inspectDatabaseBackup(path)).sha256, summary.sha256);
  const restored = await restoreDatabaseBackup(target, path);
  assert.equal(restored.restored, true);
  const query =
    'SELECT id,parent,hex(data) AS bytes,CAST(number AS TEXT) AS n,real,note FROM children ORDER BY id';
  assert.deepEqual((await target.execute(query)).rows, (await source.execute(query)).rows);
  assert.deepEqual(
    (await target.execute('SELECT rowid,value FROM odd_rows ORDER BY rowid')).rows,
    (await source.execute('SELECT rowid,value FROM odd_rows ORDER BY rowid')).rows,
  );
  assert.deepEqual(
    (
      await target.execute(
        'SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
      )
    ).rows,
    (
      await source.execute(
        'SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
      )
    ).rows,
  );
  assert.equal((await target.execute('SELECT b FROM computed')).rows[0]!.b, 6n);
  assert.equal((await target.execute('SELECT name FROM child_view')).rows[0]!.name, 'Parent');
  assert.equal((await target.execute('PRAGMA user_version')).rows[0]![0], 14n);
  assert.equal((await target.execute('PRAGMA application_id')).rows[0]![0], 123456n);
  // Restoring records did not replay the AFTER INSERT trigger, and its sequence was preserved.
  assert.equal((await target.execute('SELECT COUNT(*) AS n FROM audit')).rows[0]!.n, 2n);
  await target.execute("INSERT INTO children(parent,note) VALUES ('p','new after restore')");
  assert.equal(
    (await target.execute("SELECT id FROM children WHERE note='new after restore'")).rows[0]!.id,
    101n,
  );
  assert.equal((await target.execute('SELECT COUNT(*) AS n FROM audit')).rows[0]!.n, 3n);
  assert.equal((await target.execute('PRAGMA foreign_key_check')).rows.length, 0);
});

test('backup refuses an existing output and restore refuses any nonempty schema without changing it', async (t) => {
  const f = await fixture(t),
    source = f.db('source.db'),
    target = f.db('target.db');
  await sourceData(source);
  const path = join(f.directory, 'snapshot.ndjson');
  await exportDatabaseBackup(source, path);
  const before = await readFile(path);
  await assert.rejects(exportDatabaseBackup(source, path), /EEXIST/);
  assert.deepEqual(await readFile(path), before);
  await target.execute('CREATE TABLE valuable(id INTEGER PRIMARY KEY,secret TEXT)');
  await target.execute("INSERT INTO valuable VALUES(1,'must survive')");
  await assert.rejects(restoreDatabaseBackup(target, path), /already contains a schema/);
  assert.equal(
    (await target.execute('SELECT secret FROM valuable')).rows[0]!.secret,
    'must survive',
  );
  assert.equal(
    (await target.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name='children'"))
      .rows.length,
    0,
  );
});

test('truncation and altered checksums are rejected before any restore data is committed', async (t) => {
  const f = await fixture(t),
    source = f.db('source.db');
  await sourceData(source);
  const path = join(f.directory, 'snapshot.ndjson');
  await exportDatabaseBackup(source, path);
  const bytes = await readFile(path, 'utf8');
  for (const [name, altered] of [
    ['truncated', bytes.slice(0, -10)],
    ['changed', bytes.replace('encrypted-token-sample', 'different-token-sample')],
  ] as const) {
    const bad = join(f.directory, `${name}.ndjson`);
    await writeFile(bad, altered);
    const target = f.db(`${name}.db`);
    await assert.rejects(restoreDatabaseBackup(target, bad), /incomplete|checksum/);
    assert.equal(
      (await target.execute("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).rows
        .length,
      0,
    );
  }
});

test('a malformed but rehashed foreign-key snapshot rolls back the entire fresh-target restore', async (t) => {
  const f = await fixture(t),
    source = f.db('source.db');
  await sourceData(source);
  const path = join(f.directory, 'snapshot.ndjson');
  await exportDatabaseBackup(source, path);
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
  let inChildren = false;
  for (let index = 0; index < lines.length - 1; index++) {
    const record = JSON.parse(lines[index]!);
    if (record.kind === 'table') inChildren = record.name === 'children';
    if (record.kind === 'row' && inChildren) {
      record.values[2] = ['text', 'missing-parent'];
      lines[index] = JSON.stringify(record);
      break;
    }
  }
  const hash = createHash('sha256')
    .update(lines.slice(0, -1).join('\n') + '\n')
    .digest('hex');
  const footer = JSON.parse(lines.at(-1)!);
  footer.sha256 = hash;
  lines[lines.length - 1] = JSON.stringify(footer);
  const bad = join(f.directory, 'invalid-relationship.ndjson');
  await writeFile(bad, lines.join('\n') + '\n');
  const target = f.db('target.db');
  await assert.rejects(
    restoreDatabaseBackup(target, bad),
    /relationships are inconsistent|FOREIGN KEY/,
  );
  assert.equal(
    (await target.execute("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")).rows
      .length,
    0,
  );
});

test('all exported tables belong to one snapshot when another connection writes during the backup', async (t) => {
  const f = await fixture(t),
    source = f.db('source.db'),
    writer = f.db('source.db');
  await source.execute('PRAGMA journal_mode=WAL');
  await sourceData(source);
  let wrote = false;
  const wrapped = new Proxy(source, {
    get(target, property) {
      if (property !== 'transaction') {
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (mode: TransactionMode) => {
        const transaction = await target.transaction(mode);
        return new Proxy(transaction, {
          get(tx, field) {
            if (field !== 'execute') {
              const value = Reflect.get(tx, field);
              return typeof value === 'function' ? value.bind(tx) : value;
            }
            return async (statement: Parameters<typeof tx.execute>[0]) => {
              const result = await tx.execute(statement);
              if (
                !wrote &&
                typeof statement === 'string' &&
                statement.includes('SELECT type,name,tbl_name,sql')
              ) {
                wrote = true;
                await writer.execute("UPDATE parents SET name='after snapshot' WHERE id='p'");
                await writer.execute(
                  "INSERT INTO settings VALUES ('during-export','must not appear')",
                );
              }
              return result;
            };
          },
        });
      };
    },
  });
  const path = join(f.directory, 'consistent.ndjson');
  await exportDatabaseBackup(wrapped, path);
  const target = f.db('target.db');
  await restoreDatabaseBackup(target, path);
  assert.equal(wrote, true);
  assert.equal((await source.execute('SELECT name FROM parents')).rows[0]!.name, 'after snapshot');
  assert.equal((await target.execute('SELECT name FROM parents')).rows[0]!.name, 'Parent');
  assert.equal(
    (await target.execute("SELECT value FROM settings WHERE key='during-export'")).rows.length,
    0,
  );
});

test('empty sources fail without leaving a misleading completed backup', async (t) => {
  const f = await fixture(t),
    source = f.db('empty.db'),
    path = join(f.directory, 'empty.ndjson');
  await assert.rejects(exportDatabaseBackup(source, path), /no application schema/);
  await assert.rejects(stat(path), /ENOENT/);
});

test('the complete Checkpoint 4 schema and representative demo records survive a SQL recovery round trip', async (t) => {
  const f = await fixture(t),
    source = f.db('checkpoint4.db'),
    target = f.db('recovered.db');
  await migrate(source);
  await seedDemo(source);
  await seedAcademic(source);
  await seedTimetableDemo(source);
  const path = join(f.directory, 'checkpoint4.ndjson');
  const summary = await exportDatabaseBackup(source, path);
  assert.ok(summary.tables >= 30);
  for (const table of [
    'drive_connections',
    'drive_objects',
    'base_storage_objects',
    'student_sections',
    'schema_migrations',
  ]) {
    assert.ok(Object.hasOwn(summary.tableRows, table), `snapshot must include ${table}`);
  }
  await restoreDatabaseBackup(target, path);
  const again = await exportDatabaseBackup(target, join(f.directory, 'restored.ndjson'));
  assert.deepEqual(again.tableRows, summary.tableRows);
  assert.equal(again.schemaObjects, summary.schemaObjects);
  assert.equal((await target.execute('PRAGMA foreign_key_check')).rows.length, 0);
});

test('backup CLI rehearses into a new private file and refuses an existing target path', async (t) => {
  const f = await fixture(t),
    source = f.db('source.db');
  await sourceData(source);
  const snapshot = join(f.directory, 'cli.ndjson'),
    target = join(f.directory, 'cli-rehearsal.db');
  const run = promisify(execFile),
    cli = join(process.cwd(), 'server', 'backup-cli.ts');
  const options = {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${join(f.directory, 'source.db')}` },
    timeout: 60_000,
  };
  const exported = await run(
    process.execPath,
    ['--import', 'tsx', cli, 'export', '--output', snapshot],
    options,
  );
  assert.equal(exported.stdout.includes('encrypted-token-sample'), false);
  const rehearsed = await run(
    process.execPath,
    ['--import', 'tsx', cli, 'rehearse', '--input', snapshot, '--target', `file:${target}`],
    options,
  );
  assert.match(rehearsed.stdout, /rehearsal passed/);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  const before = await readFile(target);
  await assert.rejects(
    run(
      process.execPath,
      ['--import', 'tsx', cli, 'restore', '--input', snapshot, '--target', `file:${target}`],
      options,
    ),
    (error: unknown) => /already exists/.test(String((error as { stderr?: string }).stderr)),
  );
  assert.deepEqual(await readFile(target), before);
});
