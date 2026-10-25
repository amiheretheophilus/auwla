/**
 * A quick local DOM timing, for checking a change before a full VM run.
 *
 *   bun run bench/dom/quick.ts [--compilers=old,next] [--samples=3]
 *     [--scenarios=all|1k|10k|<name>,<name>] [--adapters=<id>,<id>] [--no-build] [--out=<file.md>]
 *
 * On GitHub, where timings are steadier: `gh workflow run bench-quick.yml --ref
 * compiler-rewrite` (inputs `scenarios`, `samples`, `adapters`, `profile`).
 *
 * Builds both compilers' state-placement apps, bundles each, and times the chosen
 * scenarios in local Chrome, side by side. It skips the full untimed validation
 * pass; every timed sample is still checked. Few samples on a desktop machine:
 * use it for large differences, and `bench:vm` for reported numbers.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { bundleDomPage, domDirectory } from './bundle';
import type { BenchRow } from './state-placement-browser';

const flag = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const compilers = (flag('compilers') ?? 'old,next').split(',');
const samples = Number(flag('samples') ?? 3);
const scenarioFlag = flag('scenarios') ?? '10k';
const adapters = flag('adapters')?.split(',');
const ALL = [
  'create 1k', 'create 10k',
  ...['1k', '10k'].flatMap(size => ['replace', 'update', 'select', 'transition', 'swap', 'remove', 'clear']
    .map(operation => `${operation} ${size}`)),
  ...['append1k', 'prepend1k', 'pop1k', 'reverse', 'remove100'].map(operation => `${operation} 10k`),
];
const names = scenarioFlag === 'all' ? ALL
  : scenarioFlag === '1k' || scenarioFlag === '10k' ? ALL.filter(name => name.endsWith(` ${scenarioFlag}`))
    : scenarioFlag.split(',');

// Building with the existing compiler regenerates its tracked `compiled-*.ts`
// files; put back those that were clean. compiler-next's `.next.ts` files stay
// current, so they show the output that was timed.
const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
const existing = readdirSync(domDirectory).filter(file => /^compiled-[a-z-]+\.ts$/.test(file))
  .map(file => join(domDirectory, file))
  .filter(path => git('ls-files', '--', path) !== '' && git('status', '--porcelain', '--', path) === '');

const bundles = new Map<string, string>();
mkdirSync(join(domDirectory, 'dist'), { recursive: true });
for (const compiler of compilers) {
  const env = { ...process.env, BENCH_COMPILER: compiler };
  if (!process.argv.includes('--no-build')) {
    for (const script of ['build.ts', 'state-placement-build.ts']) {
      const result = spawnSync('bun', ['run', join(domDirectory, script)], { env, stdio: 'inherit' });
      if (result.status !== 0) throw new Error(`${script} failed for ${compiler}`);
    }
  }
  process.env.BENCH_COMPILER = compiler;
  const outfile = join(domDirectory, 'dist', `quick-${compiler}.js`);
  await bundleDomPage(join(domDirectory, 'state-placement-browser.ts'), outfile);
  bundles.set(compiler, outfile);
}
if (existing.length > 0) git('checkout', '--', ...existing);

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium');
const browser = await puppeteer.launch({
  executablePath, protocolTimeout: 600000, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const results = new Map<string, BenchRow[]>();
try {
  for (const [compiler, bundle] of bundles) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
    await page.addScriptTag({ path: bundle });
    const rows = await page.evaluate((options) => (window as unknown as {
      __runAll(options: object): BenchRow[];
    }).__runAll(options), { samples, names, validate: false, adapters });
    if (errors.length) throw new Error(errors.join('\n'));
    results.set(compiler, rows);
    await page.close();
  }
} finally {
  await browser.close();
}

// One markdown table per adapter: scenarios down, compilers across. Written
// to `--out` too, which the `bench-quick` workflow adds to its run summary.
const first = [...results.values()][0]!;
const ids = Object.keys(first[0]?.timings ?? {});
const lines: string[] = [];
for (const id of ids) {
  lines.push('', `### ${id} (median of ${samples}, ms)`, '',
    `| scenario | ${compilers.join(' | ')} |`, `| --- |${compilers.map(() => ' ---: |').join('')}`);
  for (const [index, row] of first.entries()) {
    const cells = compilers.map(name => results.get(name)![index]!.timings[id]!.toFixed(1));
    lines.push(`| ${row.name} | ${cells.join(' | ')} |`);
  }
}
console.log(lines.join('\n'));
const out = flag('out');
if (out !== undefined) writeFileSync(out, `${lines.join('\n')}\n`);
