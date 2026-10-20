/**
 * Which compiled module an import specifier names. Paths are the keys the caller
 * gave `compileModules` (`./App.tsx`, `./data/session.ts`).
 */
import type { CompileModulesOptions } from '../../options';

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/**
 * The analyzer's `resolve`: a module path, `false` for a module outside the
 * compiled set (a package), or `null` when a relative import names no module.
 */
export function importResolver(paths: readonly string[], options: CompileModulesOptions) {
  const known = new Set(paths);

  return (specifier: string, importer: string): string | false | null => {
    const custom = options.resolveImport?.(specifier, importer);
    if (custom !== undefined) return custom;
    if (!specifier.startsWith('.')) return false;

    const base = joinPath(directoryOf(importer), specifier);
    for (const extension of EXTENSIONS) {
      const candidate = base + extension;
      if (known.has(candidate)) return candidate;
    }
    return null;
  };
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '.' : path.slice(0, slash);
}

/** Joins and normalizes, keeping a leading `./` when the directory had one. */
function joinPath(directory: string, specifier: string): string {
  const parts: string[] = [];
  for (const part of `${directory}/${specifier}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const joined = parts.join('/');
  return directory.startsWith('.') && !joined.startsWith('..') ? `./${joined}` : joined;
}
