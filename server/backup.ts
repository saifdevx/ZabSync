import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Client, InValue, Transaction } from '@libsql/client';
import { z } from 'zod';
import { ApiError, requireCondition } from './errors.js';

const FORMAT = 'zabsync-sql-backup';
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const PAGE_ROWS = 100;
const nameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('\0'));
const objectSchema = z
  .object({
    type: z.enum(['table', 'index', 'trigger', 'view']),
    name: nameSchema,
    table: nameSchema,
    sql: z.string().min(1).max(250_000),
  })
  .strict();
type SchemaObject = z.infer<typeof objectSchema>;
type EncodedValue =
  ['null'] | ['integer', string] | ['real', number] | ['text', string] | ['blob', string];
const encodedSchema: z.ZodType<EncodedValue> = z.union([
  z.tuple([z.literal('null')]),
  z.tuple([
    z.literal('integer'),
    z
      .string()
      .regex(/^-?\d{1,19}$/)
      .refine(
        (value) =>
          /^-?\d{1,19}$/.test(value) && BigInt(value) >= -(1n << 63n) && BigInt(value) < 1n << 63n,
      ),
  ]),
  z.tuple([z.literal('real'), z.number().finite()]),
  z.tuple([z.literal('text'), z.string()]),
  z.tuple([
    z.literal('blob'),
    z
      .string()
      .refine((value) =>
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
      ),
  ]),
]);
const headerSchema = z
  .object({
    kind: z.literal('header'),
    format: z.literal(FORMAT),
    version: z.literal(1),
    createdAt: z.iso.datetime(),
    storageObjectsIncluded: z.literal(false),
    encryptedSecretsIncluded: z.literal(true),
  })
  .strict();
const schemaRecord = z
  .object({
    kind: z.literal('schema'),
    objects: z.array(objectSchema).max(10_000),
    userVersion: z.number().int().nonnegative().max(2_147_483_647),
    applicationId: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  })
  .strict();
const tableRecord = z
  .object({
    kind: z.literal('table'),
    name: nameSchema,
    columns: z.array(nameSchema).min(1).max(2001),
    rowidAlias: z.enum(['rowid', '_rowid_', 'oid']).nullable(),
  })
  .strict();
const rowRecord = z
  .object({ kind: z.literal('row'), values: z.array(encodedSchema).min(1).max(2001) })
  .strict();
const endRecord = z
  .object({ kind: z.literal('endTable'), name: nameSchema, rows: z.number().int().nonnegative() })
  .strict();
const sequenceRecord = z
  .object({
    kind: z.literal('sequence'),
    values: z
      .array(
        z.tuple([
          nameSchema,
          z
            .string()
            .regex(/^\d{1,19}$/)
            .refine((value) => /^\d{1,19}$/.test(value) && BigInt(value) < 1n << 63n),
        ]),
      )
      .max(10_000),
  })
  .strict();
