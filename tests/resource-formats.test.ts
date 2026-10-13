import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import test from 'node:test';
import { loadResourceLimits, validateResourceFile } from '../server/storage.js';

function zip(entries: Record<string, string>) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const [path, value] of Object.entries(entries)) {
    const name = Buffer.from(path),
      data = Buffer.from(value),
      header = Buffer.alloc(30),
      central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22),
    central = Buffer.concat(directory),
    count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
function box(type: string, content: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(content.length + 8);
  head.write(type, 4, 4, 'ascii');
  return Buffer.concat([head, content]);
}

test('Word templates preserve DOCX binaries and reject macros, embedded executables and fake packages', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), 'tests', '.formats-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'input'),
    entries = {
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      'word/document.xml':
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
    };
  const valid = zip(entries);
  await writeFile(path, valid);
  assert.equal(
    await validateResourceFile({ path, filename: 'assignment.DOCX', size: valid.length }),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  for (const forbidden of [
    { 'word/vbaProject.bin': 'macro' },
    { 'word/embeddings/file.doc': 'embedded executable content' },
    { 'payload.js': 'alert(1)' },
    {
      '[Content_Types].xml': entries['[Content_Types].xml'].replace(
        'document.main+xml',
        'document.macroEnabled.main+xml',
      ),
    },
  ]) {
    const data = zip({ ...entries, ...forbidden });
    await writeFile(path, data);
    await assert.rejects(
      validateResourceFile({ path, filename: 'unsafe.docx', size: data.length }),
      /unsupported or unsafe/,
    );
  }
  const legacy = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(legacy);
  await writeFile(path, legacy);
  assert.equal(
    await validateResourceFile({ path, filename: 'old.doc', size: legacy.length }),
    'application/msword',
  );
  await assert.rejects(
    validateResourceFile({ path, filename: 'script.docm', size: legacy.length }),
    /Upload a PDF/,
  );
});

test('MP4 and WebM have bounded structural validation and separate configurable video ceilings', async (t) => {
  const dir = await mkdtemp(join(process.cwd(), 'tests', '.formats-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'input');
  const mp4 = Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0isommp42')),
    box('moov', Buffer.from('metadata')),
    box('mdat', Buffer.from('video-data')),
  ]);
  await writeFile(path, mp4);
  assert.equal(
    await validateResourceFile({ path, filename: 'lecture.mp4', size: mp4.length }),
    'video/mp4',
  );
  const wrongSize = Buffer.from(mp4);
  wrongSize.writeUInt32BE(mp4.length + 10, 0);
  await writeFile(path, wrongSize);
  await assert.rejects(
    validateResourceFile({ path, filename: 'broken.mp4', size: wrongSize.length }),
    /complete MP4/,
  );
  const webm = Buffer.concat([
    Buffer.from('1a45dfa3874282847765626d18538067', 'hex'),
    Buffer.from([0xff]),
    Buffer.from('cluster'),
  ]);
  await writeFile(path, webm);
  assert.equal(
    await validateResourceFile({ path, filename: 'lecture.webm', size: webm.length }),
    'video/webm',
  );
  const fake = Buffer.from(webm);
  fake.write('fake', 8, 4, 'ascii');
  await writeFile(path, fake);
  await assert.rejects(
    validateResourceFile({ path, filename: 'fake.webm', size: fake.length }),
    /WebM/,
  );
  const limits = loadResourceLimits({
    RESOURCE_MAX_DOCUMENT_MIB: '10',
    RESOURCE_MAX_VIDEO_MIB: '200',
    CLASS_STORAGE_MIB: '1000',
  });
  assert.equal(limits.fileBytes, 200 * 1024 ** 2);
  assert.equal(limits.classBytes, 1000 * 1024 ** 2);
  await assert.rejects(
    validateResourceFile({ path, filename: 'too-large.pdf', size: 11 * 1024 ** 2 }, limits),
    /configured document or video/,
  );
  assert.throws(() => loadResourceLimits({ RESOURCE_MAX_VIDEO_MIB: '5000' }), /whole MiB/);
  assert.throws(() => loadResourceLimits({ CLASS_STORAGE_MIB: '0' }), /whole MiB/);
});
