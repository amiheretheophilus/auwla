/**
 * One command for the benchmark VM: `bun run bench:vm`.
 *
 * Builds the packages, then runs, with the selected compiler (compiler-next
 * by default):
 *
 * 1. the DOM suite: memoized-dom against vanilla JS, every state placement
 *    (component rows, inline rows, module/component state) and the mutable/
 *    immutable update styles, in headless Chrome (`bench/dom/`);
 * 2. the pinned Octane suite: memoized-dom against nine frameworks
 *    (`bench/octane/`), set up on first use.
 *
 * Every report is copied into `bench/results/<time>-<commit>-<compiler>/`,
 * with a summary in its README.md. Tracked files the builds regenerate are
 * restored afterwards, so the checkout stays clean and `git pull` works.
 *
 *   bun run bench:vm                       everything, timed
 *   bun run bench:vm --quick               correctness gates and one Octane sample (minutes)
 *   bun run bench:vm --only=dom            or --only=octane
 *   bun run bench:vm --before-ref=d6e678b  also compare with a baseline commit, side by side
 *   bun run bench:vm --compiler=old        the existing compiler, for reference
 *   bun run bench:vm --no-build            skip `bun run build`
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const usage = 'bun run bench:vm [--quick] [--only=dom|octane] [--before-ref=COMMIT] [--compiler=next|old] [--no-build]';
if (args.includes('--help')) {
  console.log(usage);
  process.exit(0);
}
const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const unknown = args.filter(arg => !['--quick', '--no-build'].includes(arg)
  && !/^--(only|before-ref|compiler)=.+$/.test(arg));
if (unknown.length > 0) throw new Error(`Unknown options: ${unknown.join(' ')}\n${usage}`);
const quick = args.includes('--quick');
const only = option('only');
if (only !== undefined && only !== 'dom' && only !== 'octane') throw new Error('--only must be dom or octane');
const compiler = option('compiler') ?? 'next';
if (compiler !== 'next' && compiler !== 'old') throw new Error('--compiler must be next or old');
const beforeRef = option('before-ref');

const root = resolve(import.meta.dirname, '..');
const dom = resolve(root, 'bench/dom');
const octane = resolve(root, 'bench/octane');
// Every child process inherits the choice (`bench/load-compiler.ts`).
const env = { ...process.env, BENCH_COMPILER: compiler };

async function run(command: string[], cwd = root): Promise<void> {
  console.log(`\n$ ${command.join(' ')}`);
  const child = Bun.spawn(command, { cwd, env, stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(' ')} exited with ${code}`);
}

function git(...gitArgs: string[]): string {
  const result = Bun.spawnSync(['git', ...gitArgs], { cwd: root });
  return result.success ? result.stdout.toString().trim() : '';
}

const bun = process.execPath;
const commit = git('rev-parse', 'HEAD');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(root, 'bench/results', `${stamp}-${commit.slice(0, 8)}-${compiler}`);
mkdirSync(output, { recursive: true });

// Generated DOM files carry the compiler: `compiled-*.ts` (existing) or
// `compiled-*.next.ts` (compiler-next), and the same for the reports.
const suffix = compiler === 'next' ? '.next' : '';
// The DOM builds regenerate these tracked files; put back the ones that were
// clean, so a timing run never leaves the checkout dirty.
const tracked = [
  ...readdirSync(dom).filter(file => /^compiled-.*\.ts$/.test(file)),
  `state-placement-results${suffix}.md`, `state-placement-latest${suffix}.json`,
].map(file => `bench/dom/${file}`).filter(path => git('ls-files', '--', path) !== '');
const clean = tracked.filter(path => git('status', '--porcelain', '--', path) === '');
function restore(): void {
  if (clean.length > 0) git('checkout', '--', ...clean);
}

const steps: { name: string; ok: boolean; detail: string }[] = [];
async function step(name: string, body: () => Promise<string | void>): Promise<void> {
  console.log(`\n=== ${name}`);
  const started = performance.now();
  try {
    const detail = await body();
    const seconds = ((performance.now() - started) / 1000).toFixed(0);
    steps.push({ name, ok: true, detail: `${detail ?? 'done'} (${seconds} s)` });
  } catch (error) {
    console.error(error);
    steps.push({ name, ok: false, detail: String((error as Error).message ?? error).split('\n')[0]! });
  }
}

/** Copy a report into the results folder, if the step wrote it. */
function collect(from: string, to: string): boolean {
  if (!existsSync(from)) return false;
  cpSync(from, resolve(output, to), { recursive: true });
  return true;
}