const footerSchema = z
  .object({
    kind: z.literal('footer'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    tables: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
  })
  .strict();
type BackupRecord =
  | z.infer<typeof headerSchema>
  | z.infer<typeof schemaRecord>
  | z.infer<typeof tableRecord>
  | z.infer<typeof rowRecord>
  | z.infer<typeof endRecord>
  | z.infer<typeof sequenceRecord>
  | z.infer<typeof footerSchema>;

export interface BackupSummary {
  format: typeof FORMAT;
  version: 1;
  createdAt: string;
  tables: number;
  rows: number;
  sha256: string;
  storageObjectsIncluded: false;
  encryptedSecretsIncluded: true;
  schemaObjects: number;
  tableRows: Record<string, number>;
}

export function assertPrivateBackupPath(path: string): void {
  const absolute = resolve(path);
  requireCondition(
    ![resolve('client/public'), resolve('dist/client')].some(
      (root) => absolute === root || absolute.startsWith(root + sep),
    ),
    400,
    'backup_public_path',
    'Private backups and recovery databases must stay outside the website asset directories.',
  );
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
function fail(message: string): never {
  throw new ApiError(409, 'backup_invalid', message);
}

function validateSchemaObject(object: SchemaObject): void {
  if (object.name.startsWith('sqlite_'))
    fail('Backup contains an unsupported internal schema object.');
  const prefixes = {
    table: /^CREATE\s+TABLE\s/i,
    index: /^CREATE\s+(?:UNIQUE\s+)?INDEX\s/i,
    trigger: /^CREATE\s+TRIGGER\s/i,
    view: /^CREATE\s+VIEW\s/i,
  };
  if (!prefixes[object.type].test(object.sql))
    fail('Backup contains an unsupported schema declaration.');
}

async function integrity(db: Pick<Client, 'execute'>): Promise<void> {
  const result = await db.execute('PRAGMA integrity_check');
  requireCondition(
    result.rows.length === 1 && result.rows[0]![0] === 'ok',
    409,
    'backup_integrity_failed',
    'Database integrity validation failed. The restore was not committed.',
  );
  const foreign = await db.execute('PRAGMA foreign_key_check');
  requireCondition(
    foreign.rows.length === 0,
    409,
    'backup_foreign_key_failed',
    'Database relationships are inconsistent. The restore was not committed.',
  );
}

/** Streams one consistent read transaction; never copies a live SQLite/WAL file. */
export async function exportDatabaseBackup(
  db: Client,
  destination: string,
  now = new Date(),
): Promise<BackupSummary> {
  const output = resolve(destination);
  assertPrivateBackupPath(output);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const file = await open(output, 'wx', 0o600);
  let tx: Transaction | undefined,
    completed = false;
  const hash = createHash('sha256'),
    tableRows: Record<string, number> = Object.create(null);
  let rowCount = 0;
  async function write(record: BackupRecord, hashed = true) {
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    requireCondition(
      bytes.length <= MAX_LINE_BYTES,
      413,
      'backup_row_too_large',
      'A database row is too large for this backup format. Store large file bytes in private object storage.',
    );
    if (hashed) hash.update(bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.write(bytes, offset, bytes.length - offset, null);
      if (!result.bytesWritten) throw new Error('Backup file write did not progress.');
      offset += result.bytesWritten;
    }
  }
  try {
    tx = await db.transaction('read');
    // The first schema read establishes the snapshot for all subsequent pages.
    const schema = await tx.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name",
    );
    const objects = schema.rows.map((row) =>
      objectSchema.parse({ type: row.type, name: row.name, table: row.tbl_name, sql: row.sql }),
    );
    objects.forEach(validateSchemaObject);
    requireCondition(
      objects.length > 0,
      409,
      'backup_empty_source',
      'The source database has no application schema. Check the database path; no empty backup was saved.',
    );
    const tables = objects.filter((object) => object.type === 'table');
    const tableList = await tx.execute('PRAGMA table_list');
    const userVersion = Number((await tx.execute('PRAGMA user_version')).rows[0]![0]);
    const applicationId = Number((await tx.execute('PRAGMA application_id')).rows[0]![0]);
    await write({
      kind: 'header',
      format: FORMAT,
      version: 1,
      createdAt: now.toISOString(),
      storageObjectsIncluded: false,
      encryptedSecretsIncluded: true,
    });
    await write({ kind: 'schema', objects, userVersion, applicationId });
    for (const table of tables) {
      const info = await tx.execute(`PRAGMA table_xinfo(${quote(table.name)})`);
      const columns = info.rows
        .filter((row) => Number(row.hidden) === 0)
        .map((row) => String(row.name));
      const withoutRowid =
        Number(
          tableList.rows.find((row) => row.name === table.name && row.schema === 'main')?.wr,
        ) === 1;
      const rowidAlias = withoutRowid
        ? null
        : (['rowid', '_rowid_', 'oid'] as const).find(
            (alias) => !info.rows.some((row) => String(row.name).toLowerCase() === alias),
          ) || null;
      if (rowidAlias) columns.unshift(rowidAlias);
      requireCondition(
        columns.length > 0,
        409,
        'backup_unsupported_table',
        'This database has an unsupported table with no writable columns.',
      );
      await write({ kind: 'table', name: table.name, columns, rowidAlias });
      // SQL converts integer values to text before the client can round a 64-bit integer.
      const selection = columns
        .map(
          (column, i) =>
            `typeof(${quote(column)}) AS ${quote(`t${i}`)}, CASE typeof(${quote(column)}) WHEN 'integer' THEN CAST(${quote(column)} AS TEXT) WHEN 'blob' THEN hex(${quote(column)}) ELSE ${quote(column)} END AS ${quote(`v${i}`)}`,
        )
        .join(',');
      let offset = 0;
      while (true) {
        const page = await tx.execute({
          sql: `SELECT ${selection} FROM ${quote(table.name)}${rowidAlias ? ` ORDER BY ${quote(rowidAlias)}` : ''} LIMIT ? OFFSET ?`,
          args: [PAGE_ROWS, offset],
        });
        if (!page.rows.length) break;
        for (const row of page.rows) {
          const values: EncodedValue[] = columns.map((_column, i) => {
            const type = row[`t${i}`],
              value = row[`v${i}`];
            if (type === 'null') return ['null'];
            if (type === 'integer') return ['integer', String(value)];
            if (type === 'real') {
              if (!Number.isFinite(Number(value)))
                fail('Non-finite SQL real values cannot be represented by this backup.');
              return ['real', Number(value)];
            }
            if (type === 'text') return ['text', String(value)];
            if (type === 'blob')
              return ['blob', Buffer.from(String(value), 'hex').toString('base64')];
            return fail('A database value has an unsupported storage type.');
          });
          await write({ kind: 'row', values });
          offset++;
          rowCount++;
        }
      }
      tableRows[table.name] = offset;
      await write({ kind: 'endTable', name: table.name, rows: offset });
    }
    const sequence = await tx.execute(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'",
    );
    const sequences: [string, string][] = sequence.rows.length
      ? (
          await tx.execute(
            'SELECT name,CAST(seq AS TEXT) AS seq FROM sqlite_sequence ORDER BY name',
          )
        ).rows.map((row) => [String(row.name), String(row.seq)])
      : [];
    await write({ kind: 'sequence', values: sequences });
    await tx.commit();
    const checksum = hash.digest('hex');
    await write({ kind: 'footer', sha256: checksum, tables: tables.length, rows: rowCount }, false);
    await file.sync();
    completed = true;
    return {
      format: FORMAT,
      version: 1,
      createdAt: now.toISOString(),
      tables: tables.length,
      rows: rowCount,
      sha256: checksum,
      storageObjectsIncluded: false,
      encryptedSecretsIncluded: true,
      schemaObjects: objects.length,
      tableRows,
    };
  } finally {
    tx?.close();
    await file.close();
    if (!completed) await rm(output, { force: true });
  }
}

async function* backupLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  const decoder = new StringDecoder('utf8');
  let pending = '';
  try {
    for await (const chunk of stream) {
      pending += decoder.write(chunk as Buffer);
      let index: number;
      while ((index = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, index + 1);
        pending = pending.slice(index + 1);
        if (Buffer.byteLength(line) > MAX_LINE_BYTES)
          fail('Backup record exceeds the supported line limit.');
        yield line;
      }
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES)
        fail('Backup record exceeds the supported line limit.');
    }
    pending += decoder.end();
    if (pending) fail('Backup is incomplete: its final newline is missing.');
  } finally {
    stream.destroy();
  }
}

