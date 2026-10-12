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
const allFiles = await files(directory);
for (const path of allFiles) {
  hash.update(relative(directory, path).replaceAll('\\', '/'));
  hash.update('\0');
  hash.update(await readFile(path));
}
const version = hash.digest('hex').slice(0, 16);
const source = await readFile(new URL('../client/public/sw.js', import.meta.url), 'utf8');
if (!source.includes('__ZABSYNC_BUILD__') || !source.includes('/* __ZABSYNC_PUBLIC_ASSETS__ */'))
  throw new Error('The service worker build marker is missing.');
const approved = allFiles.map((path) => `/${relative(directory, path).replaceAll('\\', '/')}`)
  .filter((path) => ['/index.html', '/offline.html', '/manifest.webmanifest'].includes(path) ||
    /^\/(icons|branding)\/[A-Za-z0-9_./-]+\.(png|svg|webp|jpg|jpeg|ico)$/.test(path) ||
    /^\/assets\/[A-Za-z0-9_./-]+\.(js|css|woff2?|ttf|png|svg|webp|jpg|jpeg|ico)$/.test(path));
if (!approved.includes('/index.html') || !approved.some((path) => /^\/assets\/.+\.js$/.test(path)))
  throw new Error('Cannot prepare offline reopening without the built app shell and JavaScript.');
const output = source.replaceAll('__ZABSYNC_BUILD__', version)
  .replace(/\/\* __ZABSYNC_PUBLIC_ASSETS__ \*\/ \[[^;]*\]/, JSON.stringify(approved));
if (output.includes('__ZABSYNC_')) throw new Error('An offline build marker was not replaced.');
await writeFile(join(directory, 'sw.js'), output);
console.log(`ZabSync web build ${version}: ${approved.length} public offline assets prepared.`);