if (!args.includes('--no-build')) {
  await step('build the packages', () => run([bun, 'run', 'build']));
}

if (only !== 'octane') {
  await step('DOM suite: memoized-dom against vanilla JS', async () => {
    try {
      await run([bun, 'run', 'bench/dom/build.ts']);
      await run([bun, 'run', 'bench/dom/state-placement-build.ts']);
      await run([bun, 'run', 'bench/dom/update-style-build.ts']);
      await run([bun, 'run', 'bench/dom/bundle.ts', 'bench/dom/state-placement-browser.ts',
        'bench/dom/dist/state-placement-browser-bundle.js']);
      await run([bun, 'run', 'bench/dom/state-placement-run.ts', ...(quick ? ['--validate-only'] : [])]);
      if (quick) return 'all correctness gates passed (no timings with --quick)';
      collect(resolve(dom, `state-placement-results${suffix}.md`), 'dom-state-placement.md');
      collect(resolve(dom, `state-placement-latest${suffix}.json`), 'dom-state-placement.json');
      collect(resolve(dom, 'dist/update-style/results.md'), 'dom-update-styles.md');
      collect(resolve(dom, 'dist/update-style/results.json'), 'dom-update-styles.json');
      return 'gates passed; timings in dom-state-placement.md and dom-update-styles.md';
    } finally {
      restore();
    }
  });
  if (beforeRef !== undefined && !quick) {
    await step(`DOM comparison with ${beforeRef}`, async () => {
      await run([bun, 'run', 'bench/dom/compare.ts', `--before-ref=${beforeRef}`]);
      const reports = resolve(dom, 'dist/compare');
      const newest = readdirSync(reports).map(name => resolve(reports, name))
        .filter(path => existsSync(resolve(path, 'results.md')))
        .sort((left, right) => Bun.file(resolve(right, 'results.md')).lastModified - Bun.file(resolve(left, 'results.md')).lastModified)[0];
      if (newest === undefined || !collect(resolve(newest, 'results.md'), 'dom-compare.md')) {
        throw new Error('the comparison wrote no report');
      }
      collect(resolve(newest, 'results.json'), 'dom-compare.json');
      return 'before/after timings in dom-compare.md';
    });
  }
}

if (only !== 'dom') {
  await step('Octane suite: memoized-dom against nine frameworks', async () => {
    const ready = git('-C', 'bench/octane/upstream', 'rev-parse', 'HEAD') !== ''
      && existsSync(resolve(octane, 'upstream/benchmarks/js-framework/node_modules'));
    if (!ready) await run([bun, 'run', 'bench/octane/setup.ts']);
    const results = resolve(octane, 'results');
    const before = new Set(existsSync(results) ? readdirSync(results) : []);
    await run([bun, 'run', 'bench/octane/run.ts', ...(quick ? ['--smoke'] : []),
      ...(beforeRef !== undefined && !quick ? [`--before-ref=${beforeRef}`] : [])]);
    const created = readdirSync(results).filter(name => !before.has(name)).sort().at(-1);
    if (created === undefined || !collect(resolve(results, created), 'octane')) {
      throw new Error('Octane wrote no results');
    }
    return quick ? 'one sample per scenario (--smoke); see octane/results.md' : 'see octane/results.md';
  });
}

const failed = steps.filter(entry => !entry.ok);
const summary = [
  '# Benchmark run',
  '',
  `- Commit: \`${commit}\`${git('status', '--porcelain', '--untracked-files=no') === '' ? '' : ' (with uncommitted changes)'}`,
  `- Compiler: ${compiler === 'next' ? 'compiler-next (`packages/compiler-next`)' : 'existing (`packages/compiler`)'}`,
  `- Mode: ${quick ? 'quick (correctness gates, one Octane sample)' : 'full'}${beforeRef === undefined ? '' : `, baseline ${beforeRef}`}`,
  `- Machine: ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs, ${(totalmem() / 2 ** 30).toFixed(0)} GiB, ${process.platform}`,
  `- Bun ${Bun.version}; started ${stamp}`,
  '',
  '| Step | Result |',
  '|---|---|',
  ...steps.map(entry => `| ${entry.name} | ${entry.ok ? 'ok' : '**failed**'}: ${entry.detail.replaceAll('|', '\\|')} |`),
  '',
];
writeFileSync(resolve(output, 'README.md'), summary.join('\n'));
console.log(`\n${summary.join('\n')}\nResults: ${output}`);
if (failed.length > 0) process.exit(1);
