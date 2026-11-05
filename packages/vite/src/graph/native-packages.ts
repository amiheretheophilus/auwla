/**
 * Installed packages that ship their source for the app to compile as part of its own
 * graph (`wiki/compiler/linking.md`, "Native packages"). `memoized-dom package` marks one in
 * the `package.json` it generates. Nobody lists them by hand: the plugin finds them here.
 *
 * This only ever reads a manifest. It never runs anything from an installed package.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

/**
 * Whether a file belongs to a native package. Its package is the nearest manifest with a
 * name, since a nameless `package.json` (`{ "type": "module" }`) only configures a folder.
 */
export function isNativePackageFile(file: string): boolean {
  return directoryIsNative(dirname(file));
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

/**
 * The names of the native packages an app depends on, directly or through another native
 * package. An ordinary package is not followed: code it imports runs opaque with it.
 */
export function nativeDependencies(root: string): readonly string[] {
  const names = new Set<string>();
  const visited = new Set<string>();

  const visit = (directory: string, includeDevelopment: boolean): void => {
    const manifest = readManifest(directory);

    if (manifest === null) {
      return;
    }

    for (const name of dependencyNames(manifest, includeDevelopment)) {
      const installed = installedDirectory(name, directory);

      if (installed === null || visited.has(installed)) {
        continue;
      }

      visited.add(installed);

      if (isNative(readManifest(installed))) {
        names.add(name);
        visit(installed, false);
      }
    }
  };

  visit(root, true);
  return [...names];
}
