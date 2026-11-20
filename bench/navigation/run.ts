/**
 * Drives the navigation benchmark in real Chromium (`README.md`). Builds the pages, serves them
 * on a local port (an ES module page cannot load from `file://`), and runs every variant in a
 * mirrored order, A B C C B A, so drift during the run does not favour one side.
 *
 *   bun run bench:navigation                 timed, report in dist/results.md
 *   bun run bench:navigation --validate-only every operation checked, nothing timed
 *
 * PUPPETEER_EXECUTABLE_PATH picks the browser, as for the DOM suite. BENCH_BROWSER_URL connects to
 * one already started with --remote-debugging-port instead.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { extname, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import type { ScenarioSamples } from './browser';
import { buildNavigationPages, distDirectory, VARIANTS, type Variant } from './build';
import { compiledSuffix, selectedCompilerPath } from '../load-compiler';

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== '--validate-only' && arg !== '--no-build' && !arg.startsWith('--compiler='));
if (unknown.length > 0) throw new Error(`Unknown options: ${unknown.join(' ')}`);
const validateOnly = args.includes('--validate-only');
/** `BENCH_VARIANTS=general`: run only these variants, to look at one by itself. */
const chosen = process.env.BENCH_VARIANTS ? process.env.BENCH_VARIANTS.split(',') : null;

if (!args.includes('--no-build')) await buildNavigationPages();

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    const path = new URL(request.url).pathname;
    // The browser asks for it on its own; a 404 would read as a page error.
    if (path === '/favicon.ico') return new Response(null, { status: 204 });
    const file = resolve(distDirectory, `.${path}`);
    if (!file.startsWith(distDirectory) || !existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream' } });
  },
});

async function openBrowser(): Promise<Browser> {
  const browserURL = process.env.BENCH_BROWSER_URL;
  if (browserURL) return puppeteer.connect({ browserURL, protocolTimeout: 600_000 });
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium');
  return puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 600_000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
}

/** One fresh page per run, so no variant inherits another's warmed code or route table. */
async function inPage<T>(browser: Browser, variant: Variant, body: (call: (name: string) => Promise<unknown>) => Promise<T>): Promise<T> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warn') errors.push(`${message.type()}: ${message.text()}`);
    else if (message.type() === 'log') console.log(`  ${variant}: ${message.text()}`);
  });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/${variant}.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, { timeout: 60_000 });
    const result = await body((name) => page.evaluate((fn) => (window as unknown as Record<string, () => unknown>)[fn]!(), name));
    if (errors.length > 0) throw new Error(`${variant}: ${errors.join('\n')}`);
    return result;
  } finally {
    await page.close();
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const browser = await openBrowser();
try {
  if (validateOnly) {
    for (const variant of VARIANTS) {
      const passed = await inPage(browser, variant, (call) => call('__validate')) as string[];
      console.log(`${variant}: ${passed.length} scenarios checked at every operation`);
    }
    console.log('All navigation checks passed.');
  } else {
    const running = VARIANTS.filter((variant) => chosen === null || chosen.includes(variant));
    const order: Variant[] = [...running, ...[...running].reverse()];
    const samples = new Map<Variant, Map<string, number[]>>(VARIANTS.map((variant) => [variant, new Map()]));
    for (const variant of order) {
      const rows = await inPage(browser, variant, (call) => call('__run')) as ScenarioSamples[];
      for (const row of rows) {
        const list = samples.get(variant)!.get(row.name) ?? [];
        list.push(...row.samples);
        samples.get(variant)!.set(row.name, list);
      }
      console.log(`${variant}: ${rows.length} scenarios timed`);
    }

    if (running.length !== VARIANTS.length) {
      console.log(`Timed ${running.join(', ')} only: no comparison report.`);
    } else {
    const scenarios = [...samples.get('optimized')!.keys()];
    const rows = scenarios.map((name) => {
      const cells = Object.fromEntries(VARIANTS.map((variant) => [variant, median(samples.get(variant)!.get(name)!)]));
      return { name, ...cells } as { name: string } & Record<Variant, number>;
    });
    const sizes = Object.fromEntries(VARIANTS.map((variant) => {
      const file = resolve(distDirectory, `navigation-${variant}.js`);
      return [variant, readFileSync(file).length];
    }));

    const ns = (value: number) => `${value.toFixed(0)} ns`;
    const ratio = (value: number, base: number) => `${(value / base).toFixed(2)}x`;
    const compiler = selectedCompilerPath();
    const report = [
      '# Navigation benchmark',
      '',
      `- Measured: ${new Date().toISOString()}; compiler: ${compiler === null ? "this checkout's" : `snapshot \`${compiler}\``}`,
      `- Machine: ${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs, ${(totalmem() / 2 ** 30).toFixed(0)} GiB, ${process.platform}`,
      '- Each cell: median nanoseconds per operation over 14 samples (7 per page run, two runs in the order A B C C B A).',
      '- `without-route-regions` is the same build without the route-regions pass; `general` has no pass at all.',
      '',
      '| Scenario | optimized | without-route-regions | general | optimized / without |',
      '|---|---:|---:|---:|---:|',
      ...rows.map((row) => `| ${row.name} | ${ns(row.optimized)} | ${ns(row['without-route-regions'])} | ${ns(row.general)} | ${ratio(row.optimized, row['without-route-regions'])} |`),
      '',
      `Minified bundle bytes: optimized ${sizes.optimized}, without-route-regions ${sizes['without-route-regions']}, general ${sizes.general}.`,
      '',
    ].join('\n');
    const suffix = compiledSuffix();
    writeFileSync(resolve(distDirectory, `results${suffix}.md`), report);
    writeFileSync(resolve(distDirectory, `results${suffix}.json`), JSON.stringify({ rows, sizes, samples: Object.fromEntries(
      [...samples].map(([variant, byName]) => [variant, Object.fromEntries(byName)]),
    ) }, null, 2));
    console.log(`\n${report}`);
    }
  }
} finally {
  // A browser this run connected to belongs to whoever started it.
  if (process.env.BENCH_BROWSER_URL) await browser.disconnect();
  else await browser.close();
  server.stop(true);
}
