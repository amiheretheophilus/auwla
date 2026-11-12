import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileModules } from '../pipeline';
import { createProject, fileSystemHost, projectPath, type ProjectHost } from '.';

/** A host over an editable set of files, counting the reads of each path. */
function memoryHost(files: Record<string, string>, resolve?: ProjectHost['resolve']) {
  const reads = new Map<string, number>();
  const host: ProjectHost = {
    readFile(path) {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return files[path];
    },
    ...(resolve === undefined ? {} : { resolve }),
  };
  return { host, files, reads };
}

const APP = `
import { Title } from './Title';
import type { Props } from './types';
import './styles.css';
import { format } from 'some-package';
export function App(props: Props) { return <main><Title text={format(props.name)} /></main>; }
`;
const TITLE = `export function Title({ text }: { text: string }) { return <h1>{text}</h1>; }`;

describe('building', () => {
  it('compiles the source modules its entries reach, leaving packages, styles and types out', async () => {
    const { host } = memoryHost({
      './src/App.tsx': APP,
      './src/Title.tsx': TITLE,
      './src/types.ts': 'export interface Props { name: string }',
      './src/styles.css': 'main {}',
      './src/Unused.tsx': 'export const unused = 1;',
    });

    const build = await createProject({ entries: ['./src/App.tsx'], host }).build();

    expect(build.ok).toBe(true);
    expect([...build.modules].sort()).toEqual(['./src/App.tsx', './src/Title.tsx']);
    if (!build.ok) return;
    expect(build.output['./src/App.tsx']).toContain("import './styles.css'");
    expect(build.output['./src/App.tsx']).toContain("from 'some-package'");
  });

  it('gives the output compileModules gives for the same modules', async () => {
    const { host } = memoryHost({ './App.tsx': APP, './Title.tsx': TITLE, './types.ts': '' });
    const build = await createProject({ entries: ['App.tsx'], host }).build();

    const expected = compileModules({ './App.tsx': APP, './Title.tsx': TITLE }, { entries: ['./App.tsx'] });
    expect(build.ok && build.output).toEqual(expected);
  });

  it('follows import() of a literal, re-exports and import-require', async () => {
    const { host } = memoryHost({
      './main.ts': `export * from './a'; export { b } from './b'; const page = () => import('./page');`,
      './a.ts': 'export const a = 1;',
      './b.ts': 'import c = require("./c"); export const b = c;',
      './c.ts': 'export = 3;',
      './page.tsx': 'export default function Page() { return <p />; }',
    });
    const build = await createProject({ entries: ['./main.ts'], host }).build();
    expect([...build.modules].sort()).toEqual(['./a.ts', './b.ts', './c.ts', './main.ts', './page.tsx']);
  });

  it("asks the host first, which is how a bundler's path aliases resolve", async () => {
    const { host } = memoryHost(
      { './src/App.tsx': `import { Title } from '~/Title'; export function App() { return <Title text="x" />; }`, './src/Title.tsx': TITLE },
      (specifier) => (specifier.startsWith('~/') ? `./src/${specifier.slice(2)}.tsx` : undefined),
    );
    const build = await createProject({ entries: ['./src/App.tsx'], host }).build();
    expect(build.ok).toBe(true);
    expect([...build.modules].sort()).toEqual(['./src/App.tsx', './src/Title.tsx']);
  });

  it('reports a compile error with its module instead of throwing', async () => {
    const { host } = memoryHost({ './App.tsx': `import './Broken'; export const x = 1;`, './Broken.tsx': 'export const = ;' });
    const build = await createProject({ entries: ['./App.tsx'], host }).build();
    expect(build.ok).toBe(false);
    if (build.ok) return;
    expect(build.error.path).toBe('./Broken.tsx');
  });

  it('gives source maps back to the authored files when asked', async () => {
    const { host } = memoryHost({ './App.tsx': APP, './Title.tsx': TITLE, './types.ts': '' });
    const build = await createProject({ entries: ['./App.tsx'], host, sourceMaps: true }).build();
    expect(build.ok && Object.keys(build.maps!).sort()).toEqual(['./App.tsx', './Title.tsx']);
    expect(build.ok && build.maps!['./Title.tsx']!.sourcesContent).toEqual([TITLE]);
  });

  it('reports an entry with no file', async () => {
    const { host } = memoryHost({});
    const build = await createProject({ entries: ['./main.tsx'], host }).build();
    expect(!build.ok && build.error.message).toContain('no file at this entry');
  });
});

