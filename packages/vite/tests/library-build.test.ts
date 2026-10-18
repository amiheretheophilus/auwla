import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { experimentalVerifyPackageIntegrity } from '@memoized-dom/compiler';
import { buildLibrary } from '../src/library-build';
import { discoverPackageArtifact } from '../src/graph/package-artifacts';

const repository = resolve(import.meta.dirname, '../../..');
const run = promisify(execFile);
let root: string;
async function files(entries: Record<string, string>): Promise<void> {
  for (const [name, source] of Object.entries(entries)) {
    const file = join(root, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, source);
  }
}
const json = async (path: string) => JSON.parse(await readFile(join(root, path), 'utf8'));
beforeEach(async () => {
  const parent = join(import.meta.dirname, 'fixtures/out'); await mkdir(parent, { recursive: true });
  root = await mkdtemp(join(parent, 'library-'));
  await files({
    'package.json': JSON.stringify({ name: 'fixture-library', version: '1.2.3', type: 'module', description: 'Publishing fixture',
      exports: { '.': './old-output.js' }, files: ['old-output'], scripts: { build: 'must-not-publish' }, devDependencies: { tool: '*' } }),
    '.lib.config.ts': `export default {entry:'./src/index.ts',subpaths:['./src/public','./src/components'],sourcemap:true};`,
    'src/index.ts': `export * from './helpers';export {Badge} from './Badge';`,
    'src/helpers.ts': 'export function add(state:{count:number},amount:number):void{state.count+=amount}',
    'src/Badge.tsx': 'export function Badge({label}:{label:string}){return <b>{label}</b>}',
    'src/public/forms/index.ts': `export {add as change} from '../../helpers';`,
    'src/components/button.tsx': `export function Button({title}:{title:string}){return <button>{title}</button>}`,
    'src/components/only-types.d.ts': 'export interface NotAnEntry {value:string}',
    'src/private/secret.ts': 'throw new Error("PRIVATE_SOURCE_MUST_NOT_LOAD");',
    'vite.config.ts': 'throw new Error("VITE_CONFIG_MUST_NOT_LOAD");',
    'README.md': '# Fixture library',
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('builds root and directory subpaths without editing source or loading Vite config', async () => {
  const sourceManifest = await readFile(join(root, 'package.json'), 'utf8'), sourceEntry = await readFile(join(root, 'src/index.ts'), 'utf8');
  const result = await run('node', [join(repository, 'packages/vite/dist/cli.js'), 'package', '--root', root], { cwd: repository, windowsHide: true, timeout: 60_000 });
  expect(result.stdout).toContain('3 public entries');
  const manifest = await json('dist/package.json');
  expect(Object.keys(manifest.exports)).toEqual(['.', './forms', './button']);
  expect(manifest).toMatchObject({ name: 'fixture-library', version: '1.2.3', description: 'Publishing fixture', type: 'module', 'memoized-dom': { artifact: './memoized-dom.package.json', integrity: true } });
  for (const key of ['scripts', 'devDependencies', 'files']) expect(manifest[key]).toBeUndefined();
  expect(manifest.exports['./forms'].import).toBe('./entries/forms.js');
  expect(manifest.peerDependencies['@memoized-dom/runtime']).toBe('*');
  const artifact = await json('dist/memoized-dom.package.json');
  expect(Object.keys(artifact.entries)).toEqual(['fixture-library', 'fixture-library/forms', 'fixture-library/button']);
  expect(artifact.entries['fixture-library'].functions.add.parameterWrites).toEqual([{ index: 0, path: ['count'] }]);
  expect(artifact.entries['fixture-library'].components.Badge).toBeDefined();
  expect(artifact.entries['fixture-library/forms'].functions.change).toBeDefined();
  expect(await experimentalVerifyPackageIntegrity(artifact, join(root, 'dist'))).not.toHaveLength(0);
  expect((await discoverPackageArtifact(join(root, 'dist/index.js'), 'fixture-library', join(root, 'consumer.tsx')))?.manifestFile).toBe(join(root, 'dist/package.json'));
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(sourceManifest);
  expect(await readFile(join(root, 'src/index.ts'), 'utf8')).toBe(sourceEntry);
  expect(await readFile(join(root, 'dist/README.md'), 'utf8')).toBe('# Fixture library');
  expect(existsSync(join(root, 'dist/src/private'))).toBe(false);
  expect((await readdir(join(root, '.memoized'))).filter(name => name.startsWith('library-'))).toEqual([]);
  const map = await json('dist/index.js.map');
  expect(map.sources.some((source: string) => source.includes('src/Badge.tsx'))).toBe(true);
  expect(map.sources.some((source: string) => source.includes('.memoized'))).toBe(false);
  expect(map.sourcesContent.join('\n')).toContain('export function Badge');
  await files({
    'consumer/tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, strict: true, module: 'Preserve', moduleResolution: 'Bundler', jsx: 'preserve', skipLibCheck: true, types: ['@memoized-dom/compiler/jsx'] }, files: ['types.tsx'] }),
    'consumer/types.tsx': `import {Badge,add} from '../dist/index.js';import {Button} from '../dist/entries/button.js';import {change} from '../dist/entries/forms.js';
      const state={count:1};add(state,2);change(state,1);const a=<Badge label="ok"/>;const b=<Button title="ok"/>;void a;void b;
      // @ts-expect-error public props remain authored types
      const bad=<Badge label={3}/>;void bad;`,
  });
  await run('bun', ['check', '-p', 'consumer/tsconfig.json'], { cwd: root, windowsHide: true, timeout: 30_000 });
}, 90_000);

it('supports minimal JavaScript configuration without declarations or a public subpath registry', async () => {
  await files({ '.lib.config.ts': `export default {entry:'./src/index.js',declarations:false};`, 'src/index.js': 'export function identity(value){return value;}' });
  await buildLibrary({ root });
  expect(Object.keys((await json('dist/package.json')).exports)).toEqual(['.']);
  expect((await json('dist/package.json')).types).toBeUndefined();
  expect(existsSync(join(root, 'dist/index.d.ts'))).toBe(false);
});

it.each([
  ['duplicate', 'src/public/button.ts', 'public path conflict'],
  ['directory index', 'src/public/button/index.ts', 'public path conflict'],
  ['case-only', 'src/public/Button.ts', 'public path conflict'],
])('rejects %s subpath conflicts before changing an existing output', async (_name, file, message) => {
  await files({ [file]: 'export function other(){return 1}', 'dist/previous.txt': 'keep' });
  await expect(buildLibrary({ root })).rejects.toThrow(message);
  expect(await readFile(join(root, 'dist/previous.txt'), 'utf8')).toBe('keep');
});

it.each(['.', '../outside', 'src', 'node_modules/build', '.memoized/build'])('rejects unsafe/overlapping outDir %s', async outDir => {
  await files({ '.lib.config.ts': `export default {entry:'./src/index.ts',outDir:${JSON.stringify(outDir)}};` });
  await expect(buildLibrary({ root })).rejects.toThrow('outDir');
  expect(await readFile(join(root, 'src/index.ts'), 'utf8')).toContain('export *');
});

it('rejects a symlinked public directory without following it', async () => {
  await symlink(join(root, 'src/components'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await files({ '.lib.config.ts': `export default {entry:'./src/index.ts',subpaths:['./linked']};` });
  await expect(buildLibrary({ root })).rejects.toThrow('symbolic link');
});

it('preserves the previous build after a source or declaration error and recovers', async () => {
  await buildLibrary({ root });
  const previous = await readFile(join(root, 'dist/memoized-dom.package.json'), 'utf8');
  await files({ 'src/helpers.ts': 'export function add( {' });
  await expect(buildLibrary({ root })).rejects.toThrow();
  expect(await readFile(join(root, 'dist/memoized-dom.package.json'), 'utf8')).toBe(previous);
  await files({ 'src/helpers.ts': 'export function add(state:{count:number},amount:string):void{state.count+=amount}' });
  await expect(buildLibrary({ root })).rejects.toThrow('declaration emit failed');
  expect(await readFile(join(root, 'dist/memoized-dom.package.json'), 'utf8')).toBe(previous);
  await files({ 'src/helpers.ts': 'export function add(state:{count:number},amount:number):void{state.count+=amount}' });
  await buildLibrary({ root });
  expect(await experimentalVerifyPackageIntegrity(await json('dist/memoized-dom.package.json'), join(root, 'dist'))).not.toHaveLength(0);
}, 90_000);

it('resolves local aliases from the library config in code and declarations', async () => {
  await files({ '.lib.config.ts': `export default {entry:'./src/index.ts',aliases:{'@local':'./src'}};`, 'src/index.ts': `export {add} from '@local/helpers';` });
  await buildLibrary({ root });
  expect((await json('dist/memoized-dom.package.json')).entries['fixture-library'].functions.add).toBeDefined();
  expect(await readFile(join(root, 'dist/index.js'), 'utf8')).not.toContain('@local');
  expect(await readFile(join(root, 'dist/.types/src/index.d.ts'), 'utf8')).not.toContain('@local');
  await files({
    'consumer/tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, strict: true, module: 'Preserve', moduleResolution: 'Bundler', types: [] }, files: ['alias.ts'] }),
    'consumer/alias.ts': `import {add} from '../dist/index.js';add({count:1},2);
      // @ts-expect-error source alias is not required by the consumer and the signature stays strict
      add({count:'wrong'},2);`,
  });
  await run('bun', ['check', '-p', 'consumer/tsconfig.json'], { cwd: root, windowsHide: true, timeout: 30_000 });
});

it('uses the package override in a custom library config without proprietary manifest edits', async () => {
  await files({ 'custom.lib.ts': `export default {entry:'./src/helpers.ts',declarations:false,package:{name:'renamed-library',version:'2.0.0'}};` });
  await buildLibrary({ root, config: 'custom.lib.ts' });
  expect((await json('dist/package.json')).name).toBe('renamed-library');
  expect((await json('dist/memoized-dom.package.json')).entries['renamed-library'].functions.add).toBeDefined();
});

it('requires an array for subpaths and never loads an application Vite config as fallback', async () => {
  await files({ '.lib.config.ts': `export default {entry:'./src/index.ts',subpaths:'./src/public'};` });
  await expect(buildLibrary({ root })).rejects.toThrow('subpaths must be an array');
  await rm(join(root, '.lib.config.ts'));
  await expect(buildLibrary({ root })).rejects.toThrow('missing');
});

it('handles star diamonds, explicit overrides and ambiguous names without partial metadata', async () => {
  await files({
    '.lib.config.ts': `export default {entry:'./src/index.ts',declarations:false};`,
    'src/shared.ts': 'export function shared(){return 1}',
    'src/a.ts': `export {shared} from './shared';export function collision(){return 1}`,
    'src/b.ts': `export {shared} from './shared';export function collision(){return 2}`,
    'src/index.ts': `export * from './a';export * from './b';export {shared as renamed} from './shared';`,
  });
  await buildLibrary({ root });
  const functions = (await json('dist/memoized-dom.package.json')).entries['fixture-library'].functions;
  expect(Object.keys(functions).sort()).toEqual(['renamed', 'shared']);
  await files({ 'src/index.ts': `export * from './a';export * from './b';export {collision} from './a';` });
  await buildLibrary({ root });
  expect(Object.keys((await json('dist/memoized-dom.package.json')).entries['fixture-library'].functions).sort()).toEqual(['collision', 'shared']);
});

it('publishes extracted CSS as an importable side-effect entry without exposing private chunks', async () => {
  await files({
    '.lib.config.ts': `export default {entry:'./src/index.ts',declarations:false};`,
    'src/index.ts': `import './styles.css';export {Badge} from './Badge';`,
    'src/styles.css': '.fixture { color: red; }',
  });
  await buildLibrary({ root });
  expect((await json('dist/package.json')).exports['./style.css']).toBe('./style.css');
  expect(await readFile(join(root, 'dist/style.css'), 'utf8')).toContain('red');
});

it('uses authored ambient declarations from the selected tsconfig', async () => {
  await files({
    '.lib.config.ts': `export default {entry:'./src/index.ts'};`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler', jsx: 'preserve', skipLibCheck: true }, include: ['src'] }),
    'src/globals.d.ts': 'interface LibraryAmbient { title: string }',
    'src/index.ts': 'export function title(value:LibraryAmbient):string{return value.title}',
  });
  await buildLibrary({ root });
  expect(await readFile(join(root, 'dist/.types/src/index.d.ts'), 'utf8')).toContain('LibraryAmbient');
  expect(existsSync(join(root, 'dist/.types/src/globals.d.ts'))).toBe(true);
  await files({
    'consumer/tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, strict: true, module: 'Preserve', moduleResolution: 'Bundler', types: [] }, files: ['ambient.ts'] }),
    'consumer/ambient.ts': `import {title} from '../dist/index.js';title({title:'ok'});
      // @ts-expect-error ambient type remains present and strict after publication
      title({title:3});`,
  });
  await run('bun', ['check', '-p', 'consumer/tsconfig.json'], { cwd: root, windowsHide: true, timeout: 30_000 });
});

it('relocates inherited JSONC tsconfig paths including type-only imports', async () => {
  await files({
    '.lib.config.ts': `export default {entry:'./src/index.ts'};`,
    'tsconfig.base.json': `{// inherited paths are compiler input, not a Vite config\n"compilerOptions":{"module":"Preserve","moduleResolution":"Bundler","jsx":"preserve","skipLibCheck":true,"paths":{"@models/*":["./src/models/*"],},},}`,
    'tsconfig.json': `{"extends":"./tsconfig.base.json","include":["src"]}`,
    'src/models/model.ts': 'export interface Model {title:string}',
    'src/index.ts': `import type {Model} from '@models/model';export function title(value:Model):string{return value.title}export type Alias=import('@models/model').Model;`,
  });
  await buildLibrary({ root });
  expect(await readFile(join(root, 'dist/.types/src/index.d.ts'), 'utf8')).not.toContain('@models');
  await files({
    'consumer/tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, strict: true, module: 'Preserve', moduleResolution: 'Bundler', types: [] }, files: ['alias.ts'] }),
    'consumer/alias.ts': `import {title,type Alias} from '../dist/index.js';const row:Alias={title:'ok'};title(row);
      // @ts-expect-error original path aliases must not be needed or turn public types into any
      title({title:3});`,
  });
  await run('bun', ['check', '-p', 'consumer/tsconfig.json'], { cwd: root, windowsHide: true, timeout: 30_000 });
});

it('converts import-only workspace dependencies to published ranges without modifying the source manifest', async () => {
  const manifest = JSON.stringify({ name: 'fixture-library', version: '1.2.3', private: true, peerDependencies: { 'import-only-peer': 'workspace:^' } });
  await files({
    'package.json': manifest,
    '.lib.config.ts': `export default {entry:'./src/helpers.ts',declarations:false};`,
    'node_modules/import-only-peer/package.json': JSON.stringify({ name: 'import-only-peer', version: '4.5.6', exports: { '.': { import: './index.js' } } }),
    'node_modules/import-only-peer/index.js': 'export const value=1;',
  });
  await buildLibrary({ root });
  expect((await json('dist/package.json')).peerDependencies['import-only-peer']).toBe('^4.5.6');
  expect((await json('dist/package.json')).private).toBe(true);
  expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(manifest);
});

it('retains authored default-export types without requiring a manual export list', async () => {
  await files({
    '.lib.config.ts': `export default {entry:'./src/index.ts'};`,
    'src/index.ts': 'export default function identify(value:number):number{return value}',
  });
  await buildLibrary({ root });
  expect((await json('dist/memoized-dom.package.json')).entries['fixture-library'].functions.default).toBeDefined();
  await files({
    'consumer/tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, strict: true, module: 'Preserve', moduleResolution: 'Bundler', types: [] }, files: ['default.ts'] }),
    'consumer/default.ts': `import identify from '../dist/index.js';identify(1);
      // @ts-expect-error default export retains its authored type
      identify('wrong');`,
  });
  await run('bun', ['check', '-p', 'consumer/tsconfig.json'], { cwd: root, windowsHide: true, timeout: 30_000 });
});
