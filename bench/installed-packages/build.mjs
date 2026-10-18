// A fresh Node process per build prevents in-process plugin/compiler caches from
// being mistaken for persistent cache reuse. Keep this on the published plugin.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { memoizedDom } from '../../packages/vite/dist/index.js';

const [directory, mode] = process.argv.slice(2);
if (!directory || !['opaque', 'compiled'].includes(mode)) throw new Error('Expected fixture directory and opaque|compiled mode');
const root = resolve(directory);
const start = performance.now();
await build({ root, configFile: false, logLevel: 'silent', cacheDir: join(root, 'node_modules/.vite'),
  plugins: [memoizedDom({ clientEntry: './main.ts', ...(mode === 'compiled' ? { compilePackages: ['dset', 'throttle-debounce'] } : {}) })],
  build: { minify: true, reportCompressedSize: false, sourcemap: false },
});
const buildMs = performance.now() - start;
async function files(directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected non-regular benchmark output: ${path}`);
  }
  return result;
}
const output = [];
for (const file of await files(join(root, 'dist'))) {
  const bytes = await readFile(file);
  output.push({ path: relative(join(root, 'dist'), file).replaceAll('\\', '/'), bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const cache = [];
const cacheRoot = join(root, 'node_modules/.vite/memoized-dom-packages');
let keys;
try { keys = await readdir(cacheRoot); } catch (error) { if (error.code !== 'ENOENT') throw error; keys = []; }
for (const key of keys.sort()) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error(`Unpublished/staging cache output left behind: ${key}`);
  const directory = join(cacheRoot, key), entries = [];
  for (const file of await files(directory)) {
    const bytes = await readFile(file);
    entries.push({ path: relative(directory, file).replaceAll('\\', '/'), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), mtimeMs: (await stat(file)).mtimeMs });
  }
  cache.push({ name: JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name, key, files: entries });
}
console.log('MMD_INSTALLED_BENCH:' + JSON.stringify({ buildMs, output, cache, node: process.version }));