describe('updating', () => {
  it('reads only the edited file again, and names the outputs that changed', async () => {
    const { host, files, reads } = memoryHost({ './App.tsx': APP, './Title.tsx': TITLE, './types.ts': '' });
    const project = createProject({ entries: ['./App.tsx'], host });
    await project.build();
    reads.clear();

    files['./Title.tsx'] = TITLE.replace('h1', 'h2').replace('h1', 'h2');
    const update = await project.update(['./Title.tsx']);

    expect([...reads.keys()]).toEqual(['./Title.tsx']);
    expect(update.changed).toEqual(['./Title.tsx']);
    expect(update.removed).toEqual([]);
  });

  it('finds a new file an import named before it existed', async () => {
    const { host, files } = memoryHost({ './App.tsx': `import { page } from './page'; export const app = page;` });
    const project = createProject({ entries: ['./App.tsx'], host });
    expect((await project.build()).modules).toEqual(['./App.tsx']);

    files['./page.ts'] = 'export const page = 1;';
    const update = await project.update(['./page.ts']);
    // App changes too: its import now names a compiled module, which it reads through.
    expect([...update.changed].sort()).toEqual(['./App.tsx', './page.ts']);
    expect([...update.build.modules].sort()).toEqual(['./App.tsx', './page.ts']);
  });

  it('falls back to the folder index when the file an import found is deleted', async () => {
    const { host, files } = memoryHost({
      './App.tsx': `import { page } from './page'; export const app = page;`,
      './page.ts': 'export const page = 1;',
      './page/index.ts': 'export const page = 2;',
    });
    const project = createProject({ entries: ['./App.tsx'], host });
    await project.build();

    delete files['./page.ts'];
    const update = await project.update(['./page.ts']);
    expect([...update.build.modules].sort()).toEqual(['./App.tsx', './page/index.ts']);
    expect(update.removed).toEqual(['./page.ts']);
  });

  it('builds again once an error is fixed, comparing with the last build that compiled', async () => {
    const { host, files } = memoryHost({ './App.tsx': TITLE });
    const project = createProject({ entries: ['./App.tsx'], host });
    await project.build();

    files['./App.tsx'] = 'export function Title( {';
    expect((await project.update(['./App.tsx'])).build.ok).toBe(false);

    files['./App.tsx'] = TITLE.replace('h1', 'h3').replace('h1', 'h3');
    const fixed = await project.update(['./App.tsx']);
    expect(fixed.build.ok).toBe(true);
    expect(fixed.changed).toEqual(['./App.tsx']);
  });
});

describe('fileSystemHost', () => {
  it('reads a folder on disk by project paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'compiler-next-project-'));
    mkdirSync(join(root, 'src', 'Title'), { recursive: true });
    writeFileSync(join(root, 'src', 'App.tsx'), `import { Title } from './Title'; export function App() { return <Title text="x" />; }`);
    writeFileSync(join(root, 'src', 'Title', 'index.tsx'), TITLE);

    const build = await createProject({ entries: ['src/App.tsx'], host: fileSystemHost(root) }).build();
    rmSync(root, { recursive: true, force: true });

    expect(build.ok).toBe(true);
    expect([...build.modules].sort()).toEqual(['./src/App.tsx', './src/Title/index.tsx']);
    expect(projectPath(root, join(root, 'src', 'App.tsx'))).toBe('./src/App.tsx');
  });
});