/** Validates the checksum and record grammar before restore opens a target transaction. */
async function readBackup(
  path: string,
  visit?: (record: BackupRecord) => Promise<void>,
): Promise<BackupSummary> {
  const file = await stat(path);
  requireCondition(file.isFile(), 400, 'backup_file_required', 'Choose a SQL backup file.');
  const hash = createHash('sha256'),
    tableRows: Record<string, number> = Object.create(null);
  let header: z.infer<typeof headerSchema> | undefined,
    schema: z.infer<typeof schemaRecord> | undefined,
    current: z.infer<typeof tableRecord> | undefined;
  let currentRows = 0,
    totalRows = 0,
    tableIndex = 0,
    sequenceSeen = false,
    footer: z.infer<typeof footerSchema> | undefined;
  let tables: SchemaObject[] = [];
  for await (const line of backupLines(path)) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return fail('Backup contains invalid JSON or truncated data.');
    }
    if (!raw || typeof raw !== 'object' || !('kind' in raw)) fail('Backup record is invalid.');
    if (footer) fail('Backup has unexpected data after its integrity footer.');
    let record: BackupRecord;
    try {
      switch (raw.kind) {
        case 'header':
          if (header) fail('Backup has a duplicate header.');
          header = headerSchema.parse(raw);
          record = header;
          break;
        case 'schema': {
          if (!header || schema) fail('Backup schema is out of order.');
          schema = schemaRecord.parse(raw);
          schema.objects.forEach(validateSchemaObject);
          const seen = new Set<string>();
          for (const object of schema.objects) {
            if (seen.has(object.name.toLowerCase()))
              fail('Backup contains duplicate schema names.');
            seen.add(object.name.toLowerCase());
          }
          tables = schema.objects.filter((object) => object.type === 'table');
          record = schema;
          break;
        }
        case 'table': {
          if (!schema || current || sequenceSeen) fail('Backup table is out of order.');
          current = tableRecord.parse(raw);
          if (tables[tableIndex]?.name !== current.name)
            fail('Backup tables do not match the schema.');
          if (
            new Set(current.columns.map((name) => name.toLowerCase())).size !==
              current.columns.length ||
            (current.rowidAlias && current.columns[0] !== current.rowidAlias)
          )
            fail('Backup table columns are invalid.');
          currentRows = 0;
          record = current;
          break;
        }
        case 'row':
          if (!current) fail('Backup row has no table.');
          record = rowRecord.parse(raw);
          if (record.values.length !== current.columns.length)
            fail('Backup row does not match its table columns.');
          currentRows++;
          totalRows++;
          break;
        case 'endTable':
          if (!current) fail('Backup table ending has no table.');
          record = endRecord.parse(raw);
          if (record.name !== current.name || record.rows !== currentRows)
            fail('Backup table row count does not match.');
          tableRows[current.name] = currentRows;
          current = undefined;
          tableIndex++;
          break;
        case 'sequence':
          if (!schema || current || sequenceSeen || tableIndex !== tables.length)
            fail('Backup sequence is out of order.');
          record = sequenceRecord.parse(raw);
          if (
            new Set(record.values.map((value) => value[0])).size !== record.values.length ||
            record.values.some((value) => !tables.some((table) => table.name === value[0]))
          )
            fail('Backup sequence refers to an unknown or duplicate table.');
          sequenceSeen = true;
          break;
        case 'footer':
          if (!header || !schema || current || !sequenceSeen) fail('Backup is incomplete.');
          footer = footerSchema.parse(raw);
          if (
            footer.tables !== tables.length ||
            footer.rows !== totalRows ||
            footer.sha256 !== hash.digest('hex')
          )
            fail('Backup checksum or total count does not match. Nothing was restored.');
          record = footer;
          break;
        default:
          return fail('Backup contains an unknown record type.');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return fail(
        `Backup ${String(raw.kind)} record does not match the supported format${error instanceof z.ZodError ? ` (${error.issues[0]?.path.join('.') || 'record'}: ${error.issues[0]?.code})` : ''}.`,
      );
    }
    if (record.kind !== 'footer') hash.update(Buffer.from(line));
    if (visit) await visit(record);
  }
  if (!header || !schema || !footer) fail('Backup is incomplete or empty.');
  return {
    format: FORMAT,
    version: 1,
    createdAt: header.createdAt,
    tables: footer.tables,
    rows: footer.rows,
    sha256: footer.sha256,
    storageObjectsIncluded: false,
    encryptedSecretsIncluded: true,
    schemaObjects: schema.objects.length,
    tableRows,
  };
}

