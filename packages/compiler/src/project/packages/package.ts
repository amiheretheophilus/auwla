/**
 * Packaging a native package (`wiki/compiler/linking.md`, "Publishing and installing one"): the
 * source of its public API, for each app's own compiler to build in that app's graph.
 *
 * A native package ships source, so packaging needs no bundler: it copies the files the public
 * entries reach, exactly as written, and generates the `package.json` to publish. What they import
 * is checked here, so an author learns of a problem when packaging, not from a user's build, and the
 * package is compiled once, so one that cannot compile is never published.
 *
 * `packageLibrary` is the whole command; the command line (`cli.ts package`) and the old Vite
 * plugin's `memoized-dom package` both call it.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { compileModules } from '../../pipeline';
import { importSpecifiers } from '../collect';
import { emitDeclarations } from './declarations';
import { libraryError, publicEntries, readLibraryConfig, type LibraryConfig, type PublicEntry } from './library-config';

export interface PackageOptions {
  /** The package's folder. Default: the working directory. */
  readonly root?: string;
  /** Its config, relative to `root`. Default `.lib.config.ts`. */
  readonly config?: string;
  /** Where progress goes. Default: the console. */
  readonly log?: (line: string) => void;
}

/** One public import as published: its path and the file names it gets in the package. */
export interface PackagedEntry extends PublicEntry {
  /** The declaration file's name without `.d.ts`: `index`, or `entries/tabs`. */
  readonly output: string;
}

type Manifest = Record<string, unknown>;

