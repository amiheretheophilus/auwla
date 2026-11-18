/**
 * Attribute minified browser bytes to stable compiler-generated source graphs.
 *
 * `BENCH_COMPILER=<path>` audits a snapshot compiler instead (`../load-compiler.ts`).
 * The bundle-trimming checks below describe what the old compiler achieved; the
 * compiler must meet them too, so the ones it does not yet meet are reported rather
 * than stopping the audit, and the report doubles as its size to-do list.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix, resolve } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { build } from 'esbuild';
import { sizeFixtures } from './fixtures';
import { loadBenchmarkCompiler, selectedCompilerPath } from '../load-compiler';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--verify' && arg !== '--hydrate' && !arg.startsWith('--before-ref=') && !arg.startsWith('--fixture=') && !arg.startsWith('--compiler='))) throw new Error('Use --verify, --hydrate, --before-ref=<commit>, --fixture=<name> or --compiler=<entry>');
const hydration = args.includes('--hydrate');

/** `current` is this checkout's compiler; `custom` a snapshot (`../load-compiler.ts`). */
const compilerName = selectedCompilerPath() === null ? 'current' : 'custom';
const { compileModules } = await loadBenchmarkCompiler();

/** A trimming target the old compiler met: one this compiler does not meet yet is reported. */
const notMet: string[] = [];
function trimmed(condition: boolean, fixture: string, graph: string, message: string): void {
  if (condition) return;
  notMet.push(`${fixture} (${graph}): ${message}`);
}