export function inspectDatabaseBackup(path: string): Promise<BackupSummary> {
  return readBackup(resolve(path));
}

function decode(value: EncodedValue): { sql: string; value: InValue } {
  if (value[0] === 'null') return { sql: '?', value: null };
  if (value[0] === 'integer') return { sql: 'CAST(? AS INTEGER)', value: value[1] };
  if (value[0] === 'real') return { sql: 'CAST(? AS REAL)', value: value[1] };
  if (value[0] === 'text') return { sql: 'CAST(? AS TEXT)', value: value[1] };
  return { sql: 'CAST(? AS BLOB)', value: Buffer.from(value[1], 'base64') };
}

/** Target must be empty. No overwrite, clear, merge, migration or live environment switch exists here. */
export async function restoreDatabaseBackup(
  target: Client,
  source: string,
): Promise<BackupSummary & { restored: true }> {
  const path = resolve(source),
    reviewed = await inspectDatabaseBackup(path);
  const tx = await target.transaction('write');
  let schema: z.infer<typeof schemaRecord> | undefined,
    table: z.infer<typeof tableRecord> | undefined;
  try {
    const existing = await tx.execute(
      "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1",
    );
    requireCondition(
      existing.rows.length === 0,
      409,
      'backup_target_not_empty',
      'Restore target already contains a schema. Use a new empty database; nothing was overwritten.',
    );
    await tx.execute('PRAGMA defer_foreign_keys=ON');
    const actual = await readBackup(path, async (record) => {
      if (record.kind === 'schema') {
        schema = record;
        for (const object of record.objects.filter((object) => object.type === 'table'))
          await tx.execute(object.sql);
      } else if (record.kind === 'table') {
        table = record;
        const columns = (await tx.execute(`PRAGMA table_xinfo(${quote(table.name)})`)).rows
          .filter((row) => Number(row.hidden) === 0)
          .map((row) => String(row.name));
        const expected = record.rowidAlias ? [record.rowidAlias, ...columns] : columns;
        if (JSON.stringify(expected) !== JSON.stringify(record.columns))
          fail('Backup column metadata does not match its CREATE TABLE schema.');
      } else if (record.kind === 'row') {
        if (!table) fail('Backup row has no restore table.');
        const values = record.values.map(decode);
        await tx.execute({
          sql: `INSERT INTO ${quote(table.name)}(${table.columns.map(quote).join(',')}) VALUES (${values.map((value) => value.sql).join(',')})`,
          args: values.map((value) => value.value),
        });
      } else if (record.kind === 'endTable') {
        const count = await tx.execute(`SELECT COUNT(*) AS n FROM ${quote(record.name)}`);
        if (Number(count.rows[0]!.n) !== record.rows)
          fail('Restored table row count is incorrect.');
        table = undefined;
      } else if (record.kind === 'sequence') {
        const exists = await tx.execute(
          "SELECT name FROM sqlite_schema WHERE name='sqlite_sequence'",
        );
        if (record.values.length && !exists.rows.length)
          fail('Backup sequence has no AUTOINCREMENT table.');
        if (exists.rows.length) {
          await tx.execute('DELETE FROM sqlite_sequence');
          for (const [name, sequence] of record.values)
            await tx.execute({
              sql: 'INSERT INTO sqlite_sequence(name,seq) VALUES (?,CAST(? AS INTEGER))',
              args: [name, sequence],
            });
        }
      }
    });
    if (actual.sha256 !== reviewed.sha256 || !schema)
      fail('The backup changed during restore. Nothing was committed.');
    for (const object of schema.objects.filter((object) => object.type !== 'table'))
      await tx.execute(object.sql);
    await tx.execute(`PRAGMA user_version=${schema.userVersion}`);
    await tx.execute(`PRAGMA application_id=${schema.applicationId}`);
    await integrity(tx);
    await tx.commit();
    return { ...actual, restored: true };
  } finally {
    tx.close();
  }
}
