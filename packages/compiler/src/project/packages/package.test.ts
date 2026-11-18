/**
 * Packaging a native package (`package.ts`) and the command that runs it (`cli.ts package`), then
 * installing the result into an app that the project compiles: the whole path, with no bundler.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, fileSystemHost, packageLibrary } from '..';
import { parseArguments, run } from '../cli';

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'mmd-package-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));

let folders = 0;

function folder(files: Record<string, string>): string {
  const root = join(base, `case-${folders++}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const AUTHOR = {
  'package.json': JSON.stringify({
    name: 'kit', version: '1.2.3', type: 'module', sideEffects: false,
    scripts: { build: 'must-not-be-published' }, devDependencies: { typescript: '*' },
  }),
  '.lib.config.ts': `export default { entry: './src/index.ts', subpaths: ['./src/public'], source: true, declarations: false };`,
  'src/index.ts': `import './theme.css';\nexport { count, increment } from './store.js';\nexport { Badge } from './Badge';\n`,
  'src/store.ts': `export let count = 1;\nexport function increment() { count++; }\nexport function load() { return $fetch('/user'); }\n`,
  'src/Badge.tsx': `import { count } from './store';\nexport function Badge() { return <b>{count}</b>; }\n`,
  'src/theme.css': 'b { color: red; }\n',
  'src/public/tabs.ts': `import { count } from '../store';\nexport function shown() { return 'tab' + count; }\n`,
  'src/unused.ts': `export const secret = 'not public';\n`,
};

const quiet = () => {};

describe('packaging', () => {
  it('publishes what the public entries reach, and an app compiles it as its own', async () => {
    const author = folder(AUTHOR);
    const output = await packageLibrary({ root: author, log: quiet });
    const manifest = JSON.parse(readFileSync(join(output, 'package.json'), 'utf8'));

    expect(manifest['memoized-dom']).toEqual({ source: true });
    expect(manifest.exports).toEqual({ '.': { default: './src/index.ts' }, './tabs': { default: './src/public/tabs.ts' } });
    // Found from the compiled output: `$fetch` needs no import in the source.
    expect(manifest.peerDependencies).toEqual({ '@memoized-dom/runtime': '*', '@memoized-dom/data': '*' });
    expect(manifest.sideEffects).toEqual(['./src/theme.css']);
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(readFileSync(join(output, 'src/Badge.tsx'), 'utf8')).toBe(AUTHOR['src/Badge.tsx']);
    expect(existsSync(join(output, 'src/unused.ts'))).toBe(false);
    expect(existsSync(join(output, '.lib.config.ts'))).toBe(false);

    // Installed as a package manager would, the project finds and compiles it.
    const app = folder({
      'package.json': JSON.stringify({ name: 'app', dependencies: { kit: '1.2.3' } }),
      'src/App.tsx': `import { Badge } from 'kit';\nimport { shown } from 'kit/tabs';\nexport function App() { return <main><Badge />{shown()}</main>; }\n`,
    });
    cpSync(output, join(app, 'node_modules', 'kit'), { recursive: true });
    const build = await createProject({ entries: ['./src/App.tsx'], host: fileSystemHost(app) }).build();
    expect(build.ok).toBe(true);
    expect(build.modules).toContain('./node_modules/kit/src/store.ts');
  });

  it.each([
    ['a dependency it does not list', { 'src/index.ts': `export { x } from 'not-listed';` }, /not listed/],
    ['a file that does not exist', { 'src/index.ts': `export { x } from './missing';` }, /does not exist/],
    ['an import only this project understands', { 'src/index.ts': `export { x } from '#local';` }, /relative import/],
    ['compiled output options', { '.lib.config.ts': `export default { entry: './src/index.ts', source: true, minify: false };` }, /compiled output/],
    ['a config without source: true', { '.lib.config.ts': `export default { entry: './src/index.ts' };` }, /add source: true/],
  ])('stops at %s', async (_name, files, message) => {
    const author = folder({ ...AUTHOR, ...files });
    await expect(packageLibrary({ root: author, log: quiet })).rejects.toThrow(message);
  });
});

describe('cli.ts package', () => {
  it('parses its options and packages the folder', async () => {
    const author = folder(AUTHOR);
    expect(parseArguments(['package', '--root', author], base)).toEqual({ name: 'package', root: author });
    expect(parseArguments(['package', '--out', 'x'], base)).toContain('unknown or incomplete option');

    const lines: string[] = [];
    const command = parseArguments(['package', '--root', author], base);
    if (typeof command === 'string') throw new Error(command);
    expect(await run(command, (line) => lines.push(line))).toBe(0);
    expect(lines.join('\n')).toContain('packaged kit (2 public entries)');
    expect(existsSync(join(author, 'dist', 'package.json'))).toBe(true);
  });
});
