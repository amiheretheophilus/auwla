/**
 * A native package developed beside the app that uses it: linked by the package manager,
 * with its `.lib.config.ts` and source, and nothing built or written by hand.
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, createServer } from 'vite';
import memoizedDom from '../src';
import { buildLibrary } from '../src/library-build';
import { nativePackages } from '../src/graph/native-packages';

let repo: string;
let app: string;
let kit: string;
let builds = 0;

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, source] of Object.entries(files)) {
    const file = join(root, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }
}

/** Link a workspace package as `bun install` does. */
async function link(name: string): Promise<void> {
  await mkdir(join(repo, 'node_modules'), { recursive: true });
  await symlink(join(repo, 'packages', name), join(repo, 'node_modules', name), 'junction');
}

beforeEach(async () => {
  const parent = join(import.meta.dirname, 'fixtures/out');
  await mkdir(parent, { recursive: true });
  repo = await mkdtemp(join(parent, 'workspace-'));
  app = join(repo, 'apps/web');
  kit = join(repo, 'packages/kit');

  await write(repo, { 'package.json': JSON.stringify({ name: 'repo', private: true, workspaces: ['packages/*', 'apps/*'] }) });
  await write(kit, {
    'package.json': JSON.stringify({ name: 'kit', version: '1.0.0', type: 'module' }),
    '.lib.config.ts': `export default { entry: './src/index.ts', subpaths: ['./src/public'], source: true, declarations: false };`,
    'src/index.ts': `export { count, increment } from './store.js'; export { Badge } from './Badge';`,
    'src/store.ts': `export let count = 1; export function increment() { count++; }`,
    'src/Badge.tsx': `
      import { count } from './store';
      export function Badge() {
        let clicks = 0;
        return <button onClick={() => clicks++}>{count}:{clicks}</button>;
      }
    `,
    'src/public/tabs.ts': `import { count } from '../store'; export function shown() { return 'tab' + count; }`,
  });
  await write(app, {
    'package.json': JSON.stringify({ name: 'web', type: 'module', dependencies: { kit: 'workspace:*' } }),
    'index.html': `<!doctype html><body><div id="root"></div><script type="module" src="/main.ts"></script>`,
    'main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './App'; mount('root', App);`,
    'App.tsx': `
      import { Badge, count, increment } from 'kit';
      import { shown } from 'kit/tabs';
      export function App() {
        return <main><p>{count}:{shown()}</p><Badge /><i onClick={increment}>inc</i></main>;
      }
    `,
  });
  await link('kit');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const viteConfig = () => ({
  root: app,
  configFile: false as const,
  logLevel: 'silent' as const,
  plugins: [memoizedDom({ clientEntry: './main.ts' })],
});

async function startAndStopDevServer(): Promise<void> {
  const server = await createServer({ ...viteConfig(), server: { middlewareMode: true } });
  await server.close();
}

/** Build the app, run it, click, and give what the page showed before and after. */
async function runBuiltApp(): Promise<{ before: string | null | undefined; after: string | null | undefined; badge: string | null | undefined }> {
  const entry = `app-${builds++}.js`;
  const outDir = join(app, 'built');
  await build({ ...viteConfig(), build: { outDir, minify: false, rollupOptions: { output: { entryFileNames: entry } } } });

  GlobalRegistrator.register({ url: 'http://localhost:3000' });

  try {
    document.body.innerHTML = '<div id="root"></div>';
    await import(pathToFileURL(join(outDir, entry)).href);
    const before = document.querySelector('p')?.textContent;
    (document.querySelector('i') as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { before, after: document.querySelector('p')?.textContent, badge: document.querySelector('button')?.textContent };
  } finally {
    await GlobalRegistrator.unregister();
  }
}

it('builds and runs from a fresh checkout, with nothing built and no exports written', async () => {
  expect(existsSync(join(kit, 'dist'))).toBe(false);
  expect(await runBuiltApp()).toEqual({ before: '1:tab1', after: '2:tab2', badge: '2:0' });
}, 120_000);

it('uses the source, not a dist left over from packaging', async () => {
  await buildLibrary({ root: kit });
  await write(kit, { 'src/store.ts': `export let count = 50; export function increment() { count++; }` });

  expect(await runBuiltApp()).toEqual({ before: '50:tab50', after: '51:tab51', badge: '51:0' });
}, 120_000);

it('shows an edit to a package file in the dev server, with no packaging step', async () => {
  const server = await createServer({ ...viteConfig(), server: { middlewareMode: true } });

  try {
    expect(server.config.optimizeDeps.exclude).toContain('kit');
    expect(server.environments.ssr!.config.resolve.noExternal).toContain('kit');

    const transformed = await server.transformRequest('/App.tsx');
    expect(transformed!.code).toContain('packages/kit/src/store.ts');

    const url = `/@fs/${kit.replaceAll('\\', '/')}/src/store.ts`;
    expect((await server.transformRequest(url))!.code).toContain('count = 1');

    await write(kit, { 'src/store.ts': `export let count = 77; export function increment() { count++; }` });

    let code = '';
    for (let attempt = 0; attempt < 100 && !code.includes('count = 77'); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      code = (await server.transformRequest(url))!.code;
    }

    expect(code).toContain('count = 77');
  } finally {
    await server.close();
  }
}, 60_000);

it('follows one linked package through another', async () => {
  await write(join(repo, 'packages/base'), {
    'package.json': JSON.stringify({ name: 'base', version: '1.0.0', type: 'module' }),
    '.lib.config.ts': `export default { entry: './src/index.ts', source: true, declarations: false };`,
    'src/index.ts': `export let count = 5; export function increment() { count++; }`,
  });
  await link('base');
  await write(kit, {
    'package.json': JSON.stringify({ name: 'kit', version: '1.0.0', type: 'module', dependencies: { base: 'workspace:*' } }),
    'src/store.ts': `export { count, increment } from 'base';`,
  });

  expect([...(await nativePackages(app)).names].sort()).toEqual(['base', 'kit']);
  expect(await runBuiltApp()).toEqual({ before: '5:tab5', after: '6:tab6', badge: '6:0' });
}, 120_000);

it('never runs the config of a package a package manager installed', async () => {
  const sentinel = join(repo, 'config-ran.txt').replaceAll('\\', '/');
  const trap = `
    import { writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(sentinel)}, 'ran');
    export default { entry: './index.ts', source: true };
  `;
  await write(app, {
    'package.json': JSON.stringify({ name: 'web', type: 'module', dependencies: { kit: 'workspace:*', trap: '*', stored: '*' } }),
    'node_modules/trap/package.json': JSON.stringify({ name: 'trap', version: '1.0.0' }),
    'node_modules/trap/.lib.config.ts': trap,
    'node_modules/trap/index.ts': `export const x = 1;`,
    // As pnpm lays one out: a symlink, whose real path is still inside `node_modules`.
    'node_modules/.pnpm/stored@1.0.0/node_modules/stored/package.json': JSON.stringify({ name: 'stored', version: '1.0.0' }),
    'node_modules/.pnpm/stored@1.0.0/node_modules/stored/.lib.config.ts': trap,
  });
  await symlink(join(app, 'node_modules/.pnpm/stored@1.0.0/node_modules/stored'), join(app, 'node_modules/stored'), 'junction');

  const found = await nativePackages(app);

  expect(existsSync(sentinel)).toBe(false);
  expect(found.names).toEqual(['kit']);
}, 60_000);

it('leaves a linked package alone unless it publishes source', async () => {
  await write(kit, { '.lib.config.ts': `export default { entry: './src/index.ts' };` });
  const found = await nativePackages(app);

  expect(found.names).toEqual([]);
  expect(found.linkedImports).toEqual([]);
}, 60_000);

it('names the package when a linked config is wrong', async () => {
  await write(kit, { '.lib.config.ts': `export default { entry: './src/missing.ts', source: true };` });
  await expect(nativePackages(app)).rejects.toThrow(/linked package 'kit'/);
}, 60_000);

it('gives TypeScript the public imports, so an editor sees the real types', async () => {
  await write(kit, {
    'src/index.ts': `export const count: number = 1; export default function main(): number { return 1; }`,
    'src/public/tabs.ts': `export function shown(): string { return 'tab'; }`,
  });
  await write(app, {
    'App.tsx': `export function App() { return <main />; }`,
    'check.ts': `
      import main, { count } from 'kit';
      import { shown } from 'kit/tabs';
      export const wrongCount: string = count;
      export const wrongShown: number = shown();
      export const wrongMain: string = main();
    `,
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, types: [], skipLibCheck: false },
      include: ['check.ts'],
    }),
  });

  await startAndStopDevServer();

  // Relative only, so the file means the same in any checkout and can be committed.
  expect(await readFile(join(kit, 'tabs.d.ts'), 'utf8')).toContain(`export * from "./src/public/tabs";`);

  const checked = Bun.spawnSync([process.execPath, 'check', '-p', 'tsconfig.json'], { cwd: app });
  const output = checked.stdout.toString() + checked.stderr.toString();

  // Found, with their real types: exactly the three deliberate mistakes are reported.
  expect(output.match(/code="TS\d+"/g)).toEqual(['code="TS2322"', 'code="TS2322"', 'code="TS2322"']);
}, 60_000);

