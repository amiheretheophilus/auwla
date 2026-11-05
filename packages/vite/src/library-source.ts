/**
 * `memoized-dom package` for a native package: publish the source of the public API, for
 * the app's own compiler to build as part of its graph (`wiki/compiler/linking.md`).
 *
 * Only files the public entries reach are published. What they import is checked here, so
 * that an author learns of a problem when packaging rather than from a user's build.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { compileModulesDetailed, memoizedEstreeFrontend, parseWithEstreeFrontendOrThrow } from '@memoized-dom/compiler';
import { valueImports } from './graph/imports';
import type { LibraryConfig } from './library-config';
import { inside, libraryError, sourceFile, type LibraryEntry } from './library-layout';

const EXTENSIONS = ['.ts', '.tsx', '.tsrx', '.js', '.jsx'];
const INDEX_FILES = EXTENSIONS.map((extension) => `/index${extension}`);

/** A specifier may name the output of a source, as ESM requires it to. */
const SOURCES_OF_OUTPUT: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
};

/** Options that describe compiled output, which a package of source does not have. */
const COMPILED_OPTIONS = ['minify', 'sourcemap', 'runtimeOwnedState', 'boundaries', 'compiler'] as const;

const FRAMEWORK_IMPORT = /["'](@memoized-dom\/(?:runtime|data|router))(?:\/[^"']*)?["']/g;

type Manifest = Record<string, unknown>;

/** The path as written in a package: forward slashes, relative to its root. */
function packagePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The file a relative specifier names, by the same rule the app's compiler follows. */
function localFile(importer: string, specifier: string): string | null {
  const base = resolve(dirname(importer), specifier.replace(/[?#].*$/, ''));

  for (const suffix of ['', ...EXTENSIONS, ...INDEX_FILES]) {
    if (isFile(base + suffix)) {
      return base + suffix;
    }
  }

  const extension = extname(base);

  for (const source of SOURCES_OF_OUTPUT[extension] ?? []) {
    const candidate = base.slice(0, -extension.length) + source;

    if (isFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Every `import('literal')` under a node. Other forms cannot name a file of the package. */
function dynamicImports(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      dynamicImports(item, found);
    }
  } else if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>;
    const source = record.source as { value?: unknown } | undefined;

    if (record.type === 'ImportExpression' && typeof source?.value === 'string') {
      found.push(source.value);
    }

    for (const key of Object.keys(record)) {
      if (key !== 'parent') {
        dynamicImports(record[key], found);
      }
    }
  }

  return found;
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function listedDependencies(manifest: Manifest): Set<string> {
  const groups = [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies];
  return new Set(groups.flatMap((group) => Object.keys((group ?? {}) as object)));
}

interface PackageSource {
  /** Every file to publish, absolute. */
  readonly files: ReadonlySet<string>;
  /** The source of each module, by the id the compiler gets. */
  readonly modules: Readonly<Record<string, string>>;
  /** What each import means: `importer\0specifier` to a module id. */
  readonly resolutions: ReadonlyMap<string, string>;
}

/** Walk from the public entries to everything they reach. */
async function collectSource(root: string, outDir: string, entries: readonly LibraryEntry[], manifest: Manifest): Promise<PackageSource> {
  const files = new Set<string>();
  const modules: Record<string, string> = {};
  const resolutions = new Map<string, string>();
  const listed = listedDependencies(manifest);
  const moduleId = (file: string) => `./${packagePath(root, file)}`;

  const visit = async (file: string): Promise<void> => {
    if (files.has(file)) {
      return;
    }

    files.add(file);

    // A stylesheet or an asset is published as it is, with nothing further to follow.
    if (!sourceFile(file)) {
      return;
    }

    const id = moduleId(file);
    const source = await readFile(file, 'utf8');
    const { program } = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend, source, { filename: id, sourceType: 'module' });
    modules[id] = source;

    const specifiers = [
      ...valueImports(program as never).map((reference) => reference.specifier),
      ...dynamicImports(program),
    ];

    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) {
        const target = localFile(file, specifier);

        if (target === null) {
          libraryError(`'${specifier}' imported by '${id}' does not exist`);
        }

        if (!inside(root, target) || inside(outDir, target) || packagePath(root, target).split('/').includes('node_modules')) {
          libraryError(`'${specifier}' imported by '${id}' is outside the package's own source`);
        }

        resolutions.set(`${id}\0${specifier}`, moduleId(target));
        await visit(target);
        continue;
      }

      if (specifier.startsWith('#') || specifier.startsWith('/')) {
        libraryError(`'${specifier}' imported by '${id}' only means something in this project; use a relative import in published source`);
      }

      if (isBuiltin(specifier)) {
        continue;
      }

      const name = packageNameOf(specifier);

      if (name !== manifest.name && !name.startsWith('@memoized-dom/') && !listed.has(name)) {
        libraryError(`'${specifier}' imported by '${id}' is not listed in dependencies or peerDependencies`);
      }
    }
  };

  for (const entry of entries) {
    await visit(entry.file);
  }

  return { files, modules, resolutions };
}

/**
 * Compile the package once with what the app would use, so a package that cannot compile
 * never gets published. Its output also says which framework packages it needs, including
 * `$fetch` and the like, which the author's source need not import.
 */
function frameworkPackages(source: PackageSource): Set<string> {
  const compiled = compileModulesDetailed({ ...source.modules }, {
    resolveImport: (specifier, importer) => source.resolutions.get(`${importer}\0${specifier}`),
  });
  const packages = new Set(['@memoized-dom/runtime']);

  for (const code of [...Object.values(compiled.output), ...Object.values(source.modules)]) {
    for (const match of code.matchAll(FRAMEWORK_IMPORT)) {
      packages.add(match[1]!);
    }
  }

  return packages;
}

/** Write the package's source to `output`, and turn `manifest` into its published form. */
export async function writeSourcePackage(
  root: string,
  config: LibraryConfig,
  entries: readonly LibraryEntry[],
  manifest: Manifest,
  outDir: string,
  output: string,
): Promise<void> {
  for (const option of COMPILED_OPTIONS) {
    if (config[option] !== undefined) {
      libraryError(`'${option}' describes compiled output, and a package with 'source: true' has none`);
    }
  }

  if (config.aliases !== undefined) {
    libraryError(`'aliases' only work in this project, and published source is read elsewhere; use relative imports`);
  }

  const source = await collectSource(root, outDir, entries, manifest);
  const listed = listedDependencies(manifest);

  // The compiled code imports these from inside the package, so a strict install needs them.
  for (const framework of frameworkPackages(source)) {
    if (!listed.has(framework)) {
      manifest.peerDependencies = { ...(manifest.peerDependencies as object | undefined), [framework]: '*' };
    }
  }

  const styles: string[] = [];

  for (const file of source.files) {
    const path = packagePath(root, file);
    const target = join(output, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file, target);

    if (!sourceFile(file)) {
      styles.push(`./${path}`);
    }
  }

  const published = (entry: LibraryEntry) => `./${packagePath(root, entry.file)}`;
  const main = entries.find((entry) => entry.path === '.');

  manifest.main = main === undefined ? undefined : published(main);
  manifest.module = manifest.main;
  manifest.exports = Object.fromEntries(entries.map((entry) => [entry.path, {
    ...(config.declarations === false ? {} : { types: `./${entry.output}.d.ts` }),
    default: published(entry),
  }]));
  manifest['memoized-dom'] = { source: true };

  // Removing an import of a stylesheet because nothing reads it would lose its styles.
  if (manifest.sideEffects === false && styles.length > 0) {
    manifest.sideEffects = styles;
  }
}
