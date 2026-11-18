/**
 * The project host Vite gives the compiler (`wiki/compiler/project.md`, "Vite"): files from disk,
 * native packages by the project's rule, and imports the compiler's own rule does not settle (path
 * aliases, `@/lib/x`) resolved by Vite.
 */
import { isAbsolute, join, relative } from 'node:path';
import { fileSystemHost, isSourcePath, projectPath, type ProjectHost, type SourceLanguage } from '@memoized-dom/compiler';
import { longPath } from './paths';

/** Vite's resolution of `specifier` from the file `importer`: an id, or null when it finds none. */
export type ViteResolver = (specifier: string, importer: string) => Promise<string | null>;

/**
 * `resolver` is read at each resolution: the hook that started a build or an update supplies
 * one, since Vite resolves through a plugin context or an environment.
 */
export function viteHost(root: string, resolver: () => ViteResolver | null, languages?: readonly SourceLanguage[]): ProjectHost {
  const files = fileSystemHost(root);
  return {
    ...files,
    async resolve(specifier, importer) {
      // A relative import follows the compiler's rule, which also finds generated modules.
      if (specifier.startsWith('.')) return undefined;
      // A native package resolves by the project's own rule, as under every other tool.
      const native = await files.resolve?.(specifier, importer);
      if (native !== undefined) return native;
      const resolve = resolver();
      if (resolve === null) return undefined;
      const id = await resolve(specifier, join(root, importer));
      return id === null ? false : compiledPath(root, id, languages);
    },
  };
}

/** The project path of a resolved id the project compiles, or false for a package or a virtual module. */
function compiledPath(root: string, id: string, languages: readonly SourceLanguage[] | undefined): string | false {
  const file = longPath(id.replace(/[?#].*$/, ''));
  if (!isAbsolute(file) || file.includes('node_modules')) return false;
  const inside = relative(root, file);
  if (inside.startsWith('..') || isAbsolute(inside)) return false;
  const path = projectPath(root, file);
  return isSourcePath(path, languages) ? path : false;
}
