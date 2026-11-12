/**
 * Where a project's files come from (`wiki/compiler/project.md`).
 *
 * A project names its modules by paths relative to its root, written `./src/App.tsx`, the same
 * keys `compileModules` takes. The host turns those paths into text. A bundler plugin gives a
 * host backed by its own resolver and file cache; `fileSystemHost` reads a folder on disk.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface ProjectHost {
  /** The text of the file at a project path, or undefined when there is none. */
  readFile(path: string): string | undefined | Promise<string | undefined>;
  /**
   * Where an import points, when the default rule (relative paths, probing extensions and
   * index files) does not say: a project path, `false` for a module the project does not compile
   * (a package, or a file the bundler handles), or undefined for the default rule. Path aliases
   * (`~/lib/x`) come through here.
   */
  resolve?(specifier: string, importer: string): string | false | undefined | Promise<string | false | undefined>;
}

/** A host that reads the files under `root`. Works under Node and Bun. */
export function fileSystemHost(root: string): ProjectHost {
  return {
    readFile(path) {
      const file = join(root, path);
      // A missing file, or a folder, is "no such module", which the probing rule expects.
      const stats = statSync(file, { throwIfNoEntry: false });
      return stats?.isFile() === true ? readFileSync(file, 'utf8') : undefined;
    },
  };
}

/** The project path of a file on disk under `root`: `./src/App.tsx`. */
export function projectPath(root: string, file: string): string {
  return `./${relative(root, file).split(sep).join('/')}`;
}

/** A path as the project writes it: forward slashes and a leading `./`. */
export function normalizeProjectPath(path: string): string {
  const slashes = path.replaceAll('\\', '/');
  return slashes.startsWith('./') || slashes.startsWith('../') ? slashes : `./${slashes.replace(/^\/+/, '')}`;
}
