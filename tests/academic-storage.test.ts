import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import test, { type TestContext } from 'node:test';
import {
  attachmentDisposition,
  createPrivateStorage,
  loadStorageConfig,
  MAX_RESOURCE_BYTES,
  validateResourceFile,
} from '../server/storage.js';
import { DEMO_CLASS_ID } from '../server/demo.js';
import { bearer, createTestApp, demoToken, expectSuccess } from './helpers.js';

async function directory(t: TestContext) {
  const path = await mkdtemp(join(process.cwd(), 'tests', '.storage-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

/** A tiny standards-shaped ZIP fixture; no archive-writing production code is reused. */
function packageFixture(items: Record<string, string>): Buffer {
  const localParts: Buffer[] = [],
    centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(items)) {
    const filename = Buffer.from(name),
      contents = Buffer.from(text),
      checksum = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, contents);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + contents.length;
  }
  const central = Buffer.concat(centralParts),
    end = Buffer.alloc(22),
    count = Object.keys(items).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

const contentTypes =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>';
const presentation =
  '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>';

test('valid PPTX metadata is accepted while arbitrary, macro, executable and traversal archives are rejected', async (t) => {
  const root = await directory(t),
    path = join(root, 'upload.pptx');
  const valid = packageFixture({
    '[Content_Types].xml': contentTypes,
    'ppt/presentation.xml': presentation,
  });
  await writeFile(path, valid);
  const type = await validateResourceFile({ path, filename: 'sample.PPTX', size: valid.length });
  assert.equal(type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  for (const extra of [
    { '[Content_Types].xml': 'These are fake metadata names.', 'ppt/presentation.xml': '' },
    {
      '[Content_Types].xml': contentTypes.replace('presentation.main+xml', 'macroEnabled.main+xml'),
      'ppt/presentation.xml': presentation,
    },
    {
      '[Content_Types].xml': contentTypes,
      'ppt/presentation.xml': presentation,
      'ppt/vbaProject.bin': 'macro',
    },
    {
      '[Content_Types].xml': contentTypes,
      'ppt/presentation.xml': presentation,
      'run.exe': 'binary',
    },
    {
      '[Content_Types].xml': contentTypes,
      'ppt/presentation.xml': presentation,
      '../escape': 'escape',
    },
    {
      '[Content_Types].xml': contentTypes,
      'ppt/presentation.xml':
        '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + presentation,
    },
  ]) {
    const bytes = packageFixture(extra);
    await writeFile(path, bytes);
    await assert.rejects(
      validateResourceFile({ path, filename: 'unsafe.pptx', size: bytes.length }),
      /PowerPoint|Unsupported/,
    );
  }
});

test('local storage keeps opaque keys inside private directories and rejects traversal and public roots', async (t) => {
  const root = await directory(t),
    source = join(root, 'input.pdf');
  const bytes = Buffer.from('%PDF-1.4\n%%EOF');
  await writeFile(source, bytes);
  const storage = createPrivateStorage({ driver: 'local', localDirectory: join(root, 'private') });
  const key = `resources/${randomUUID()}.pdf`;
  await storage.putFile(key, source, 'application/pdf');
  const object = await storage.open(key),
    chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), bytes);
  await assert.rejects(storage.open('../input.pdf'), /Invalid private storage key/);
  await assert.rejects(
    storage.putFile('resources/../../public/a.pdf', source, 'application/pdf'),
    /Invalid private storage key/,
  );
  assert.throws(
    () => createPrivateStorage({ driver: 'local', localDirectory: 'client/public/uploads' }),
    /outside the web asset/,
  );
  await storage.delete(key);
  await storage.delete(key);
  await assert.rejects(storage.open(key), /temporarily unavailable/);
  assert.deepEqual(await readFile(source), bytes);
});

test('download filenames cannot inject headers and R2 configuration fails closed', () => {
  const header = attachmentDisposition('notes\r\nContent-Type:text/html;".pdf');
  assert.ok(!header.includes('\r') && !header.includes('\n'));
  assert.match(header, /^attachment; filename=/);
  assert.match(header, /filename\*=UTF-8''/);
  assert.throws(() => loadStorageConfig({ STORAGE_DRIVER: 'unknown' }), /STORAGE_DRIVER/);
  assert.throws(() => loadStorageConfig({ STORAGE_DRIVER: 'r2' }), /R2 storage requires/);
  const result = loadStorageConfig({
    STORAGE_DRIVER: 'r2',
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_BUCKET: 'private-course-files',
    R2_ACCESS_KEY_ID: 'placeholder',
    R2_SECRET_ACCESS_KEY: 'placeholder',
  });
  assert.equal(result.driver, 'r2');
  assert.equal(result.r2?.bucket, 'private-course-files');
});

test('multipart file size limit rejects one byte over 25MiB without publishing a resource', async (t) => {
  const app = await createTestApp(t),
    token = await demoToken(app, 'admin');
  const boundary = `upload-${randomUUID()}`;
  const oversized = Buffer.alloc(MAX_RESOURCE_BYTES + 1, 0x20);
  oversized.write('%PDF-1.4');
  oversized.write('%%EOF', oversized.length - 5);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nOversized lecture\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="too-big.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    oversized,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: 'POST',
    url: `/api/classes/${DEMO_CLASS_ID}/resources`,
    headers: { ...bearer(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  assert.equal(response.statusCode, 413, response.body);
  const list = await app.inject({ method: 'GET', url: '/api/resources', headers: bearer(token) });
  expectSuccess(list);
  assert.equal(list.json().pagination.total, 0);
});