/** Packages the native package at `root` into its `outDir`, and returns that folder. */
export async function packageLibrary(options: PackageOptions = {}): Promise<string> {
  const root = realpathSync.native(resolve(options.root ?? process.cwd()));
  const configFile = resolve(root, options.config ?? '.lib.config.ts');
  if (!existsSync(configFile)) libraryError(`missing '${configFile}'; create .lib.config.ts with export default { entry: './src/index.ts', source: true }`);
  const config = readLibraryConfig(readFileSync(configFile, 'utf8'), configFile);
  refuseCompiledOptions(config);

  const outDir = outputDirectory(root, config, configFile);
  const entries = packagedEntries(root, outDir, config);
  const manifest = publishingManifest(root, config);
  const source = collectSource(root, outDir, entries, manifest);

  // The compiled code imports these from inside the package, so a strict install needs them.
  for (const framework of frameworkPackages(source)) {
    if (!listedDependencies(manifest).has(framework)) {
      manifest.peerDependencies = { ...(manifest.peerDependencies as object | undefined), [framework]: '*' };
    }
  }

  // Everything is written to a staging folder first, and moved into place only once complete.
  const staging = join(root, '.memoized');
  mkdirSync(staging, { recursive: true });
  const stage = mkdtempSync(join(staging, 'package-'));
  const output = join(stage, 'output');
  mkdirSync(output);

  const styles = copySource(root, source.files, output);
  describeExports(manifest, config, entries, root);
  // Removing an import of a stylesheet because nothing reads it would lose its styles.
  if (manifest.sideEffects === false && styles.length > 0) manifest.sideEffects = styles;

  if (config.declarations !== false) emitDeclarations(root, output, stage, config, entries);
  writeFileSync(join(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyPublishingFiles(root, output);

  replaceDirectory(outDir, output, stage);
  rmSync(stage, { recursive: true, force: true });
  const log = options.log ?? console.log;
  log(`memoized-dom: packaged ${String(manifest.name)} (${entries.length} public ${entries.length === 1 ? 'entry' : 'entries'}) → ${packagePath(root, outDir)}`);
  return outDir;
}

// ---------------------------------------------------------------------------
// The config

/** Options that describe compiled output, which a package of source does not have. */
const COMPILED_OPTIONS = ['minify', 'sourcemap', 'runtimeOwnedState', 'boundaries', 'compiler'] as const;

function refuseCompiledOptions(config: LibraryConfig): void {
  if (config.source !== true) {
    libraryError("this command publishes source; add source: true to .lib.config.ts (compiled output is the old compiler's)");
  }
  for (const option of COMPILED_OPTIONS) {
    if (config[option] !== undefined) libraryError(`'${option}' describes compiled output, and a package with 'source: true' has none`);
  }
  if (config.aliases !== undefined) {
    libraryError("'aliases' only work in this project, and published source is read elsewhere; use relative imports");
  }
  if (config.declarations !== undefined && typeof config.declarations !== 'boolean') {
    const declarations = config.declarations as { tsconfig?: unknown } | null;
    if (declarations === null || typeof declarations !== 'object' || typeof declarations.tsconfig !== 'string') {
      libraryError('declarations must be a boolean or { tsconfig: string }');
    }
  }
}

/** The dedicated folder the package is written to: inside the package, and holding nothing authored. */
function outputDirectory(root: string, config: LibraryConfig, configFile: string): string {
  if (config.outDir !== undefined && (typeof config.outDir !== 'string' || config.outDir === '')) libraryError('outDir must be a directory path');
  const outDir = resolve(root, (config.outDir as string | undefined) ?? 'dist');
  const path = relative(root, outDir).split(sep).join('/');
  if (outDir === root || !inside(root, outDir) || /^(?:node_modules|\.git|\.memoized)(?:\/|$)/.test(path)) {
    libraryError('outDir must be a dedicated output directory inside the package');
  }
  if (inside(outDir, configFile) || inside(outDir, join(root, 'package.json'))) {
    libraryError('outDir cannot contain the library configuration or source manifest');
  }
  // Moving a symlinked output into place could replace its unrelated real target.
  if (existsSync(outDir) && realpathSync.native(outDir) !== outDir) libraryError('outDir cannot be a symbolic link');
  return outDir;
}

/** The public entries, each a file of the package outside `outDir`, with its declaration's name. */
function packagedEntries(root: string, outDir: string, config: LibraryConfig): PackagedEntry[] {
  return publicEntries(root, config).map((entry) => {
    if (!inside(root, entry.file) || inside(outDir, entry.file)) {
      libraryError(`entry '${entry.file}' must be a source file of the package, outside outDir`);
    }
    if (/[\\\u0000-\u001f\u007f:#?*]/.test(entry.path) || entry.path.split('/').includes('..')) {
      libraryError(`unsupported public path '${entry.path}'`);
    }
    return { ...entry, output: entry.path === '.' ? 'index' : `entries/${entry.path.slice(2)}` };
  });
}

// ---------------------------------------------------------------------------
// The manifest

/** Fields of the author's `package.json` that describe the package to publish. */
const METADATA_FIELDS = [
  'name', 'version', 'private', 'description', 'license', 'author', 'contributors', 'repository', 'homepage', 'bugs',
  'keywords', 'funding', 'engines', 'dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies',
  'publishConfig', 'sideEffects',
];

/** The author's metadata, with `config.package` over it, and workspace ranges made publishable. */
function publishingManifest(root: string, config: LibraryConfig): Manifest {
  const file = join(root, 'package.json');
  const authored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Manifest : {};
  const overrides = (config.package ?? {}) as Manifest;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) libraryError('package must be a publishing metadata object');
  if (Object.keys(overrides).some((field) => !METADATA_FIELDS.includes(field))) {
    libraryError('config.package accepts publishing metadata, not generated exports/files/scripts/layout fields');
  }
  const metadata = { ...authored, ...overrides };
  if (typeof metadata.name !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(metadata.name)
    || typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(metadata.version)) {
    libraryError('provide a valid package name and version in the normal package.json or config.package');
  }

  const manifest: Manifest = { type: 'module' };
  for (const field of METADATA_FIELDS) {
    if (metadata[field] !== undefined) manifest[field] = structuredClone(metadata[field]);
  }
  manifest.type = 'module';
  publishableRanges(root, manifest);
  return manifest;
}

/** `workspace:*` and its kin mean nothing to a user's install; they become the version they point at. */
function publishableRanges(root: string, manifest: Manifest): void {
  for (const group of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const values = manifest[group] as Record<string, unknown> | undefined;
    if (values === undefined || typeof values !== 'object') continue;
    for (const [name, range] of Object.entries(values)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
      const suffix = range.slice('workspace:'.length);
      if (/^[~^]?\d/.test(suffix)) {
        values[name] = suffix;
        continue;
      }
      if (!['*', '^', '~'].includes(suffix)) {
        libraryError(`unsupported workspace range '${range}' for '${name}'; use workspace:*, workspace:^, or an explicit version range`);
      }
      values[name] = (suffix === '*' ? '' : suffix) + workspaceVersion(root, name);
    }
  }
}

/** The version of the workspace package `name`, as installed beside this one. */
function workspaceVersion(root: string, name: string): string {
  let directory = root;
  while (true) {
    const manifest = join(directory, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) {
      const version = (JSON.parse(readFileSync(manifest, 'utf8')) as Manifest).version;
      if (typeof version !== 'string') libraryError(`workspace dependency '${name}' has no version`);
      return version;
    }
    const parent = dirname(directory);
    if (parent === directory) libraryError(`cannot resolve workspace dependency '${name}' to determine its published version`);
    directory = parent;
  }
}

/** `exports`, `main` and the marker apps look for, pointing at the published source. */
function describeExports(manifest: Manifest, config: LibraryConfig, entries: readonly PackagedEntry[], root: string): void {
  const published = (entry: PublicEntry) => `./${packagePath(root, entry.file)}`;
  const main = entries.find((entry) => entry.path === '.');
  if (main !== undefined) {
    manifest.main = published(main);
    manifest.module = manifest.main;
  }
  if (config.declarations !== false && main !== undefined) manifest.types = './index.d.ts';
  manifest.exports = Object.fromEntries(entries.map((entry) => [entry.path, {
    ...(config.declarations === false ? {} : { types: `./${entry.output}.d.ts` }),
    default: published(entry),
  }]));
  manifest['memoized-dom'] = { source: true };
}

function listedDependencies(manifest: Manifest): Set<string> {
  const groups = [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies];
  return new Set(groups.flatMap((group) => Object.keys((group ?? {}) as object)));
}

// ---------------------------------------------------------------------------
// The source

interface PackageSource {
  /** Every file to publish, by real path. */
  readonly files: ReadonlySet<string>;
  /** The source of each module, by its path in the package (`./src/index.ts`). */
  readonly modules: Readonly<Record<string, string>>;
  /** What each relative import means: `importer\0specifier` to a module path. */
  readonly resolutions: ReadonlyMap<string, string>;
}

const SOURCE = /\.(?:ts|tsx|js|jsx|tsrx)$/;
const EXTENSIONS = ['.ts', '.tsx', '.tsrx', '.js', '.jsx'];
const OUTPUT_SOURCES: Readonly<Record<string, readonly string[]>> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'] };

/** Everything the public entries reach, checking each import as it goes. */
function collectSource(root: string, outDir: string, entries: readonly PublicEntry[], manifest: Manifest): PackageSource {
  const files = new Set<string>();
  const modules: Record<string, string> = {};
  const resolutions = new Map<string, string>();
  const listed = listedDependencies(manifest);
  const moduleId = (file: string) => `./${packagePath(root, file)}`;
  const pending = entries.map((entry) => entry.file);

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    // A stylesheet or an asset is published as it is, with nothing further to follow.
    if (!SOURCE.test(file) || file.endsWith('.d.ts')) continue;

    const id = moduleId(file);
    const text = readFileSync(file, 'utf8');
    modules[id] = text;

    for (const specifier of importSpecifiers(id, text)) {
      if (specifier.startsWith('.')) {
        const target = localFile(file, specifier);
        if (target === null) libraryError(`'${specifier}' imported by '${id}' does not exist`);
        if (!inside(root, target) || inside(outDir, target) || packagePath(root, target).split('/').includes('node_modules')) {
          libraryError(`'${specifier}' imported by '${id}' is outside the package's own source`);
        }
        resolutions.set(`${id}\0${specifier}`, moduleId(target));
        pending.push(target);
      } else if (specifier.startsWith('#') || specifier.startsWith('/')) {
        libraryError(`'${specifier}' imported by '${id}' only means something in this project; use a relative import in published source`);
      } else if (!isBuiltin(specifier)) {
        const name = packageNameOf(specifier);
        if (name !== manifest.name && !name.startsWith('@memoized-dom/') && !listed.has(name)) {
          libraryError(`'${specifier}' imported by '${id}' is not listed in dependencies or peerDependencies`);
        }
      }
    }
  }
  return { files, modules, resolutions };
}

/** The file a relative specifier names, by the rule the app's compiler follows, as a real path. */
function localFile(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier.replace(/[?#].*$/, ''));
  const candidates = ['', ...EXTENSIONS, ...EXTENSIONS.map((extension) => `/index${extension}`)].map((suffix) => base + suffix);
  const dot = base.lastIndexOf('.');
  for (const source of OUTPUT_SOURCES[base.slice(dot)] ?? []) candidates.push(base.slice(0, dot) + source);
  const found = candidates.find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile() === true);
  return found === undefined ? null : realpathSync.native(found);
}

const FRAMEWORK_IMPORT = /["'](@memoized-dom\/(?:runtime|data|router))(?:\/[^"']*)?["']/g;

/**
 * Compiles the package once, as an app would, so one that cannot compile is never published. The
 * output also says which framework packages it needs: `$fetch` and the like need no import.
 */
function frameworkPackages(source: PackageSource): Set<string> {
  const output = compileModules({ ...source.modules }, {
    resolveImport: (specifier, importer) => source.resolutions.get(`${importer}\0${specifier}`),
  });
  const packages = new Set(['@memoized-dom/runtime']);
  for (const code of [...Object.values(output), ...Object.values(source.modules)]) {
    for (const match of code.matchAll(FRAMEWORK_IMPORT)) packages.add(match[1]!);
  }
  return packages;
}

/** Copies the files to `output` at their paths in the package; the stylesheets and assets among them. */
function copySource(root: string, files: ReadonlySet<string>, output: string): string[] {
  const styles: string[] = [];
  for (const file of files) {
    const path = packagePath(root, file);
    mkdirSync(dirname(join(output, path)), { recursive: true });
    copyFileSync(file, join(output, path));
    if (!SOURCE.test(file)) styles.push(`./${path}`);
  }
  return styles;
}

function copyPublishingFiles(root: string, output: string): void {
  for (const name of ['README.md', 'LICENSE', 'LICENSE.md', 'LICENCE']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    if (!inside(root, realpathSync.native(file))) libraryError(`'${name}' resolves outside the package`);
    copyFileSync(file, join(output, name));
  }
}

/** Moves the finished package into place. The previous one is kept until the new one is there. */
function replaceDirectory(outDir: string, output: string, stage: string): void {
  mkdirSync(dirname(outDir), { recursive: true });
  const previous = join(stage, 'previous');
  if (existsSync(outDir)) renameSync(outDir, previous);
  renameSync(output, outDir);
}

// ---------------------------------------------------------------------------

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** The path as written in a package: forward slashes, relative to its root. */
function packagePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

export function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
