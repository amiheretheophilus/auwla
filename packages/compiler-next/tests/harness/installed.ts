/**
 * Node's lookup of an installed package, over the file paths of a case.
 *
 * A case installs a package by giving it files under `./node_modules/<name>/`. The files
 * are written to disk as given, so the test runtime then resolves the same specifier by
 * itself, which checks this lookup against a real resolver. The reference and the
 * compilers each use it to see into a package; it is no part of either.
 *
 * Only `node_modules` directories and file probing are modelled. A package's `exports` map
 * is for the build tool that gives the compiler its `resolveImport`.
 */
import { posix } from 'node:path';

const SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/** The TypeScript sources a `.js` or `.jsx` path can name, as Bun resolves them too. */
export function sourcesOfOutput(path: string): readonly string[] {
  if (path.endsWith('.js')) {
    return [path.slice(0, -3) + '.ts', path.slice(0, -3) + '.tsx'];
  }

  return path.endsWith('.jsx') ? [path.slice(0, -4) + '.tsx'] : [];
}

/** A resolver for `paths`. Answers `undefined` for anything that is not an installed file. */
export function installedResolver(paths: Iterable<string>) {
  const known = new Map([...paths].map((path) => [posix.normalize(path), path]));

  return (specifier: string, importer: string): string | undefined => {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return undefined;
    }

    // The nearest `node_modules` wins, which is how one graph can hold two copies.
    let directory = posix.dirname(posix.normalize(importer));

    while (true) {
      const base = posix.join(directory, 'node_modules', specifier);

      for (const candidate of [...SUFFIXES.map((suffix) => base + suffix), ...sourcesOfOutput(base)]) {
        const path = known.get(candidate);

        if (path !== undefined) {
          return path;
        }
      }

      if (directory === '.') {
        return undefined;
      }

      directory = posix.dirname(directory);
    }
  };
}
