import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ExperimentalPackageArtifact } from './linking/model';
import { isPackageJavaScriptPath, packageMetadataHash, validateExperimentalPackageArtifact } from './linking/package-artifact';

type Manifest = Record<string, unknown>;

function failure(message: string): never {
  throw new Error(`memo-dom: package integrity check failed: ${message}; rebuild and finalize the package after bundling`);
}

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function manifestAt(root: string): Promise<Manifest> {
  const manifest: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) failure('package.json must be an object');
  return manifest as Manifest;
}

function manifestHash(manifest: Manifest): string {
  // Package managers may rewrite workspace dependency versions when packing.
  // Bind resolution/optimization fields, not publishing-only metadata.
  const fields = ['name', 'type', 'main', 'module', 'exports', 'imports', 'browser', 'sideEffects'];
  const resolution = Object.fromEntries(fields.filter(key => manifest[key] !== undefined).map(key => [key, manifest[key]]));
  const metadata = manifest['memoized-dom'];
  if (metadata && typeof metadata === 'object') {
    const declaration = metadata as Record<string, unknown>;
    resolution['memoized-dom'] = Object.fromEntries(['artifact', 'integrity']
      .filter(key => declaration[key] !== undefined).map(key => [key, declaration[key]]));
  }
  // Conditional exports/imports are evaluated in object-key order. Keep that
  // order, while the fixed field list above ignores top-level manifest ordering.
  return createHash('sha256').update(JSON.stringify(resolution)).digest('hex');
}

function requiresIntegrity(manifest: Manifest): boolean {
  const metadata = manifest['memoized-dom'];
  if (!metadata || typeof metadata !== 'object') return false;
  const required = (metadata as Record<string, unknown>).integrity;
  if (required !== undefined && required !== true) failure('memoized-dom.integrity must be true when declared');
  return required === true;
}

function targets(value: unknown, wildcard = ''): string[] {
  if (typeof value === 'string') return [value.replaceAll('*', wildcard)];
  if (Array.isArray(value)) return value.flatMap(item => targets(item, wildcard));
  if (value && typeof value === 'object') return Object.entries(value)
    .filter(([condition]) => condition !== 'types' && !condition.startsWith('types@'))
    .flatMap(([, target]) => targets(target, wildcard));
  return [];
}

function entryTargets(manifest: Manifest, specifier: string): string[] {
  const name = manifest.name;
  if (typeof name !== 'string' || specifier !== name && !specifier.startsWith(name + '/')) {
    failure(`entry '${specifier}' does not belong to package ${JSON.stringify(name)}`);
  }
  const subpath = specifier === name ? '.' : './' + specifier.slice(name.length + 1);
  const exports = manifest.exports;
  if (exports !== undefined) {
    if (exports && typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith('.'))) {
      const entries = exports as Record<string, unknown>;
      if (Object.hasOwn(entries, subpath)) return targets(entries[subpath]);
      // Protect all matching alternatives conservatively, including conditional
      // browser/node outputs; never guess which external SSR condition won.
      return Object.entries(entries).flatMap(([pattern, target]) => {
        const star = pattern.indexOf('*');
        if (star === -1 || star !== pattern.lastIndexOf('*')) return [];
        const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
        return subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= prefix.length + suffix.length
          ? targets(target, subpath.slice(prefix.length, subpath.length - suffix.length)) : [];
      });
    }
    return subpath === '.' ? targets(exports) : [];
  }
  if (subpath !== '.') failure(`entry '${specifier}' needs an explicit package export`);
  return [typeof manifest.main === 'string' ? manifest.main : './index.js',
    ...(typeof manifest.module === 'string' ? [manifest.module] : []),
    ...(typeof manifest.browser === 'string' ? [manifest.browser] : [])];
}

function checkEntries(artifact: ExperimentalPackageArtifact, manifest: Manifest, files: Record<string, string>): void {
  for (const specifier of Object.keys(artifact.entries)) {
    const paths = entryTargets(manifest, specifier);
    if (paths.length === 0) failure(`entry '${specifier}' has no JavaScript export target`);
    for (const target of paths) {
      const path = target.startsWith('./') ? target.slice(2) : target;
      if (!isPackageJavaScriptPath(path) || !Object.hasOwn(files, path)) {
        failure(`export '${specifier}' targets unprotected file '${target}'`);
      }
    }
  }
}

async function hashFile(root: string, path: string): Promise<string> {
  const file = resolve(root, path);
  let actual: string;
  try { actual = await realpath(file); }
  catch { return failure(`missing JavaScript file '${path}'`); }
  if (!inside(root, actual)) failure(`JavaScript file '${path}' resolves outside its package`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(actual)) hash.update(chunk);
  return hash.digest('hex');
}

/** Stamp final bundled/minified JavaScript, without executing package code. */
export async function experimentalFinalizePackage(
  input: ExperimentalPackageArtifact,
  options: { packageRoot: string; outputDirectory?: string },
): Promise<ExperimentalPackageArtifact> {
  const artifact = validateExperimentalPackageArtifact({ ...input, integrity: undefined });
  const root = await realpath(options.packageRoot);
  const directory = await realpath(resolve(root, options.outputDirectory ?? 'dist'));
  if (!inside(root, directory)) failure('output directory resolves outside its package');
  const files: Record<string, string> = Object.create(null);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = join(directory, entry.name);
      if (entry.isSymbolicLink()) failure(`output contains symbolic link '${relative(root, file)}'`);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || !/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      const path = relative(root, file).split(sep).join('/');
      if (!isPackageJavaScriptPath(path)) failure(`unsupported output path '${path}'`);
      if (Object.keys(files).length >= 4096) failure('package exceeds 4096 JavaScript files');
      files[path] = await hashFile(root, path);
    }
  };
  await visit(directory);
  const manifest = await manifestAt(root);
  if (!requiresIntegrity(manifest)) failure('declare memoized-dom.integrity: true in package.json before finalizing');
  checkEntries(artifact, manifest, files);
  return validateExperimentalPackageArtifact({ ...artifact, integrity: {
    algorithm: 'sha256', metadata: packageMetadataHash(artifact), manifest: manifestHash(manifest), files,
  } });
}

/** Verify a finalized artifact and return JavaScript inputs for the host watcher. */
export async function experimentalVerifyPackageIntegrity(
  input: ExperimentalPackageArtifact,
  packageRoot: string,
  resolvedEntry?: string,
): Promise<readonly string[]> {
  const artifact = validateExperimentalPackageArtifact({ ...input });
  const integrity = artifact.integrity;
  if (integrity === undefined) {
    if (requiresIntegrity(await manifestAt(packageRoot))) failure('required integrity stamp is missing');
    return [];
  }
  if (packageMetadataHash(artifact) !== integrity.metadata) failure('semantic metadata changed after finalization');
  const root = await realpath(packageRoot);
  const manifest = await manifestAt(root);
  if (manifestHash(manifest) !== integrity.manifest) failure('package resolution fields changed after finalization');
  checkEntries(artifact, manifest, integrity.files);
  for (const [path, expected] of Object.entries(integrity.files)) {
    if (await hashFile(root, path) !== expected) failure(`JavaScript file '${path}' changed after finalization`);
  }
  if (resolvedEntry !== undefined) {
    const actual = await realpath(resolvedEntry);
    const path = relative(root, actual).split(sep).join('/');
    if (!inside(root, actual) || !Object.hasOwn(integrity.files, path)) failure(`resolved entry '${path}' is not protected`);
  }
  return Object.keys(integrity.files).map(path => resolve(root, path));
}
