/**
 * Packages whose source the app compiles as part of its own graph
 * (`wiki/compiler/linking.md`, "Native packages"). Nobody lists them by hand: the plugin
 * finds them here, in the two forms one can take.
 *
 * - Installed: `memoized-dom package` marks it in the `package.json` it generates. Only that
 *   manifest is read, and nothing from an installed package is ever run.
 * - Linked: a package of this workspace, with its `.lib.config.ts` beside its source and
 *   nothing built. The config is read, as `memoized-dom package` reads it, and says what the
 *   public imports mean. A published package has no such file, and one that ships it anyway
 *   stays inside `node_modules`, where a config is never read.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow } from '@memoized-dom/compiler';
import { removeDeclaration } from '../declarations';
import { libraryError, libraryLayout, loadLibraryConfig } from '../library-layout';

interface ExportStatement {
  readonly type: string;
  readonly specifiers?: readonly { readonly exported?: { readonly name?: string; readonly value?: string } }[];
}

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly 'memoized-dom'?: { readonly source?: boolean };
}

function readManifest(directory: string): PackageManifest | null {
  const file = join(directory, 'package.json');

  if (!existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageManifest;
  } catch {
    // A broken manifest in a dependency is for the package manager to report.
    return null;
  }
}

function isNative(manifest: PackageManifest | null): boolean {
  return manifest?.['memoized-dom']?.source === true;
}

/** What is known of each directory, so that checking a file stays cheap on every transform. */
const nativeDirectories = new Map<string, boolean>();

function directoryKey(path: string): string {
  return path.replaceAll('\\', '/');
}

/**
 * Whether a file belongs to a native package. Its package is the nearest manifest with a
 * name, since a nameless `package.json` (`{ "type": "module" }`) only configures a folder.
 */
export function isNativePackageFile(file: string): boolean {
  return directoryIsNative(dirname(directoryKey(file)));
}

function directoryIsNative(directory: string): boolean {
  const known = nativeDirectories.get(directory);

  if (known !== undefined) {
    return known;
  }

  const manifest = readManifest(directory);
  const parent = dirname(directory);
  let native = false;

  if (manifest?.name !== undefined) {
    native = isNative(manifest);
  } else if (parent !== directory) {
    native = directoryIsNative(parent);
  }

  nativeDirectories.set(directory, native);
  return native;
}

