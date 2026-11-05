/**
 * A native package from end to end: the author writes `.lib.config.ts` and source, the
 * command generates the package, and an app that installs it gets it with no configuration.
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, createServer } from 'vite';
import memoizedDom from '../src';
import { buildLibrary } from '../src/library-build';
import { isNativePackageFile, nativeDependencies } from '../src/graph/native-packages';

let fixture: string;
let author: string;
let app: string;

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, source] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }
}

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

const authored = {
  'package.json': JSON.stringify({
    name: '@acme/kit',
    version: '1.2.3',
    type: 'module',
    sideEffects: false,
    exports: { '.': './must-be-replaced.js' },
    scripts: { build: 'must-not-be-published' },
    devDependencies: { typescript: '*' },
  }),
  '.lib.config.ts': `export default { entry: './src/index.ts', subpaths: ['./src/public'], source: true, declarations: false };`,
  'src/index.ts': `export { count, increment } from './store.js'; export { Badge } from './Badge';`,
  'src/store.ts': `export let count = 1; export function increment() { count++; }`,
  'src/Badge.tsx': `
    import { count } from './store';
    export function Badge({ label }: { label: string }) {
      let clicks = 0;
      return <button class={label} onClick={() => clicks++}>{label}:{count}:{clicks}</button>;
    }
  `,
  'src/public/tabs.ts': `
    import { count } from '../store';
    export function shown() { return 'tab' + count; }
  `,
  'src/unused.ts': `export const secret = 'this file is not part of the public API';`,
  'tests/store.test.ts': `export {};`,
};

beforeEach(async () => {
  const parent = join(import.meta.dirname, 'fixtures/out');
  await mkdir(parent, { recursive: true });
  fixture = await mkdtemp(join(parent, 'native-'));
  author = join(fixture, 'author');
  app = join(fixture, 'app');
  await write(author, authored);
});

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

/** Build the author's package, and install the result into the app. */
async function install(name = '@acme/kit'): Promise<void> {
  await cp(await buildLibrary({ root: author }), join(app, 'node_modules', name), { recursive: true });
}

it('generates the package from the config alone', async () => {
  const output = await buildLibrary({ root: author });
  const manifest = await json(join(output, 'package.json'));

  expect(manifest['memoized-dom']).toEqual({ source: true });
  expect(manifest.exports).toEqual({
    '.': { default: './src/index.ts' },
    './tabs': { default: './src/public/tabs.ts' },
  });
  expect(manifest.peerDependencies['@memoized-dom/runtime']).toBe('*');
  expect(manifest.scripts).toBeUndefined();
  expect(manifest.devDependencies).toBeUndefined();

  // The source is published as it was written, and only what the public API reaches.
  expect(await readFile(join(output, 'src/Badge.tsx'), 'utf8')).toBe(authored['src/Badge.tsx']);
  expect(existsSync(join(output, 'src/store.ts'))).toBe(true);
  expect(existsSync(join(output, 'src/unused.ts'))).toBe(false);
  expect(existsSync(join(output, 'tests'))).toBe(false);
  expect(existsSync(join(output, '.lib.config.ts'))).toBe(false);
  expect(existsSync(join(output, 'memoized-dom.package.json'))).toBe(false);
}, 60_000);

it('generates declarations for each public entry', async () => {
  await write(author, { '.lib.config.ts': `export default { entry: './src/index.ts', subpaths: ['./src/public'], source: true };` });
  const output = await buildLibrary({ root: author });
  const manifest = await json(join(output, 'package.json'));

  expect(manifest.types).toBe('./index.d.ts');
  expect(manifest.exports['.']).toEqual({ types: './index.d.ts', default: './src/index.ts' });
  expect(manifest.exports['./tabs']).toEqual({ types: './entries/tabs.d.ts', default: './src/public/tabs.ts' });
  expect(existsSync(join(output, 'index.d.ts'))).toBe(true);
  expect(await readFile(join(output, 'entries/tabs.d.ts'), 'utf8')).toContain('.types/src/public/tabs');
  expect(await readFile(join(output, '.types/src/public/tabs.d.ts'), 'utf8')).toContain('shown');
}, 120_000);

it('finds the data package a package needs without importing it', async () => {
  await write(author, { 'src/index.ts': `export function load() { return $fetch('/user'); }` });
  const manifest = await json(join(await buildLibrary({ root: author }), 'package.json'));

  expect(manifest.peerDependencies['@memoized-dom/data']).toBe('*');
}, 60_000);

it('publishes a stylesheet, and keeps its import from being dropped', async () => {
  await write(author, {
    'src/index.ts': `import './theme.css'; export const name = 'kit';`,
    'src/theme.css': `b { color: red; }`,
  });
  const output = await buildLibrary({ root: author });

  expect(await readFile(join(output, 'src/theme.css'), 'utf8')).toBe('b { color: red; }');
  expect((await json(join(output, 'package.json'))).sideEffects).toEqual(['./src/theme.css']);
}, 60_000);

it.each([
  ['a dependency it does not list', { 'src/index.ts': `export { x } from 'not-listed';` }, /not listed/],
  ['a file that does not exist', { 'src/index.ts': `export { x } from './missing';` }, /does not exist/],
  ['a file outside the package', { 'src/index.ts': `export { x } from '../../outside';`, '../outside.ts': `export const x = 1;` }, /outside the package/],
  ['an import only this project understands', { 'src/index.ts': `export { x } from '#local';` }, /relative import/],
])('stops at %s', async (_name, files, message) => {
  await write(author, files);
  await expect(buildLibrary({ root: author })).rejects.toThrow(message);
}, 60_000);

