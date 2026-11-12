/**
 * Import specifiers in output (`wiki/compiler/linking.md`, "Specifiers"). A specifier that is not
 * relative but that the caller's `resolveImport` maps to a compiled module (a path alias such as
 * `~/lib/x`, or an application's `#server-functions`) is printed as a relative path to that module.
 * The output then loads with no knowledge of how it was resolved, so a bundler or a runtime that
 * loads it needs no alias configuration of its own (`project.md`, `server.md`).
 */
import { findAll, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { relativeModule } from '../core/resolve/imports';
import type { CompileModulesOptions } from '../options';

export function resolveSpecifiers(tree: Node, path: string, known: ReadonlySet<string>, options: CompileModulesOptions): void {
  if (options.resolveImport === undefined) return;
  const nodes = findAll(tree, ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression']);
  for (const node of nodes) {
    const source = (node as { source?: Node | null }).source;
    if (source == null || !is.Literal(source) || typeof source.value !== 'string') continue;
    const specifier = source.value;
    if (specifier.startsWith('.')) continue;
    const target = options.resolveImport(specifier, path);
    if (typeof target !== 'string' || !known.has(target)) continue;
    const relative = relativeModule(path, target, true);
    source.value = relative;
    source.raw = JSON.stringify(relative);
  }
}
