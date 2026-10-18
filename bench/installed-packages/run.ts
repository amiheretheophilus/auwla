import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, release, totalmem } from 'node:os';
import { benchmarkOptions, summary, verifyCache, type CacheEntry } from './options';

const root = resolve(import.meta.dirname, '../..'), options = benchmarkOptions(process.argv.slice(2));
if (options.help) {
  console.log('bun run bench:installed-packages [--smoke] [--samples 7] [--output report.json]');
  process.exit(0);
}
if (!existsSync(join(root, 'packages/vite/dist/index.js'))) throw new Error('Run bun install and bun run build first');
const run = promisify(execFile);
const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); } catch { return 'unavailable'; } };
const generated = join(import.meta.dirname, '.generated');
await mkdir(generated, { recursive: true });
if (resolve(await realpath(generated)) !== generated) throw new Error('Benchmark directory must not be a symlink');
const stage = await mkdtemp(join(generated, 'run-'));
const location = relative(generated, stage);
if (!location || location.startsWith('..') || isAbsolute(location)) throw new Error('Unsafe benchmark staging target');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const upstream = {
  'dset/dist/index.mjs': await readFile(join(root, 'tests/fixtures/third-party/dset/dist/index.mjs'), 'utf8'),
  'dset/merge/index.mjs': await readFile(join(root, 'tests/fixtures/third-party/dset/merge/index.mjs'), 'utf8'),
  'throttle-debounce/esm/index.js': await readFile(join(root, 'tests/fixtures/third-party/throttle-debounce/esm/index.js'), 'utf8'),
};
type Mode = 'opaque' | 'compiled';
const phases = ['cold', 'warm', 'edited'] as const;
type Phase = typeof phases[number];
type BuildResult = { buildMs: number; node: string; cache: CacheEntry[];
  output: { path: string; bytes: number; gzipBytes: number; sha256: string }[] };
const measurements: { sample: number; mode: Mode; phase: Phase; processMs: number; result: BuildResult }[] = [];
const write = async (folder: string, file: string, text: string) => {
  const path = join(folder, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text);
};
const app = `import {dset} from 'dset';import {dset as merge} from 'dset/merge';import {debounce} from 'throttle-debounce';
export function App(){const state={count:0,name:'before'};
 const later=debounce(25,async()=>{await Promise.resolve();state.count+=2});$cleanup(()=>later.cancel());
 return <main><output>{state.name}:{state.count}</output><input placeholder="Draft"/>
 <button onClick={()=>dset(state,'name','after')}>Set</button><button onClick={()=>merge(state,'name','merged')}>Merge</button>
 <button onClick={()=>later()}>Later</button></main>}`;
