/**
 * Native packages: packages whose source the app compiles as part of its own graph
 * (`wiki/compiler/linking.md`, "Native packages"). Nobody lists them by hand. A package is native
 * in one of two forms:
 *
 * - Installed: `memoized-dom package` marks it in the `package.json` it generates
 *   (`"memoized-dom": { "source": true }`), and its `exports` map points at its source. Only that
 *   manifest is read.
 * - Linked: a package of this workspace, outside any `node_modules`, with a `.lib.config.ts` that
 *   says `source: true`, and nothing built. Its config says what the public imports mean
 *   (`library-config.ts`), so an edit reaches the app with no packaging step.
 *
 * The project resolves an import of one to the source file behind it, so every tool (Vite, Bun,
 * the command line) compiles the same files. The lookup is Node's, from the importing file's own
 * folder: two installed copies at two paths are two modules, each with its own state, and a
 * package two packages share through one hoisted copy is one. An ordinary package is never
 * followed, because the project never reads its files.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { publicEntries, readLibraryConfig, type PublicEntry } from './library-config';

/** A dependency found from some folder: what kind of package it is, and its public imports. */
interface FoundPackage {
  /** The package's real root directory. */
  readonly directory: string;
  readonly kind: 'installed' | 'linked' | 'ordinary';
  /** For a native package: each public import (`.`, `./tabs`) and its source file. */
  readonly entries: ReadonlyMap<string, string>;
}

export interface NativePackageResolver {
  /**
   * The real path of the source file `specifier` names, when it is a public import of a native
   * package as seen from the file `importer`; otherwise undefined.
   */
  resolve(specifier: string, importer: string): string | undefined;
}

/** A resolver that remembers what it learns of each folder, for one build or a dev server's life. */
export function nativePackageResolver(): NativePackageResolver {
  const packages = new Map<string, FoundPackage>();

  function packageAt(directory: string, name: string): FoundPackage {
    let found = packages.get(directory);
    if (found === undefined) {
      found = describePackage(directory, name);
      packages.set(directory, found);
    }
    return found;
  }

  return {
    resolve(specifier, importer) {
      const name = packageNameOf(specifier);
      if (name === undefined) return undefined;

      const installed = installedDirectory(name, dirname(importer));
      if (installed === null) return undefined;
      // Through a symlink, as Node does: what it imports is then found from where it really is.
      const found = packageAt(realpathSync.native(installed), name);
      if (found.kind === 'ordinary') return undefined;
      return found.entries.get(`.${specifier.slice(name.length)}`);
    },
  };
}

/** What the tools need before a build: which packages are native, and where linked ones live. */
export interface NativePackages {
  /** Every native package the app depends on, directly or through another native package, by name. */
  readonly names: readonly string[];
  /** The root directory of each linked package, which may be outside the app. */
  readonly linkedDirectories: readonly string[];
  /** The public imports of each linked package, for writing their types (`kit/tabs`). */
  readonly linkedImports: readonly LinkedImport[];
}

export interface LinkedImport extends PublicEntry {
  /** The import as written: `kit/tabs`. */
  readonly specifier: string;
  /** The package's real root directory. */
  readonly directory: string;
}

/**
 * The native packages the app at `root` depends on. A bundler keeps them out of prebundling, which
 * would give the app a second copy of their state, and out of server externals; a dev server allows
 * the folders of linked ones. Following a dependency's dependencies stops at an ordinary package:
 * code it imports runs opaque with it.
 */
export function nativePackages(root: string): NativePackages {
  const names = new Set<string>();
  const visited = new Set<string>();
  const linkedDirectories: string[] = [];
  const linkedImports: LinkedImport[] = [];

  function visit(directory: string, includeDevelopment: boolean): void {
    const manifest = readManifest(directory);
    if (manifest === null) return;

    for (const name of dependencyNames(manifest, includeDevelopment)) {
      const installed = installedDirectory(name, directory);
      if (installed === null) continue;
      const real = realpathSync.native(installed);
      if (visited.has(real)) continue;
      visited.add(real);

      const found = describePackage(real, name);
      if (found.kind === 'ordinary') continue;
      names.add(name);
      if (found.kind === 'linked') {
        linkedDirectories.push(real);
        for (const [path, file] of found.entries) {
          linkedImports.push({ specifier: name + path.slice(1), path, file, directory: real });
        }
      }
      visit(real, false);
    }
  }

  visit(resolve(root), true);
  return { names: [...names], linkedDirectories, linkedImports };
}

