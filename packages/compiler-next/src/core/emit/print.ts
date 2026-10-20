/**
 * Printing with `yuku-codegen`, the only importer of it (`wiki/compiler/toolchain.md`).
 * `strip` removes TypeScript; `core/parse/` already lowered what `strip` would drop.
 */
import { generate } from 'yuku-codegen';
import type { Node } from 'yuku-parser';
import { CompileError } from '../diagnostics';

/** JavaScript for `node`, TypeScript removed. */
export function printJavaScript(node: Node, path: string, source: string): string {
  const { code, diagnostics } = generate(node, { strip: true });
  // `strip` reports what it cannot convert (a runtime `namespace`, `export =`).
  // Those are not lowered yet, so they are errors rather than silently dropped.
  const dropped = diagnostics.find((diagnostic) => diagnostic.severity === 'error')
    ?? diagnostics[0];
  if (dropped !== undefined) {
    throw CompileError.at(`TypeScript construct not supported yet: ${dropped.message}`, path, source, dropped.start);
  }
  return code;
}