try {
  console.log(options.smoke ? 'SMOKE CHECK — not performance evidence.' : `${options.samples} samples; alternating opaque/compiled order; fresh Node per build.`);
  for (let sample = 0; sample < options.samples; sample++) {
    const order: Mode[] = sample % 2 ? ['compiled', 'opaque'] : ['opaque', 'compiled'];
    for (const mode of order) {
      const folder = join(stage, `${sample}-${mode}`);
      for (const [file, text] of Object.entries(upstream)) await write(folder, 'node_modules/' + file, text);
      await write(folder, 'node_modules/dset/package.json', JSON.stringify({ name: 'dset', version: '3.1.4', exports: { '.': './dist/index.mjs', './merge': './merge/index.mjs' } }));
      await write(folder, 'node_modules/throttle-debounce/package.json', JSON.stringify({ name: 'throttle-debounce', version: '5.0.2', exports: { '.': { import: './esm/index.js' } } }));
      await write(folder, 'node_modules/throttle-debounce/esm/package.json', '{"type":"module"}');
      await write(folder, 'package.json', '{"type":"module"}');
      await write(folder, 'index.html', '<!doctype html><div id="root"></div><script type="module" src="/main.ts"></script>');
      await write(folder, 'main.ts', `import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`);
      await write(folder, 'App.tsx', app);
      const cache: Partial<Record<Phase, CacheEntry[]>> = {};
      for (const phase of phases) {
        // A no-op source edit isolates invalidation/recompile cost without changing
        // application semantics or biasing the resulting minified bundle size.
        if (phase === 'edited') await write(folder, 'node_modules/dset/dist/index.mjs', upstream['dset/dist/index.mjs'] + '\n// benchmark source invalidation\n');
        const start = performance.now();
        const child = await run('node', [join(import.meta.dirname, 'build.mjs'), folder, mode], {
          cwd: root, windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
        });
        const processMs = performance.now() - start;
        const line = child.stdout.split(/\r?\n/).find(line => line.startsWith('MMD_INSTALLED_BENCH:'));
        if (!line) throw new Error(`No benchmark result: ${child.stdout}\n${child.stderr}`);
        const result = JSON.parse(line.slice('MMD_INSTALLED_BENCH:'.length)) as BuildResult;
        if (!Number.isFinite(result.buildMs) || !result.output.some(file => file.path.endsWith('.js') && file.bytes > 0)) throw new Error('Invalid/empty build result');
        cache[phase] = result.cache;
        measurements.push({ sample, mode, phase, processMs, result });
        console.log(`${sample + 1}/${options.samples} ${mode.padEnd(8)} ${phase.padEnd(6)} build=${result.buildMs.toFixed(1)}ms process=${processMs.toFixed(1)}ms cache=${result.cache.length}`);
      }
      verifyCache(mode, cache.cold!, cache.warm!, cache.edited!);
    }
  }
  const totals = (result: BuildResult) => result.output.filter(file => file.path.endsWith('.js')).reduce((total, file) => ({
    bytes: total.bytes + file.bytes, gzipBytes: total.gzipBytes + file.gzipBytes,
  }), { bytes: 0, gzipBytes: 0 });
  const groups = (['opaque', 'compiled'] as const).flatMap(mode => phases.map(phase => {
    const rows = measurements.filter(row => row.mode === mode && row.phase === phase);
    return { mode, phase, buildMs: summary(rows.map(row => row.result.buildMs)), processMs: summary(rows.map(row => row.processMs)),
      jsBytes: summary(rows.map(row => totals(row.result).bytes)), jsGzipBytes: summary(rows.map(row => totals(row.result).gzipBytes)) };
  }));
  const report = { schemaVersion: 1, benchmark: 'installed-packages-vite-build', timestamp: new Date().toISOString(),
    smoke: options.smoke, options, git: { revision: git(['rev-parse', 'HEAD']), status: git(['status', '--short']) },
    environment: { bun: Bun.version, node: measurements[0]!.result.node, platform: process.platform, arch: process.arch,
      osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem(),
      vite: JSON.parse(await readFile(join(root, 'node_modules/vite/package.json'), 'utf8')).version },
    fixture: { packages: { dset: '3.1.4', 'throttle-debounce': '5.0.2' }, appSha256: hash(app),
      sourceSha256: Object.fromEntries(Object.entries(upstream).map(([file, text]) => [file, hash(text)])) },
    methodology: { freshProcessPerBuild: true, cold: 'empty generated package cache; OS disk cache is NOT flushed',
      warm: 'same project, new Node/Vite/plugin; verified identical cache keys, hashes and modification times',
      edited: 'no-op comment in dset source; new Node build; exactly one additional immutable cache entry',
      timing: 'buildMs times Vite build only; processMs includes Node startup, imports, build and output/cache audit',
      scope: 'client production builds only; not runtime, dev HMR latency, SSR or universal npm compatibility' },
    groups, measurements };
  console.table(groups.map(group => ({ mode: group.mode, phase: group.phase, buildMs: group.buildMs.median.toFixed(1),
    processMs: group.processMs.median.toFixed(1), jsBytes: group.jsBytes.median, jsGzipBytes: group.jsGzipBytes.median })));
  const destination = resolve(options.output ?? join(import.meta.dirname, 'results', `installed-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`));
  if (existsSync(destination)) throw new Error(`Refusing to overwrite an existing report: ${destination}`);
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Report: ${destination}`);
} finally { await rm(stage, { recursive: true, force: true }); }