/** The installed copy of a dependency as seen from a directory, as Node looks it up. */
function installedDirectory(name: string, from: string): string | null {
  let directory = from;

  while (true) {
    const candidate = join(directory, 'node_modules', name);

    if (existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return null;
    }

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

/** What one public import of a linked package means: the file behind `kit/tabs`. */
export interface LinkedImport {
  readonly specifier: string;
  readonly file: string;
  /** The package's root directory, and this import within it: `.` or `./tabs`. */
  readonly directory: string;
  readonly publicPath: string;
}

export interface NativePackages {
  /** Every native package the app depends on, by name. */
  readonly names: readonly string[];
  readonly linkedImports: readonly LinkedImport[];
  /** The root directory of each linked package, which may be outside the app. */
  readonly linkedDirectories: readonly string[];
}

/** Whether a module's source has a default export of its own, which `export *` leaves out. */
function hasDefaultExport(source: string, filename: string): boolean {
  const { program } = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, source, { filename, sourceType: 'module' });

  return (program.body as unknown as ExportStatement[]).some((statement) => {
    return statement.type === 'ExportDefaultDeclaration'
      || (statement.specifiers ?? []).some((specifier) => {
        return specifier.exported?.name === 'default' || specifier.exported?.value === 'default';
      });
  });
}

/** Marks a file as ours to replace or remove. Anything else at that path is the author's. */
const TYPE_FILE_HEADER = '// Generated by memoized-dom: the types of this public import.\n';

/** `./deep/field` is found at `deep/field.d.ts` in the package, and `.` at `index.d.ts`. */
function typeFileOf(publicPath: string): string {
  return publicPath === '.' ? 'index.d.ts' : `${publicPath.slice(2)}.d.ts`;
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

async function writeTypeFile(linked: LinkedImport): Promise<void> {
  const file = join(linked.directory, typeFileOf(linked.publicPath));
  const fromFile = relative(dirname(file), linked.file).replaceAll('\\', '/').replace(/\.(?:tsx?|jsx?|tsrx)$/, '');
  const target = JSON.stringify(fromFile.startsWith('.') ? fromFile : `./${fromFile}`);
  const defaultExport = hasDefaultExport(await readFile(linked.file, 'utf8'), linked.file)
    ? `export { default } from ${target};\n`
    : '';
  const content = `${TYPE_FILE_HEADER}export * from ${target};\n${defaultExport}`;
  const existing = readIfExists(file);

  // An unchanged file keeps its timestamp, and a file the author wrote stays theirs.
  if (existing === content || (existing !== null && !existing.startsWith(TYPE_FILE_HEADER))) {
    return;
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

/**
 * Let TypeScript find a linked package's public imports, which have no `exports` to read.
 * It looks for `kit/tabs` at `tabs.d.ts` in the package by itself, in editors and `tsc`, for
 * every app in the workspace. The alternatives were worse: a declared module cannot use a
 * path to a file at all, and `paths` needs each app to change its tsconfig. These files hold
 * only relative paths, so they can be committed, and `memoized-dom package` ignores them.
 */
export async function writeLinkedTypes(imports: readonly LinkedImport[]): Promise<void> {
  const byPackage = new Map<string, LinkedImport[]>();

  for (const linked of imports) {
    byPackage.set(linked.directory, [...(byPackage.get(linked.directory) ?? []), linked]);
  }

  for (const [directory, packageImports] of byPackage) {
    await Promise.all(packageImports.map(writeTypeFile));

    // Remove what an earlier run wrote for a public import that has since gone.
    const record = join(directory, '.memoized', 'linked-types.json');
    const previous = JSON.parse(readIfExists(record) ?? '[]') as string[];
    const current = packageImports.map((linked) => typeFileOf(linked.publicPath));

    for (const name of previous) {
      const file = join(directory, name);

      if (!current.includes(name) && readIfExists(file)?.startsWith(TYPE_FILE_HEADER)) {
        await removeDeclaration(file);
      }
    }

    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      await mkdir(dirname(record), { recursive: true });
      await writeFile(record, JSON.stringify(current));
    }
  }
}

/** A package linked from this workspace, as opposed to one a package manager downloaded. */
function isLinked(directory: string): boolean {
  return !directoryKey(directory).split('/').includes('node_modules')
    && existsSync(join(directory, '.lib.config.ts'));
}

/** The public imports of a linked package, or null if it does not publish its source. */
async function linkedImportsOf(name: string, directory: string): Promise<LinkedImport[] | null> {
  const config = await loadLibraryConfig(directory, join(directory, '.lib.config.ts'));

  if (config.source !== true) {
    return null;
  }

  const { entries } = await libraryLayout(directory, config).catch((error: Error) => {
    return libraryError(`in the linked package '${name}': ${error.message}`);
  });

  return entries.map((entry) => ({
    specifier: name + entry.path.slice(1),
    file: entry.file,
    directory,
    publicPath: entry.path,
  }));
}

/**
 * The native packages an app depends on, directly or through another native package. An
 * ordinary package is not followed: code it imports runs opaque with it.
 */
export async function nativePackages(root: string): Promise<NativePackages> {
  const names = new Set<string>();
  const visited = new Set<string>();
  const linkedImports: LinkedImport[] = [];
  const linkedDirectories: string[] = [];

  const visit = async (directory: string, includeDevelopment: boolean): Promise<void> => {
    const manifest = readManifest(directory);

    if (manifest === null) {
      return;
    }

    for (const name of dependencyNames(manifest, includeDevelopment)) {
      const installed = installedDirectory(name, directory);

      if (installed === null) {
        continue;
      }

      // Through a symlink, as Node does: what it imports is found from where it really is.
      const real = realpathSync(installed);

      if (visited.has(real)) {
        continue;
      }

      visited.add(real);

      const linked = isLinked(real) ? await linkedImportsOf(name, real) : null;

      if (linked !== null) {
        linkedImports.push(...linked);
        linkedDirectories.push(real);
      } else if (!isNative(readManifest(real))) {
        continue;
      }

      names.add(name);
      await visit(real, false);
    }
  };

  await visit(root, true);

  // Known from here on, whatever manifest a file of the package finds above it.
  for (const directory of linkedDirectories) {
    nativeDirectories.set(directoryKey(directory), true);
  }

  return { names: [...names], linkedImports, linkedDirectories };
}
