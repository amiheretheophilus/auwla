import { afterEach, beforeEach, expect, it } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  experimentalCompilePackage, experimentalFinalizePackage, experimentalPackageArtifactInstance,
  experimentalVerifyPackageIntegrity, validateExperimentalPackageArtifact,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';

let root: string;
const roots: string[] = [];
let artifact: ExperimentalPackageArtifact;
let manifest: Record<string, unknown>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mmd-package-integrity-')); roots.push(root);
  const compiled = experimentalCompilePackage({
    './index.ts': 'export function bump(state:{count:number}){state.count++;}',
    './status.ts': 'export function ready(value:boolean){return value;}',
  }, { packageEntries: { 'integrity-ui': './index.ts', 'integrity-ui/status': './status.ts' } });
  artifact = compiled.artifact;
  manifest = { name: 'integrity-ui', version: '0.0.0', type: 'module', sideEffects: false,
    'memoized-dom': { artifact: './dist/artifact.json', integrity: true },
    peerDependencies: { framework: 'workspace:*' }, exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './status': { browser: './dist/status.browser.js', node: './dist/status.node.js' },
    } };
  await mkdir(join(root, 'dist/chunks'), { recursive: true });
  for (const [file, value] of Object.entries({
    'package.json': JSON.stringify(manifest), 'dist/index.js': compiled.output['./index.ts']!,
    'dist/status.browser.js': compiled.output['./status.ts']!, 'dist/status.node.js': compiled.output['./status.ts']!,
    'dist/chunks/shared.js': 'export const message="Hello 🌍 世界";', 'dist/index.d.ts': 'export declare function bump(state:{count:number}):void;',
  })) await writeFile(join(root, file), value);
});
afterEach(async () => { for (const directory of roots.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('finalizes deterministic final bytes, preserves semantic identity, and survives relocation', async () => {
  const sealed = await experimentalFinalizePackage(artifact, { packageRoot: root });
  expect(Object.keys(sealed.integrity!.files)).toEqual([
    'dist/chunks/shared.js', 'dist/index.js', 'dist/status.browser.js', 'dist/status.node.js',
  ]);
  expect(sealed.integrity!.files['dist/chunks/shared.js']).toMatch(/^[a-f0-9]{64}$/);
  expect(await experimentalFinalizePackage(sealed, { packageRoot: root })).toEqual(sealed);
  expect(experimentalPackageArtifactInstance(sealed)).toBe(experimentalPackageArtifactInstance(artifact));
  expect(JSON.stringify(sealed)).not.toContain(root);
  const relocated = await mkdtemp(join(tmpdir(), 'mmd-package-relocated-')); roots.push(relocated);
  await cp(root, relocated, { recursive: true });
  expect(await experimentalVerifyPackageIntegrity(sealed, relocated, join(relocated, 'dist/index.js'))).toHaveLength(4);
  // Packing may rewrite dependency versions; these are not executable-entry fields.
  await writeFile(join(relocated, 'package.json'), JSON.stringify({ ...manifest, version: '1.0.0', peerDependencies: { framework: '^1.0.0' } }));
  expect(await experimentalFinalizePackage(artifact, { packageRoot: relocated })).toEqual(sealed);
});

it.each(['dist/index.js', 'dist/chunks/shared.js', 'dist/status.browser.js'])('rejects changed or missing final file %s', async path => {
  const sealed = await experimentalFinalizePackage(artifact, { packageRoot: root });
  const file = join(root, path), original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from('// Changed 🧪')]));
  await expect(experimentalVerifyPackageIntegrity(sealed, root)).rejects.toThrow(`'${path}' changed`);
  await writeFile(file, original);
  expect(await experimentalVerifyPackageIntegrity(sealed, root)).toHaveLength(4);
  await rm(file);
  await expect(experimentalVerifyPackageIntegrity(sealed, root)).rejects.toThrow(`missing JavaScript file '${path}'`);
});

it('rejects stale metadata, changed resolution fields, and unprotected resolved entries', async () => {
  const sealed = await experimentalFinalizePackage(artifact, { packageRoot: root });
  const stale = JSON.parse(JSON.stringify(sealed)) as ExperimentalPackageArtifact;
  stale.entries['integrity-ui']!.functions.bump!.parameterWrites = [];
  await expect(experimentalVerifyPackageIntegrity(stale, root)).rejects.toThrow('semantic metadata changed');
  await expect(experimentalVerifyPackageIntegrity(artifact, root)).rejects.toThrow('required integrity stamp is missing');
  await writeFile(join(root, 'dist/other.js'), 'export const other=true;');
  await expect(experimentalVerifyPackageIntegrity(sealed, root, join(root, 'dist/other.js'))).rejects.toThrow('is not protected');
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, exports: { '.': './outside.js' } }));
  await expect(experimentalVerifyPackageIntegrity(sealed, root)).rejects.toThrow('resolution fields changed');
  await expect(experimentalFinalizePackage(artifact, { packageRoot: root })).rejects.toThrow('unprotected file');
});

it('protects exact public subpaths described by a wildcard export', async () => {
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, exports: {
    '.': './dist/index.js', './*': './dist/*.browser.js',
  } }));
  const sealed = await experimentalFinalizePackage(artifact, { packageRoot: root });
  expect(await experimentalVerifyPackageIntegrity(sealed, root)).toHaveLength(4);
  await expect(experimentalFinalizePackage(artifact, { packageRoot: root, outputDirectory: '..' })).rejects.toThrow('outside its package');
});

it('ignores manifest formatting but detects conditional export precedence changes', async () => {
  const sealed = await experimentalFinalizePackage(artifact, { packageRoot: root });
  await writeFile(join(root, 'package.json'), JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse()), null, 2));
  expect(await experimentalVerifyPackageIntegrity(sealed, root)).toHaveLength(4);
  const exports = manifest.exports as Record<string, unknown>;
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, exports: {
    ...exports, './status': { node: './dist/status.node.js', browser: './dist/status.browser.js' },
  } }));
  await expect(experimentalVerifyPackageIntegrity(sealed, root)).rejects.toThrow('resolution fields changed');
});

it.each(['../escape.js', '/absolute.js', 'dist/../escape.js', 'dist\\index.js', 'C:/escape.js', 'dist/index.js?x'])('rejects unsafe integrity path %s', path => {
  expect(() => validateExperimentalPackageArtifact({ ...artifact, integrity: {
    algorithm: 'sha256', metadata: '0'.repeat(64), manifest: '0'.repeat(64), files: { [path]: '0'.repeat(64) },
  } })).toThrow('package-relative JavaScript path');
});

it('rejects unsupported algorithms and malformed digests before file I/O', () => {
  expect(() => validateExperimentalPackageArtifact({ ...artifact, integrity: { algorithm: 'md5' } })).toThrow('artifact.integrity.algorithm');
  expect(() => validateExperimentalPackageArtifact({ ...artifact, integrity: {
    algorithm: 'sha256', metadata: '0'.repeat(64), manifest: '0'.repeat(64), files: { 'dist/index.js': 'invalid' },
  } })).toThrow('SHA-256 digest');
});

it('requires the publisher declaration while leaving legacy unsealed development artifacts supported', async () => {
  const legacy = { ...manifest }; delete legacy['memoized-dom'];
  await writeFile(join(root, 'package.json'), JSON.stringify(legacy));
  await expect(experimentalFinalizePackage(artifact, { packageRoot: root })).rejects.toThrow('declare memoized-dom.integrity: true');
  expect(await experimentalVerifyPackageIntegrity(artifact, root)).toEqual([]);
});