it.each([
  ['aliases', `aliases: { '@': './src' }`, /aliases/],
  ['compiled output options', `minify: false`, /compiled output/],
])('refuses %s, which published source cannot honour', async (_name, option, message) => {
  await write(author, { '.lib.config.ts': `export default { entry: './src/index.ts', source: true, declarations: false, ${option} };` });
  await expect(buildLibrary({ root: author })).rejects.toThrow(message);
}, 60_000);

it('tells a native package from an ordinary one by reading its manifest', async () => {
  await install();
  await write(app, {
    'package.json': JSON.stringify({ name: 'app', dependencies: { '@acme/kit': '*', ordinary: '*' }, devDependencies: { tool: '*' } }),
    'node_modules/ordinary/package.json': JSON.stringify({ name: 'ordinary', version: '1.0.0' }),
    'node_modules/ordinary/index.js': `export const x = 1;`,
    'node_modules/ordinary/esm/package.json': `{ "type": "module" }`,
    'node_modules/tool/package.json': JSON.stringify({ name: 'tool', 'memoized-dom': { source: true } }),
    'node_modules/@acme/kit/src/nested/package.json': `{ "type": "module" }`,
  });

  expect([...nativeDependencies(app)].sort()).toEqual(['@acme/kit', 'tool']);
  expect(isNativePackageFile(join(app, 'node_modules/@acme/kit/src/store.ts'))).toBe(true);
  expect(isNativePackageFile(join(app, 'node_modules/@acme/kit/src/nested/a.ts'))).toBe(true);
  expect(isNativePackageFile(join(app, 'node_modules/ordinary/esm/index.js'))).toBe(false);
  expect(isNativePackageFile(join(app, 'src/App.tsx'))).toBe(false);
}, 60_000);

it('follows a native package through another, but not through an ordinary one', async () => {
  await write(app, {
    'package.json': JSON.stringify({ name: 'app', dependencies: { outer: '*', plain: '*' } }),
    'node_modules/outer/package.json': JSON.stringify({ name: 'outer', 'memoized-dom': { source: true }, dependencies: { inner: '*' } }),
    'node_modules/inner/package.json': JSON.stringify({ name: 'inner', 'memoized-dom': { source: true } }),
    'node_modules/plain/package.json': JSON.stringify({ name: 'plain', dependencies: { hidden: '*' } }),
    'node_modules/hidden/package.json': JSON.stringify({ name: 'hidden', 'memoized-dom': { source: true } }),
  });

  expect([...nativeDependencies(app)].sort()).toEqual(['inner', 'outer']);
});

const consumer = {
  'package.json': JSON.stringify({ name: 'app', type: 'module', dependencies: { '@acme/kit': '*' } }),
  'index.html': `<!doctype html><body><div id="root"></div><script type="module" src="/main.ts"></script>`,
  'main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`,
  'App.tsx': `
    import { Badge, count, increment } from '@acme/kit';
    import { shown } from '@acme/kit/tabs';
    export function App() {
      return <main>
        <p>{count}:{shown()}</p>
        <Badge label="first" /><Badge label="second" />
        <i onClick={increment}>inc</i>
      </main>;
    }
  `,
};

/** No option names the package: it is found from the app's dependencies alone. */
const viteConfig = () => ({
  root: app,
  configFile: false as const,
  logLevel: 'silent' as const,
  plugins: [memoizedDom({ clientEntry: './main.ts' })],
});

it('keeps a native package out of prebundling and SSR externals with no configuration', async () => {
  await install();
  await write(app, consumer);
  const server = await createServer({ ...viteConfig(), server: { middlewareMode: true } });

  try {
    expect(server.config.optimizeDeps.exclude).toContain('@acme/kit');
    expect(server.environments.ssr!.config.resolve.noExternal).toContain('@acme/kit');

    // The app's compiler followed the barrel and its `.js` name to the file that owns the state.
    const transformed = await server.transformRequest('/App.tsx');
    expect(transformed!.code).toContain('node_modules/@acme/kit/src/store.ts');
  } finally {
    await server.close();
  }
}, 120_000);

it('runs in the built app: one state across the barrel and a subpath, and each instance its own', async () => {
  await install();
  await write(app, consumer);

  const outDir = join(app, 'built');
  await build({ ...viteConfig(), build: { outDir, minify: false, rollupOptions: { output: { entryFileNames: 'app.js' } } } });
  const built = await readFile(join(outDir, 'app.js'), 'utf8');

  expect(built).not.toContain('this file is not part of the public API');

  // Only for running the bundle: Vite itself must not see a DOM.
  GlobalRegistrator.register({ url: 'http://localhost:3000' });

  try {
    document.body.innerHTML = '<div id="root"></div>';
    await import(pathToFileURL(join(outDir, 'app.js')).href);

    const text = (selector: string) => document.querySelector(selector)?.textContent;
    const click = async (selector: string) => {
      (document.querySelector(selector) as HTMLElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    expect(text('p')).toBe('1:tab1');
    expect(text('.first')).toBe('first:1:0');

    await click('.first');
    expect(text('.first')).toBe('first:1:1');
    expect(text('.second')).toBe('second:1:0');

    await click('i');
    expect(text('p')).toBe('2:tab2');
    expect(text('.first')).toBe('first:2:1');
    expect(text('.second')).toBe('second:2:0');
  } finally {
    await GlobalRegistrator.unregister();
  }
}, 120_000);
