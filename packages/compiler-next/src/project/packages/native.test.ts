/**
 * Native packages in a project (`wiki/compiler/linking.md`, "Native packages"): the project, not a
 * bundler plugin, finds them and compiles their source, so Vite, Bun and the command line agree.
 * Each test writes a real folder, with `node_modules` as a package manager leaves it.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, fileSystemHost, nativePackages, readLibraryConfig } from '..';
import { memoizedDom } from '../bun';

// By its real name, as package files come back (Windows spells the temp folder short).
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'mmd-native-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let folders = 0;

/** A fresh folder with these files, written as given. */
function folder(files: Record<string, string>): string {
  const root = join(base, `case-${folders++}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const manifest = (fields: object) => JSON.stringify(fields);

/** An installed native package, as `memoized-dom package` publishes one. */
function installedKit(at: string, label = 'kit'): Record<string, string> {
  return {
    [`${at}/package.json`]: manifest({
      name: 'kit', version: '1.0.0', type: 'module',
      exports: { '.': { types: './index.d.ts', default: './src/index.ts' }, './tabs': { default: './src/tabs.tsx' } },
      'memoized-dom': { source: true },
    }),
    [`${at}/src/index.ts`]: `export { Counter, bump } from './counter';\n`,
    [`${at}/src/counter.tsx`]: `
export let count = 0;
export function bump() { count++; }
export function Counter() { return <output>${label} {count}</output>; }
`,
    [`${at}/src/tabs.tsx`]: `import { count } from './counter';\nexport function Tabs() { return <nav>{count}</nav>; }\n`,
  };
}

const APP = `
import { Counter, bump } from 'kit';
import { Tabs } from 'kit/tabs';
import { format } from 'plain';
export function App() { return <main onClick={bump}><Counter /><Tabs />{format('x')}</main>; }
`;

const PLAIN = {
  'node_modules/plain/package.json': manifest({ name: 'plain', version: '1.0.0', main: './index.js' }),
  'node_modules/plain/index.js': 'export function format(text) { return text; }\n',
};

async function build(root: string, entry = './src/App.tsx') {
  const result = await createProject({ entries: [entry], host: fileSystemHost(root) }).build();
  if (!result.ok) throw result.error;
  return result;
}

describe('an installed native package', () => {
  it('compiles in the app\'s graph, one module per file whichever public import reaches it', async () => {
    const root = folder({
      'package.json': manifest({ name: 'app', dependencies: { kit: '1.0.0', plain: '1.0.0' } }),
      'src/App.tsx': APP,
      ...installedKit('node_modules/kit'),
      ...PLAIN,
    });

    const result = await build(root);

    expect([...result.modules].sort()).toEqual([
      './node_modules/kit/src/counter.tsx',
      './node_modules/kit/src/index.ts',
      './node_modules/kit/src/tabs.tsx',
      './src/App.tsx',
    ]);
    // The package's component is compiled like the app's own: a template, not a JSX call.
    expect(result.output['./node_modules/kit/src/counter.tsx']).toContain('createTemplateCache');
    // An ordinary package stays an import the bundler loads, opaque.
    expect(result.output['./src/App.tsx']).toContain("from 'plain'");
  });

  it('never reads a config shipped inside node_modules, and an unmarked package stays ordinary', async () => {
    const trap = `export default computeConfig();\n`;
    const root = folder({
      'package.json': manifest({ name: 'app', dependencies: { trap: '1.0.0' } }),
      'src/App.tsx': `import { trap } from 'trap';\nexport function App() { return <p>{trap}</p>; }\n`,
      'node_modules/trap/package.json': manifest({ name: 'trap', version: '1.0.0', exports: './src/index.ts' }),
      'node_modules/trap/.lib.config.ts': trap,
      'node_modules/trap/src/index.ts': 'export const trap = 1;\n',
    });

    const result = await build(root);

    expect([...result.modules]).toEqual(['./src/App.tsx']);
    expect(nativePackages(root).names).toEqual([]);
  });

  it('keeps two installed copies apart: each is its own module, with its own state', async () => {
    const root = folder({
      'package.json': manifest({ name: 'app', dependencies: { kit: '1.0.0', panel: '1.0.0' } }),
      'src/App.tsx': `
import { Counter } from 'kit';
import { Panel } from 'panel';
export function App() { return <main><Counter /><Panel /></main>; }
`,
      ...installedKit('node_modules/kit', 'top'),
      'node_modules/panel/package.json': manifest({
        name: 'panel', version: '1.0.0', exports: { '.': './src/index.tsx' }, dependencies: { kit: '2.0.0' }, 'memoized-dom': { source: true },
      }),
      'node_modules/panel/src/index.tsx': `import { Counter } from 'kit';\nexport function Panel() { return <aside><Counter /></aside>; }\n`,
      ...installedKit('node_modules/panel/node_modules/kit', 'nested'),
    });

    const result = await build(root);

    expect(result.modules).toContain('./node_modules/kit/src/counter.tsx');
    expect(result.modules).toContain('./node_modules/panel/node_modules/kit/src/counter.tsx');
    expect([...nativePackages(root).names].sort()).toEqual(['kit', 'panel']);
  });
});

describe('a package linked from the workspace', () => {
  it('compiles from its source, through its config, with nothing built', async () => {
    const workspace = folder({
      'kit/package.json': manifest({ name: 'kit', version: '1.0.0', type: 'module' }),
      'kit/.lib.config.ts': `import type { LibraryConfig } from 'x';\nconst config = { entry: './src/index.ts', subpaths: ['./src/public'], source: true };\nexport default config satisfies LibraryConfig;\n`,
      'kit/src/index.ts': `export { Counter, bump } from './counter';\n`,
      'kit/src/counter.tsx': installedKit('x')['x/src/counter.tsx']!,
      'kit/src/public/tabs.tsx': `import { count } from '../counter';\nexport function Tabs() { return <nav>{count}</nav>; }\n`,
      // A stale build must not be what the app compiles.
      'kit/dist/index.js': 'export const stale = true;\n',
      'app/package.json': manifest({ name: 'app', dependencies: { kit: 'workspace:*', plain: '1.0.0' } }),
      'app/src/App.tsx': APP,
      ...Object.fromEntries(Object.entries(PLAIN).map(([path, text]) => [`app/${path}`, text])),
    });
    const app = join(workspace, 'app');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    // As a workspace install links it: a junction, which Windows creates without privileges.
    symlinkSync(join(workspace, 'kit'), join(app, 'node_modules', 'kit'), 'junction');

    const result = await build(app);

    expect([...result.modules].sort()).toEqual([
      '../kit/src/counter.tsx',
      '../kit/src/index.ts',
      '../kit/src/public/tabs.tsx',
      './src/App.tsx',
    ]);
    expect(result.output['../kit/src/counter.tsx']).toContain('createTemplateCache');

    const found = nativePackages(app);
    expect(found.names).toEqual(['kit']);
    expect(found.linkedDirectories).toEqual([join(workspace, 'kit')]);
    expect(found.linkedImports.map((linked) => linked.specifier).sort()).toEqual(['kit', 'kit/tabs']);
  });

  it('names the package when its config is wrong, since the app is where the error shows', () => {
    const workspace = folder({
      'kit/package.json': manifest({ name: 'kit', version: '1.0.0', type: 'module' }),
      'kit/.lib.config.ts': `export default { entry: './src/missing.ts', source: true };\n`,
      'app/package.json': manifest({ name: 'app', dependencies: { kit: 'workspace:*' } }),
    });
    const app = join(workspace, 'app');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(join(workspace, 'kit'), join(app, 'node_modules', 'kit'), 'junction');

    expect(() => nativePackages(app)).toThrow("linked package 'kit': entry './src/missing.ts' must be a source file of the package");
  });
});

describe('reading .lib.config.ts', () => {
  it('reads a literal object, through satisfies, as or a const', () => {
    expect(readLibraryConfig(`export default { entry: './src/index.ts', source: true, subpaths: ['./src/public'] } satisfies X;`, 'c.ts'))
      .toEqual({ entry: './src/index.ts', source: true, subpaths: ['./src/public'] });
    expect(readLibraryConfig(`const c = { entry: \`./a.ts\`, declarations: { tsconfig: './t.json' } } as const;\nexport default c;`, 'c.ts'))
      .toEqual({ entry: './a.ts', declarations: { tsconfig: './t.json' } });
  });

  it('refuses what it would have to run, and says it is never run', () => {
    expect(() => readLibraryConfig(`export default { entry: resolve('./a.ts') };`, 'c.ts')).toThrow('is read, never run');
    expect(() => readLibraryConfig(`export default { source: true };`, 'c.ts')).toThrow('must specify entry');
    expect(() => readLibraryConfig(`export const config = {};`, 'c.ts')).toThrow('has no default export');
  });
});

describe('the Bun plugin', () => {
  it('bundles an installed native package compiled, not as the source it ships', async () => {
    const root = folder({
      'package.json': manifest({ name: 'app', dependencies: { kit: '1.0.0', plain: '1.0.0' } }),
      'src/App.tsx': APP,
      ...installedKit('node_modules/kit'),
      ...PLAIN,
    });

    const result = await Bun.build({
      entrypoints: [join(root, 'src/App.tsx')],
      plugins: [memoizedDom({ client: './src/App.tsx', root })],
      external: ['@memoized-dom/*'],
      throw: false,
    });

    expect(result.logs.map((log) => String(log.message))).toEqual([]);
    const code = await result.outputs.find((output) => output.path.endsWith('.js'))!.text();
    // The package's component, compiled: its template, and its id named by its project path.
    expect(code).toContain('createTemplateCache([["output"');
    expect(code).toContain('"./node_modules/kit/src/counter.tsx#Counter"');
    expect(code).not.toContain('jsx(');
  });
});