it('removes the types of a public import that has gone, and no file of the author', async () => {
  await write(kit, { 'src/public/old.ts': `export const old = 1;`, 'src/public/kept.ts': `export const kept = 1;` });
  await startAndStopDevServer();
  expect(existsSync(join(kit, 'old.d.ts'))).toBe(true);

  await rm(join(kit, 'src/public/old.ts'));
  await rm(join(kit, 'src/public/kept.ts'));
  await write(kit, { 'kept.d.ts': `export const authored: string;` });
  await startAndStopDevServer();

  expect(existsSync(join(kit, 'old.d.ts'))).toBe(false);
  expect(await readFile(join(kit, 'kept.d.ts'), 'utf8')).toBe(`export const authored: string;`);
}, 60_000);

it('does not overwrite a declaration the author wrote at a public path', async () => {
  await write(kit, { 'tabs.d.ts': `export declare function shown(): string;` });
  await startAndStopDevServer();

  expect(await readFile(join(kit, 'tabs.d.ts'), 'utf8')).toBe(`export declare function shown(): string;`);
}, 60_000);

it('does not publish the generated type files', async () => {
  await startAndStopDevServer();
  expect(existsSync(join(kit, 'tabs.d.ts'))).toBe(true);

  const output = await buildLibrary({ root: kit });

  expect(existsSync(join(output, 'tabs.d.ts'))).toBe(false);
  expect(existsSync(join(output, 'src/public/tabs.ts'))).toBe(true);
}, 60_000);
