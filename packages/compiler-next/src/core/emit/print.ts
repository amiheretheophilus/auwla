/**
 * Printing with `yuku-codegen`, the only importer of it (`wiki/compiler/toolchain.md`).
 * `strip` removes TypeScript; `core/parse/` already lowered what `strip` would drop.
 */
import { generate } from 'yuku-codegen';
import type { Node } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import { mapToAuthored, type MappedSource, type SourceMap } from './source-map';

/** JavaScript for `node`, TypeScript removed. */
export function printJavaScript(node: Node, path: string, source: string): string {
  return print(node, path, source).code;
}

/** JavaScript for `node`, with a source map back to the authored text (`source-map.ts`). */
export function printWithSourceMap(node: Node, source: MappedSource): { code: string; map: SourceMap } {
  const { code, map } = print(node, source.path, source.analyzed, true);
  return { code, map: mapToAuthored(map!.mappings, source) };
}

function print(node: Node, path: string, source: string, sourceMap = false) {
  const result = generate(node, sourceMap ? { strip: true, sourceMap: { source } } : { strip: true });
  // `strip` reports what it cannot convert (a runtime `namespace`, `export =`).
  // Those are not lowered yet, so they are errors rather than silently dropped.
  const dropped = result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    ?? result.diagnostics[0];
  if (dropped !== undefined) {
    throw CompileError.at(`TypeScript construct not supported yet: ${dropped.message}`, path, source, dropped.start);
  }
  return result;
}
