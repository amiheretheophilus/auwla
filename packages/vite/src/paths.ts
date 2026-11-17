/**
 * File paths as Vite gives them, compared as text with the project's.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** An absolute path with forward slashes and Windows short names spelled out. */
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