// ---------------------------------------------------------------------------

interface PackageManifest {
  readonly name?: string;
  readonly main?: string;
  readonly exports?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly 'memoized-dom'?: { readonly source?: boolean };
}

/**
 * Which kind of package is at a real directory, and, for a native one, its public imports. `name`
 * is what the app imports it as, which an error in a linked one's config names.
 */
function describePackage(directory: string, name: string): FoundPackage {
  const config = join(directory, '.lib.config.ts');
  // A config inside `node_modules`, pnpm's store included, is never read: a published package has
  // none, and one that ships it anyway is an installed package like any other.
  if (!insideNodeModules(directory) && existsSync(config)) {
    const read = readLibraryConfig(readFileSync(config, 'utf8'), config);
    if (read.source === true) {
      const entries = publicEntries(directory, read, name);
      return { directory, kind: 'linked', entries: new Map(entries.map((entry) => [entry.path, entry.file])) };
    }
  }

  const manifest = readManifest(directory);
  if (manifest?.['memoized-dom']?.source !== true) return { directory, kind: 'ordinary', entries: new Map() };
  return { directory, kind: 'installed', entries: exportedEntries(directory, manifest) };
}

/**
 * The public imports of an installed native package, from the `exports` map `memoized-dom package`
 * generated: one key per public import, each naming its source file through `default` (or
 * `import`), beside `types`.
 */
function exportedEntries(directory: string, manifest: PackageManifest): Map<string, string> {
  const entries = new Map<string, string>();
  const exports = manifest.exports;

  function add(path: string, target: unknown): void {
    const file = exportTarget(target);
    if (file === undefined) return;
    const absolute = resolve(directory, file);
    if (statSync(absolute, { throwIfNoEntry: false })?.isFile() === true) {
      entries.set(path, realpathSync.native(absolute));
    }
  }

  if (typeof exports === 'string') {
    add('.', exports);
  } else if (exports !== null && typeof exports === 'object' && !Array.isArray(exports)) {
    const keys = Object.keys(exports);
    if (keys.every((key) => key.startsWith('.'))) {
      for (const key of keys) add(key, (exports as Record<string, unknown>)[key]);
    } else {
      // Conditions at the top level describe `.` alone.
      add('.', exports);
    }
  } else if (manifest.main !== undefined) {
    add('.', manifest.main);
  }
  return entries;
}

/** The file one `exports` value names for an ES module import. */
function exportTarget(target: unknown): string | undefined {
  if (typeof target === 'string') return target;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const conditions = target as Record<string, unknown>;
  return exportTarget(conditions.import) ?? exportTarget(conditions.default);
}

/** `kit` for `kit/tabs`, `@scope/kit` for `@scope/kit/tabs`; undefined for anything not a package. */
function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') || specifier.includes(':')) return undefined;
  if (isBuiltin(specifier)) return undefined;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length < 2 ? undefined : `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function insideNodeModules(directory: string): boolean {
  return directory.replaceAll('\\', '/').split('/').includes('node_modules');
}

function readManifest(directory: string): PackageManifest | null {
  const file = join(directory, 'package.json');
  if (!existsSync(file)) return null;
  // A manifest that is not JSON stops the build with the parser's error: the package manager that
  // installed it would have stopped first.
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return parsed !== null && typeof parsed === 'object' ? parsed as PackageManifest : null;
}

/** The installed copy of a dependency as seen from a directory, as Node looks it up. */
function installedDirectory(name: string, from: string): string | null {
  let directory = from;
  while (true) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function dependencyNames(manifest: PackageManifest, includeDevelopment: boolean): string[] {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...(includeDevelopment ? Object.keys(manifest.devDependencies ?? {}) : []),
  ];
}