const root = resolve(import.meta.dirname, '../..');
const suffix = compilerName === 'current' ? '' : `-${compilerName}`;
const directory = resolve(import.meta.dirname, hydration ? `dist/audit-hydration${suffix}` : `dist/audit${suffix}`);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
mkdirSync(directory, { recursive: true });
const reference = args.find(arg => arg.startsWith('--before-ref='))?.slice(13);
let baseline: string | undefined;
let baselineRoot: string | undefined;
if (reference !== undefined) {
  baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40,64}$/.test(baseline)) throw new Error('Invalid runtime baseline');
  baselineRoot = resolve(directory, `baseline-${baseline.slice(0, 8)}`);
  mkdirSync(baselineRoot, { recursive: true });
  const archive = resolve(baselineRoot, 'runtime.tar');
  execFileSync('git', ['archive', `--output=${archive}`, baseline,
    'packages/runtime/src', 'packages/runtime/package.json',
    'packages/data/src', 'packages/data/package.json',
    'packages/router/src', 'packages/router/package.json'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', baselineRoot]);
}
const rows: Array<{ fixture: string; graph: string; raw: number; gzip: number; brotli: number; app: number;
  inputs: Array<{ path: string; bytes: number }> }> = [];
const selected = new Set(args.filter(arg => arg.startsWith('--fixture=')).map(arg => arg.slice(10)));
for (const name of selected) if (!Object.hasOwn(sizeFixtures, name)) throw new Error(`Unknown fixture ${name}`);
for (const [fixture, sources] of Object.entries(sizeFixtures)) {
  if (selected.size && !selected.has(fixture)) continue;
  // A fixture the compiler rejects fails the audit: its sizes would be missing from the report.
  const compiled: Record<string, string> = compileModules({ ...sources,
    './main.ts': `${hydration ? "import '@memoized-dom/runtime/hydrate';" : ''}import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
  }, { dataDelivery: hydration ? 'universal' : 'client' });
  const modules = new Map(Object.entries(compiled).map(([id, source]) => [posix.resolve('/', id), source]));
  for (const graph of ['package', 'source', ...(baselineRoot ? ['source-before'] : [])]) {
    const graphRoot = graph === 'source-before' ? baselineRoot! : root;
    const result = await build({ stdin: { contents: "import '@size-fixture/main.ts';", resolveDir: root },
      bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, metafile: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: 'browser.js',
      logOverride: {'import-is-undefined':'error'},
      plugins: [{ name: 'size-fixtures', setup(builder) {
        builder.onResolve({ filter: /^@size-fixture\// }, args => ({
          path: `/${args.path.slice('@size-fixture/'.length)}`, namespace: 'fixture',
        }));
        builder.onResolve({ filter: /^\./, namespace: 'fixture' }, args => {
          const path = posix.resolve(posix.dirname(args.importer), args.path);
          const id = [path, `${path}.ts`, `${path}.tsx`].find(id => modules.has(id));
          if (!id) throw new Error(`Missing fixture module ${path}`);
          return { path: id, namespace: 'fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents: modules.get(args.path)!, loader: 'ts', resolveDir: root,
        }));
        if (graph !== 'package') builder.onResolve({ filter: /^@memoized-dom\/runtime(?:\/client|\/hydrate|\/hydrate-program)?$/ }, args => ({
          path: resolve(graphRoot, args.path.endsWith('/hydrate-program') ? 'packages/runtime/src/hydrate-program.ts' : args.path.endsWith('/hydrate') ? 'packages/runtime/src/hydrate.ts' : 'packages/runtime/src/index.ts'),
        }));
        if (graph !== 'package') builder.onResolve({ filter: /^@memoized-dom\/data(?:\/internal)?$/ }, args => ({
          path: resolve(graphRoot, args.path.endsWith('/internal') ? 'packages/data/src/internal.ts' : 'packages/data/src/index.ts'),
        }));
        if (graph !== 'package') builder.onResolve({ filter: /^@memoized-dom\/router(?:\/internal)?$/ }, args => ({
          path: resolve(graphRoot, args.path.endsWith('/internal') ? 'packages/router/src/internal.ts' : 'packages/router/src/index.ts'),
        }));
      } }],
    });
    const output = result.outputFiles[0]!;
    const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
      .map(([path, input]) => ({ path: path.replaceAll('\\', '/'), bytes: input.bytesInOutput }))
      .filter(input => input.bytes > 0).sort((a, b) => b.bytes - a.bytes);
    // Minified bytes of the compiled fixture modules alone: the part that grows
    // with every component, unlike the shared runtime.
    const app = inputs.filter(input => input.path.startsWith('fixture:')).reduce((sum, input) => sum + input.bytes, 0);
    const row = { fixture, graph, raw: output.contents.byteLength, gzip: gzipSync(output.contents).byteLength,
      brotli: brotliCompressSync(output.contents).byteLength, app, inputs };
    const check = (condition: boolean, message: string) => trimmed(condition, fixture, graph, message);
    const counters = ['owner-counter', 'input-list', 'module-counter'].includes(fixture);
    const fixedRequests = ['request-group','request-routed-group','request-data'].includes(fixture);
    const bodyless = [...['request-group','request-routed-group','request-data'], 'request-rebind', 'request-factory-rebind'].includes(fixture);
    const retains = (pattern: RegExp) => inputs.some(input => pattern.test(input.path));
    if (graph !== 'source-before') {
      const overrides = output.text.includes('.effects??');
      check(!(!hydration && counters && overrides), 'Ordinary client mounting must not retain environment override merging');
      check(!(fixture === 'isolated-counter' && !overrides), 'An isolated runtime must retain environment override support');
      check(!(!hydration && counters && retains(/\/hydration-error\.(?:ts|js)$/)), 'Ordinary mount must not retain optional hydration recovery');
      check(!(counters && output.text.includes('type:"open",kind:') !== hydration), 'The full region marker parser must be retained only with hydration');
      check(!(fixture === 'request-routed-group' && retains(/router\/(?:src|dist)\/preparation\.(?:ts|js)$/)), 'Ordinary routing must not retain route preparation execution');
      check(!(fixture === 'route-helper' && /new RegExp\(/.test(output.text)), 'Path interpolation must not retain pattern matching expressions');
      check(!(fixture === 'route-lazy' && output.text.includes('/_memoized/routed')), 'Lazy-only routes must not retain routed data execution');
      check(!(fixedRequests && retains(/\/data\/src\/resource-writes\.ts$/)), 'Read-only fetched pages must not retain the optional mutation implementation');
      check(!(fixedRequests && output.text.includes('Cannot rebind a disposed fetch resource')), 'Fixed fetched pages must not retain optional request replay');
      check(!(bodyless && output.text.includes('Request body must be JSON-serializable')), 'Proved bodyless requests must not retain request body encoding');
      check(!(!hydration && bodyless && output.text.includes('Serialized data state sources must be an array')), 'Proved client-only fetches must not retain restoration validation');
      check(!(!hydration && ['static','owner-counter','input-list','request-group','request-routed-group','request-data'].includes(fixture)
        && output.text.includes('memoized-dom:stream')), 'Client-only programs must not retain streamed document handoff');
      check(!(hydration && fixture.startsWith('request-') && !output.text.includes('Serialized data state sources must be an array')), 'SSR-capable fetches must retain transfer restoration');
    }
    check(!(['request-encoded-body','request-opaque-options'].includes(fixture) && !output.text.includes('Request body must be JSON-serializable')),
      'Generic requests must retain request body encoding');
    if (graph === 'source') {
      check(!(!hydration && bodyless && retains(/\/request-(?:transfer|hash)\.ts$/)), 'Proved bodyless client-only fetches must not retain transfer fingerprints');
      check(!(!hydration && fixedRequests && retains(/\/data\/src\/(?:active-restoration|restoration)\.ts$/)), 'Client-only requests must not retain restoration or stream waiters');
      check(!(hydration && fixture.startsWith('request-') && !retains(/\/request-transfer\.ts$/)), 'SSR-capable fetches must retain transfer fingerprints');
    }
    check(!retains(/(?:^|\/)packages\/(?:compiler|vite|language-service|server|adapters|utils)\//),
      'Ordinary browser fixtures must not retain unused utility, server or tooling packages');
    rows.push(row);
    writeFileSync(resolve(directory, `${fixture}-${graph}.js`), output.contents);
    writeFileSync(resolve(directory, `${fixture}-${graph}.meta.json`), JSON.stringify(result.metafile, null, 2));
    console.log(`${fixture.padEnd(16)} ${graph.padEnd(7)} ${row.raw} B raw / ${row.gzip} B gzip / ${row.brotli} B br / ${row.app} B app`);
  }
}
const lines = [`# Browser bundle audit (${compilerName} compiler)`, '',
  `HEAD: ${revision}. Working tree includes changes: ${status !== ''}.`, '',
  `Runtime/data/router source baseline: ${baseline ?? 'not requested'}. All graphs use the current compiler and identical authored fixtures.`, '',
  'Archived runtime sources are used unchanged. Missing compiler hooks fail the audit; choose an API-compatible baseline or compare each revision with its own compiler.', '',
  'Stable authored fixtures compiled by the current compiler. Each graph includes mount and root metadata.', '',
  `Optional hydration included: ${hydration}. Browser verification below checks client interactions; SSR adoption/recovery is covered by the hydration test suites.`, '',
  '`package` resolves published browser exports; `source` attributes the equivalent graph to runtime, data and router source modules. Each whole bundle is compressed once; input attribution is minified raw bytes, not additive gzip savings.', '',
  '`App B` is the minified bytes attributed to the compiled fixture modules alone.', '',
  '| Fixture | Graph | Raw B | Gzip B | Brotli B | App B |', '|---|---|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.fixture} | ${row.graph} | ${row.raw} | ${row.gzip} | ${row.brotli} | ${row.app} |`), '',
  ...(notMet.length === 0 ? [] : ['## Trimming targets the old compiler met and this one does not yet', '',
    ...notMet.map(item => `- ${item}`), '']),
];
/** A fixture whose page shows the fetched name as `<p>Ada</p>`, which the browser check waits for. */
function showsName(fixture: string): boolean {
  if (!fixture.startsWith('request-') && fixture !== 'promise-data') return false;
  const app = sizeFixtures[fixture]?.['./App.tsx'] ?? '';
  return /<p>\{(?:user\??\.(?:data\?\.)?name|name)\}<\/p>/.test(app);
}
if (process.argv.includes('--verify')) {
  const { default: puppeteer } = await import('puppeteer-core');
  const allowed = new Set(rows.flatMap(row => ['js', 'html'].map(extension => `${row.fixture}-${row.graph}.${extension}`)));
  const browser = await puppeteer.launch({ headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('fixture') ?? url.pathname.slice(1);
    if (name === 'api/user') return Response.json({ name: url.searchParams.get('name') ?? 'Ada' });
    if (name === 'api/encoded') {
      if (request.method !== 'POST' || request.headers.get('content-type') !== 'application/json') {
        return new Response('Wrong request encoding', {status:400});
      }
      return request.json().then(value => value?.name === 'Ada'
        ? Response.json({name:'Ada'}) : new Response('Wrong request body', {status:400}));
    }
    return allowed.has(name) ? new Response(Bun.file(resolve(directory, name))) : new Response('Not found', { status: 404 });
  } });
  try {
    for (const row of rows) {
      const html = resolve(directory, `${row.fixture}-${row.graph}.html`);
      writeFileSync(html, `<!doctype html><div id="root"></div><script type="module" src="./${row.fixture}-${row.graph}.js"></script>`);
      const page = await browser.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
      try {
        await page.goto(`http://127.0.0.1:${server.port}/?fixture=${row.fixture}-${row.graph}.html`);
        await page.waitForSelector('#root>*', { timeout: 5000 });
        const named = showsName(row.fixture);
        if (named) await page.waitForFunction(() => document.querySelector('#root main p')?.textContent === 'Ada');
        if (row.fixture === 'request-rebind' || row.fixture === 'request-factory-rebind') {
          await page.click('button'); await page.waitForFunction(() => document.querySelector('#root main p')?.textContent === 'Lin');
          await page.click('button'); await page.waitForFunction(() => document.querySelector('#root main p')?.textContent === 'Ada');
        }
        if (row.fixture === 'request-routed-group') {
          await page.click('.about'); await page.waitForSelector('h2');
          await page.click('.home'); await page.waitForFunction(() => document.querySelector('main p')?.textContent === 'Ada');
        }
        if (row.fixture === 'route-lazy') {
          await page.click('.about');await page.waitForSelector('article');
          await page.click('article button');await page.waitForFunction(()=>document.querySelector('article button')?.textContent==='1');
          await page.click('.home');await page.waitForFunction(()=>document.querySelector('article')===null);
          await page.click('.about');await page.waitForFunction(()=>document.querySelector('article button')?.textContent==='0');
        }
        await page.evaluate(async ({ fixture, named }) => {
          // The apps measured as they were written (`flowos`, `octane`) have their own roots:
          // mounting without page errors is what is checked for them.
          const main = document.querySelector('#root>main');
          if (main === null) return;
          const button = main.querySelector('button')!;
          const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
          const check = (condition: boolean) => { if (!condition) throw new Error(`Failed ${fixture} interaction`); };
          if (fixture === 'static') { check(main.textContent === 'Static shellReady.'); return; }
          if (fixture.includes('-recreated-slot-')) {
            // The cards' own `<p>` is static; the count is in the footer.
            main.querySelector<HTMLButtonElement>('.next')!.click(); await settle();
            check(main.querySelector('footer')!.textContent === '1'); return;
          }
          if (fixture.startsWith('primitive-')) {
            const originals=[...main.querySelectorAll('li')];
            const values=()=>[...main.querySelectorAll('li')].map(node=>node.textContent).join('|');
            check(values()==='2|4|6');button.click();await settle();check(values()==='2|6|6');
            main.querySelector<HTMLButtonElement>('.reverse')!.click();await settle();
            check([...main.querySelectorAll('li')].every((node,index)=>node===originals[2-index]));
            check(values()==='6|6|2');button.click();await settle();check(values()==='6|8|2');return;
          }
          if (fixture === 'dynamic-tags') {
            const host=()=>main.querySelector('[data-role="host"]')!;
            check(host().tagName==='SECTION' && host().textContent==='summary:0');
            const original=host();main.querySelector<HTMLButtonElement>('.next')!.click();await settle();
            check(host()===original && host().textContent==='summary:1');
            main.querySelector<HTMLButtonElement>('.swap')!.click();await settle();
            check(host().tagName==='ARTICLE' && host().textContent==='details:1');
            const article=host();main.querySelector<HTMLButtonElement>('.next')!.click();await settle();
            check(host()===article && host().textContent==='details:2');
            main.querySelector<HTMLButtonElement>('.swap')!.click();await settle();
            check(host().tagName==='SECTION' && host().textContent==='summary:2');return;
          }
          if (fixture === 'route-lazy') {check(main.querySelector('article button')?.textContent==='0');return;}
          if (fixture === 'route-helper') {
            check(main.querySelector('a')?.getAttribute('href') === '/person/1');
            button.click(); await settle();
            check(main.querySelector('a')?.getAttribute('href') === '/person/2'); return;
          }
          if (fixture.startsWith('request-') || fixture === 'promise-data') {
            // The others render their data in their own shapes; mounting without errors is checked.
            if (named) check(main.querySelector('p')?.textContent === 'Ada');
            if (fixture === 'request-markup') {
              const cards = [...main.querySelectorAll('article')];
              check(cards.length === 16 && cards.every((card,index) =>
                card.getAttribute('data-card') === String(index) &&
                card.textContent === `Card ${index}Ready & waiting.`));
            }
            return;
          }
          if (fixture === 'input-list') {
            const input = main.querySelector('input')!;
            const originals = [...main.querySelectorAll('li')];
            for (const value of [' ', 'hello', 'hello']) {
              input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
              await settle(); button.click(); await settle();
            }
            const nodes = [...main.querySelectorAll('li')];
            check(nodes.length === 4 && nodes[0] === originals[0] && nodes[1] === originals[1]);
            check(nodes.map(node => node.textContent).join('|') === '0-helo|1-heoo3|2-hello|3-hello');
            check(input.value === ''); return;
          }
          if (fixture === 'owner-list') {
            const originals = [...main.querySelectorAll('li')]; button.click(); await settle();
            const nodes = [...main.querySelectorAll('li')];
            check(nodes.every((node, index) => node === originals[2 - index]));
            check(nodes.map(node => node.textContent).join('|') === 'three|two|one'); return;
          }
          if (fixture === 'mixed-lists') {
            const keyed=[...main.querySelectorAll('.keyed li')],positional=[...main.querySelectorAll('.positional li')];
            button.click();await settle();
            const nextKeyed=[...main.querySelectorAll('.keyed li')],nextPositional=[...main.querySelectorAll('.positional li')];
            check(nextKeyed[0]===keyed[1]&&nextKeyed[1]===keyed[0]);
            check(nextPositional[0]===positional[0]&&nextPositional[1]===positional[1]);
            check(nextPositional.map(node=>node.textContent).join('|')==='0:a|1:b|2:c');return;
          }
          if (['module-counter', 'owner-counter', 'isolated-counter', 'composition'].includes(fixture)) {
            button.click(); await settle();
            check(main.querySelector(fixture === 'composition' ? 'strong' : 'p')!.textContent === '1'); return;
          }
          // Any other fixture: its first button must change what the page shows.
          const before = main.textContent;
          button.click(); await settle();
          check(main.textContent !== before);
        }, { fixture: row.fixture, named });
        if (errors.length) throw new Error(errors.join('\n'));
      } catch (error) {
        throw new Error(`${row.fixture}/${row.graph}: ${errors.join('\n') || String(error)}`, { cause: error });
      } finally { await page.close(); }
    }
    console.log(`Verified ${rows.length} browser graphs: interactions, duplicate input values and retained list identity.`);
    lines.push(`All ${rows.length} browser graphs passed interaction checks. Input/list checks include whitespace rejection, duplicate values, input reset and retained row identity. Keyed reverse preserves nodes.`, '');
  } finally {
    try { await browser.close(); } finally { server.stop(true); }
  }
}
for (const row of rows.filter(row => row.graph !== 'package')) {
  lines.push(`## ${row.fixture}: ${row.graph} attribution`, '', '| Input | Minified bytes |', '|---|---:|',
    ...row.inputs.map(input => `| ${input.path} | ${input.bytes} |`), '');
}
writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(),
  revision, status, baseline, hydration, verified: process.argv.includes('--verify'), rows }, null, 2));
writeFileSync(resolve(directory, 'results.md'), lines.join('\n') + '\n');
console.log(`Report: ${resolve(directory, 'results.md')}`);
