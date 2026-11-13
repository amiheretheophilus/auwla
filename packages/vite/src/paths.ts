/**
 * Normalizes Vite ids and bounds which local files enter compiler analysis.
 */
import { existsSync, realpathSync } from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { isNativePackageFile } from './graph/native-packages';
import type { ResolvedAdapterOptions } from './options';

const sourceExtensions = new Set(['.ts', '.tsx', '.tsrx', '.js', '.jsx']);

export function cleanViteId(id: string): string {
  const query = id.search(/[?#]/);
  return normalizeFile(query === -1 ? id : id.slice(0, query));
}

export function normalizeFile(file: string): string {
  return longPath(resolve(file)).replaceAll('\\', '/');
}

/**
 * The path with Windows short names (`C:\Users\THEOPH~1\…`) spelled out. Vite gives the project
 * root by its real name, while an id can come from a path a caller spelled short; compared as
 * text, a module of the app would look outside it, and go uncompiled. Only a path with a short
 * name is resolved, so a symlinked package keeps its `node_modules` path.
 */
export function longPath(file: string): string {
  if (process.platform !== 'win32' || !/~\d/.test(file)) return file;
  // The longest part of the path that exists has a real name; the rest is kept as written.
  let existing = file;
  let rest = '';
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return file;
    rest = `${existing.slice(parent.length)}${rest}`;
    existing = parent;
  }
  return realpathSync.native(existing) + rest;
}

export function entryFiles(
  root: string,
  entries: readonly string[],
): readonly string[] {
  return entries.map((entry) => {
    if (isAbsolute(entry)) return normalizeFile(entry);
    const rootRelative = entry.startsWith('/') ? entry.slice(1) : entry;
    return normalizeFile(resolve(root, rootRelative));
  });
}

export function moduleId(root: string, file: string): string {
  // Both spelled out, so a root or a file given by a short name still compares.
  const projectRelative = relative(normalizeFile(root), normalizeFile(file)).split(sep).join('/');
  if (
    projectRelative !== '..' &&
    !projectRelative.startsWith('../') &&
    !isAbsolute(projectRelative)
  ) {
    return `./${projectRelative}`;
  }
  return normalizeFile(file);
}

function matches(patterns: RegExp | readonly RegExp[] | undefined, id: string) {
  if (patterns === undefined) return false;
  const list = patterns instanceof RegExp ? [patterns] : patterns;
  return list.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(id);
  });
}

export function acceptsSource(
  root: string,
  file: string,
  options: ResolvedAdapterOptions,
): boolean {
  const id = normalizeFile(file);
  if (!sourceExtensions.has(extname(id))) return false;
  if (matches(options.exclude, id)) return false;
  // A native package ships source for this build, wherever it is installed.
  if (isNativePackageFile(id)) return true;
  if (id.includes('/node_modules/')) return false;
  if (matches(options.include, id)) return true;

  const projectRelative = relative(normalizeFile(root), id);
  return (
    projectRelative !== '..' &&
    !projectRelative.startsWith(`..${sep}`) &&
    !isAbsolute(projectRelative)
  );
}
