/**
 * The project host Vite gives compiler-next (`wiki/compiler/project.md`, "Vite"): files from disk,
 * and imports the compiler's own rule does not settle (path aliases, `@/lib/x`) resolved by Vite.
 */
import { isAbsolute, join, relative } from 'node:path';
import { fileSystemHost, isSourcePath, projectPath, type ProjectHost } from '@memoized-dom/compiler-next';

/** Vite's resolution of `specifier` from the file `importer`: an id, or null when it finds none. */
export type ViteResolver = (specifier: string, importer: string) => Promise<string | null>;

/**
 * `resolver` is read at each resolution: the hook that started a build or an update supplies
 * one, since Vite resolves through a plugin context or an environment.
 */
export function viteHost(root: string, resolver: () => ViteResolver | null): ProjectHost {
  const files = fileSystemHost(root);
  return {
    ...files,
    async resolve(specifier, importer) {
      // A relative import follows the compiler's rule, which also finds generated modules.
      if (specifier.startsWith('.')) return undefined;
      const resolve = resolver();
      if (resolve === null) return undefined;
      const id = await resolve(specifier, join(root, importer));
      return id === null ? false : compiledPath(root, id);
    },
  };
}

/** The project path of a resolved id the project compiles, or false for a package or a virtual module. */
function compiledPath(root: string, id: string): string | false {
  const file = id.replace(/[?#].*$/, '');
  if (!isAbsolute(file) || file.includes('node_modules')) return false;
  const inside = relative(root, file);
  if (inside.startsWith('..') || isAbsolute(inside)) return false;
  const path = projectPath(root, file);
  return isSourcePath(path) ? path : false;
}
