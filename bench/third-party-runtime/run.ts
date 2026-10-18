import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, release, totalmem } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import puppeteer, { type Page } from 'puppeteer-core';
import { compileModulesDetailed, experimentalCompilePackage, experimentalFinalizePackage } from '@memoized-dom/compiler';
import { closeBrowser } from '../../test-support/browser';
import { fixture } from './fixtures';
import { benchmarkOptions, summary } from './options';
import { phases, scenarios, type CaseConfig, type Diagnostics, type Phase } from './types';

const root = resolve(import.meta.dirname, '../..');
const options = benchmarkOptions(process.argv.slice(2));
if (options.help) {
  console.log('bun run bench:third-party-runtime [--smoke] [--samples 7] [--sizes 1,32,128] [--operations 100] [--frames 120] [--warmups 2] [--chrome path] [--output report.json]');
  process.exit(0);
}
const candidates = [options.chrome, process.env.MMD_CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const chrome = candidates.find((path): path is string => !!path && existsSync(path));
if (!chrome) throw new Error('Chrome/Chromium not found. Set MMD_CHROME_PATH or pass --chrome with an absolute executable path. Run bun install and bun run build first.');
if (options.chrome && resolve(chrome) !== resolve(options.chrome)) throw new Error(`Requested browser does not exist: ${options.chrome}`);

const upstream = join(root, 'tests/fixtures/third-party/dset');
const expected = {
  'dist/index.mjs': '415e1a1b26fc2db57bd76d12d72ac5b9f76497201afe14c01bfa7f2789bff1da',
  'merge/index.mjs': '43ab54b68ebf3b7964688b2b9100b9ea9a25a9dc68d5272d97926ab4dea6278b',
};
const source: Record<string, string> = {};
for (const [file, hash] of Object.entries(expected)) {
  const text = await readFile(join(upstream, file), 'utf8');
  if (createHash('sha256').update(text).digest('hex') !== hash) throw new Error(`Upstream dset fixture changed: ${file}`);
  source['./' + file] = text;
}
const generated = join(import.meta.dirname, '.generated');
const packageStart = performance.now();
const packaged = experimentalCompilePackage(source, { packageEntries: { dset: './dist/index.mjs', 'dset/merge': './merge/index.mjs' } });
const packageCompilationMs = performance.now() - packageStart;
await mkdir(generated, { recursive: true });
if (resolve(await realpath(generated)) !== resolve(generated)) throw new Error('Generated benchmark directory must not be a symlink');
const stage = await mkdtemp(join(generated, 'run-'));
const stageLocation = relative(generated, stage);
if (!stageLocation || stageLocation.startsWith('..') || isAbsolute(stageLocation)) throw new Error('Unsafe benchmark staging target');
const bundles = new Map<string, string>();
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  const bundle = bundles.get(path);
  if (bundle) return new Response(bundle, { headers: { ...headers, 'content-type': 'text/javascript' } });
  if (path.startsWith('/case/')) return new Response(`<!doctype html><meta charset="utf-8"><title>Third-party runtime benchmark</title><script type="module" src="/bundle/${path.slice(6)}.js"></script>`, { headers: { ...headers, 'content-type': 'text/html' } });
  return new Response('Not found', { status: 404 });
} });
const put = async (file: string, text: string) => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, text); };
const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); } catch { return 'unavailable'; } };
const rows: Array<{ config: CaseConfig; bundleBytes: number; gzipBytes: number; applicationCompilationMs: number; bundlingMs: number;
  diagnostics: Diagnostics; timings: Record<Phase, ReturnType<typeof summary>> }> = [];
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
let crossOriginIsolated = false;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const browserErrors: string[] = [];
  const open = async (config: CaseConfig) => {
    const id = `${config.scenario}-${config.size}-${config.mode}`, folder = join(stage, id), dependency = join(folder, 'node_modules/dset');
    for (const [file, code] of Object.entries(config.mode === 'compiled' ? packaged.output : source)) await put(join(dependency, file), code);
    await put(join(dependency, 'package.json'), JSON.stringify({ name: 'dset', version: '3.1.4', type: 'module',
      exports: { '.': './dist/index.mjs', './merge': './merge/index.mjs' },
      ...(config.mode === 'compiled' ? { 'memoized-dom': { artifact: './memoized-dom.package.json', integrity: true } } : {}) }));
    if (config.mode === 'compiled') {
      const artifact = await experimentalFinalizePackage(packaged.artifact, { packageRoot: dependency, outputDirectory: '.' });
      await put(join(dependency, 'memoized-dom.package.json'), JSON.stringify(artifact));
    }
    const start = performance.now();
    const app = compileModulesDetailed(fixture(config.scenario, config.size), {
      experimentalPackageArtifacts: config.mode === 'compiled' ? [packaged.artifact] : [],
      runtimePath: '@memoized-dom/runtime', hot: false, initialContent: false,
    });
    const applicationCompilationMs = performance.now() - start;
    for (const [file, code] of Object.entries(app.output)) await put(join(folder, file), code);
    await put(join(folder, 'entry.ts'), `import {App} from './App.tsx';import {installBenchmark} from ${JSON.stringify(join(import.meta.dirname, 'browser.ts').replaceAll('\\', '/'))};installBenchmark(App,${JSON.stringify(config)});`);
    const bundleStart = performance.now();
    const build = await Bun.build({ entrypoints: [join(folder, 'entry.ts')], target: 'browser', format: 'esm', minify: true });
    const bundlingMs = performance.now() - bundleStart;
    if (!build.success) throw new Error(build.logs.map(String).join('\n'));
    const code = await build.outputs[0]!.text(); bundles.set(`/bundle/${id}.js`, code);
    const page = await browser!.newPage();
    page.setDefaultTimeout(60_000);
    page.on('pageerror', error => browserErrors.push(`${id}: ${String(error)}`));
    await page.goto(`http://127.0.0.1:${server.port}/case/${id}`, { waitUntil: 'load' });
    await page.bringToFront(); await page.waitForFunction(() => typeof window.__thirdPartyBench !== 'undefined');
    crossOriginIsolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    const diagnostics = await page.evaluate(() => window.__thirdPartyBench.diagnose());
    return { page, config, applicationCompilationMs, bundlingMs, diagnostics, bundleBytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).byteLength,
      samples: Object.fromEntries(phases.map(phase => [phase, [] as number[]])) as Record<Phase, number[]> };
  };
  const run = async (page: Page, phase: Phase) => {
    await page.bringToFront();
    return page.evaluate(({ phase, operations }) => window.__thirdPartyBench.run(phase, operations), {
      phase, operations: phase === 'idle' ? options.frames : options.operations,
    });
  };
  console.log(`Real Chromium / production runtime. ${options.smoke ? 'SMOKE CHECK — not performance evidence.' : `${options.samples} samples; alternating order.`}`);
  for (const scenario of scenarios) for (const size of options.sizes) {
    const opaque = await open({ scenario, size, mode: 'opaque' });
    const compiled = await open({ scenario, size, mode: 'compiled' });
    try {
      for (let round = -options.warmups; round < options.samples; round++) {
        const order = ((round + options.warmups) & 1) ? [compiled, opaque] : [opaque, compiled];
        for (const phase of phases) for (const item of order) {
          const ms = await run(item.page, phase);
          if (round >= 0) item.samples[phase].push(ms);
        }
        if (browserErrors.length) throw new Error(browserErrors.join('\n'));
      }
      for (const item of [opaque, compiled]) rows.push({ config: item.config, applicationCompilationMs: item.applicationCompilationMs, bundlingMs: item.bundlingMs,
        bundleBytes: item.bundleBytes, gzipBytes: item.gzipBytes, diagnostics: item.diagnostics,
        timings: Object.fromEntries(phases.map(phase => [phase, summary(item.samples[phase])])) as Record<Phase, ReturnType<typeof summary>> });
      console.log(`${scenario.padEnd(7)} n=${String(size).padEnd(4)} volatile ${opaque.diagnostics.volatileEntities} → ${compiled.diagnostics.volatileEntities}; correctness passed`);
    } finally { await opaque.page.close(); await compiled.page.close(); }
  }
  if (browserErrors.length) throw new Error(browserErrors.join('\n'));
  const report = { schema: 'mmd-third-party-runtime-v1', timestamp: new Date().toISOString(), options,
    environment: { gitRevision: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0,
      bun: Bun.version, bunRevision: Bun.revision, nodeCompatibilityVersion: process.version, platform: process.platform, osRelease: release(), arch: process.arch,
      cpu: cpus()[0]?.model, cpuThreads: cpus().length, memoryBytes: totalmem(), browser: await browser.version(), headless: true,
      crossOriginIsolated },
    package: { name: 'dset', version: '3.1.4', sourceHashes: expected, packageCompilationMs },
    methodology: { timing: 'Uninstrumented production-runtime execution; setup, data readiness and assertions excluded',
      idle: 'Deterministic simulated visible frames; NOT wall-clock CPU%, FPS, energy, or paint latency',
      updates: 'Synchronous DOM click + commit, no frame pump', updatesFrame: 'One click + one simulated frame per operation',
      diagnostics: 'Separate untimed run; counters never installed in timing trials', installedPackageOptInUsed: false }, rows };
  console.log('\nMedian microseconds per frame/op (P25–P75); below-resolution values are not speedup evidence.');
  console.log('scenario size mode      idle frame        click+commit      click+frame');
  for (const row of rows) {
    const cells = phases.map(phase => {
      const count = phase === 'idle' ? options.frames : options.operations, value = row.timings[phase];
      return `${(value.medianMs * 1000 / count).toFixed(2)} [${(value.p25Ms * 1000 / count).toFixed(2)}–${(value.p75Ms * 1000 / count).toFixed(2)}]`.padEnd(22);
    });
    console.log(`${row.config.scenario.padEnd(8)} ${String(row.config.size).padEnd(4)} ${row.config.mode.padEnd(9)} ${cells.join(' ')}`);
  }
  const destination = resolve(options.output ?? join(import.meta.dirname, 'results', `${report.timestamp.replace(/[:.]/g, '-')}-${process.pid}.json`));
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`\nReport (raw samples + diagnostics + environment): ${destination}`);
} finally {
  try { if (browser) await closeBrowser(browser); }
  finally {
    await server.stop(true);
    await rm(stage, { recursive: true, force: true });
  }
}
