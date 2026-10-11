import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const directory = fileURLToPath(new URL('../dist/client/', import.meta.url));
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const location = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(location)));
    else if (entry.isFile() && entry.name !== 'sw.js') result.push(location);
  }
  return result;
}
const hash = createHash('sha256');
for (const path of await files(directory)) {
  hash.update(relative(directory, path).replaceAll('\\', '/'));
  hash.update('\0');
  hash.update(await readFile(path));
}
const version = hash.digest('hex').slice(0, 16);
const source = await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8');
if (!source.includes('__XVIA_BUILD__'))
  throw new Error('The service worker build marker is missing.');
await writeFile(join(directory, 'sw.js'), source.replaceAll('__XVIA_BUILD__', version));
console.log(`XVIA web build ${version}: service-worker update marker prepared.`);
