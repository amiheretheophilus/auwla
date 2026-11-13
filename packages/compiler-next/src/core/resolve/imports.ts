/**
 * Which compiled module an import specifier names. Paths are the keys the caller
 * gave `compileModules` (`./App.tsx`, `./data/session.ts`).
 */
import type { CompileModulesOptions } from '../../options';
import type { ParsedModule } from '../parse';
import { languageExtensions } from '../parse/languages';
import { applyEditsWithOrigin, type Edit, type TextOrigin } from '../parse/text-edits';

/**
 * The text to analyze for a module, with `import x = require('m')` settled.
 *
 * Parse lowers it to `import x from 'm'`, because `export =` becomes a default export. Requiring a
 * module without `export =` gives its namespace object, so here it becomes `import * as x`. Only
 * now can that be known, since it depends on the other module. A package is left as written: the
 * bundler's interop gives `module.exports` as its default.
 */
export function withRequireImports(
  input: ParsedModule,
  parsed: readonly ParsedModule[],
  resolve: ReturnType<typeof importResolver>,
): { text: string; origin: TextOrigin } {
  const edits: Edit[] = [];
  for (const { at, local, specifier } of input.requireImports) {
    const target = parsed.find((module) => module.path === resolve(specifier, input.path));
    if (target === undefined || target.hasExportAssignment) continue;
    const written = `import ${local}`;
    edits.push({ start: at, end: at + written.length, text: `import * as ${local}` });
  }
  return applyEditsWithOrigin(input.source, edits);
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

/** TypeScript's rule: a specifier may name the output of a source, as ESM requires it to. */
const SOURCES_OF_OUTPUT: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/** A generated dependency, preserving the existing extensionless TypeScript convention. */
export function relativeModule(importer: string, target: string, preserveExtension = false): string {
  const from = importer.replace(/^\.\//, '').split('/');
  from.pop();
  const to = target.replace(/^\.\//, '').split('/');

  while (from.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }

  const relative = [...from.map(() => '..'), ...to].join('/');
  const path = preserveExtension ? relative : relative.replace(/\.tsx?$/, '');
  // `.memoized/x.ts` is a folder name starting with a dot, not a relative path.
  return path.startsWith('./') || path.startsWith('../') ? path : `./${path}`;
}

/**
 * The analyzer's `resolve`: a module path, `false` for a module outside the
 * compiled set (a package), or `null` when a relative import names no module.
 */
export function importResolver(paths: readonly string[], options: CompileModulesOptions) {
  const known = new Set(paths);
  const extensions = languageExtensions(options.languages);

  return (specifier: string, importer: string): string | false | null => {
    const custom = options.resolveImport?.(specifier, importer);
    if (custom !== undefined) return custom;

    const candidates = importCandidates(specifier, importer, extensions);
    if (candidates === null) return false;
    return candidates.find((candidate) => known.has(candidate)) ?? null;
  };
}

const STYLESHEET = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/i;

/** Whether a path or specifier names a stylesheet, which a bundler loads, never the compiler. */
export function isStylesheet(specifier: string): boolean {
  return STYLESHEET.test(specifier);
}

/**
 * A stylesheet imported for its effect on the page (`./app.css`): it runs no code and exports
 * nothing a page reads. Not a CSS module (`./app.module.css`), whose exports are class names the
 * bundler makes.
 */
export function isPlainStylesheet(specifier: string): boolean {
  return isStylesheet(specifier) && !/\.module\.[a-z]+$/i.test(specifier);
}

/**
 * The paths a specifier may name, in the order they are tried: as written, with each source
 * extension, as a folder's index, and the TypeScript source of a written `.js`. Null for a bare
 * specifier, which names a package. A project collecting its modules from disk tries the same
 * paths (`project/collect.ts`), so it finds exactly the modules this rule later picks.
 *
 * `extensions`: those a source language owns (`core/parse/languages.ts`), tried after the
 * JavaScript and TypeScript ones, as a file and as a folder's index: `./Row` may name `./Row.auwla`.
 */
export function importCandidates(specifier: string, importer: string, extensions: readonly string[] = []): readonly string[] | null {
  if (!specifier.startsWith('.')) return null;

  const base = joinPath(directoryOf(importer), specifier);
  const candidates = EXTENSIONS.map((extension) => base + extension);
  for (const extension of extensions) candidates.push(base + extension, `${base}/index${extension}`);

  const dot = base.lastIndexOf('.');
  for (const source of SOURCES_OF_OUTPUT[base.slice(dot)] ?? []) {
    candidates.push(base.slice(0, dot) + source);
  }

  return candidates;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '.' : path.slice(0, slash);
}

/** Joins and normalizes, keeping the leading `./` or `/` the directory had. */
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
  if (directory.startsWith('/')) return `/${joined}`;
  return directory.startsWith('.') && !joined.startsWith('..') ? `./${joined}` : joined;
}
