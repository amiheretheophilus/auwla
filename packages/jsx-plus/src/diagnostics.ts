// The analysis entry, which the editor's checking already loads; the same class as the root entry's.
import { CompileError } from '@memoized-dom/compiler-next/analysis';
import type { Range } from './model';

/**
 * A reporter's guess at how to let the rest of the file read, for editor
 * recovery only (`checking/recovery/markup.ts`): set an authored range aside
 * (`blank`), or insert a missing closer such as `)` (`insert`), which keeps the
 * line being typed checkable.
 */
export type Repair =
  | { readonly kind: 'blank'; readonly range: Range }
  | { readonly kind: 'insert'; readonly at: number; readonly text: string };

/**
 * An error at an authored source range. `message` is for terminals and logs
 * and includes `(file:line:column) [code]`; editors, which show the position
 * themselves, use `reason` and `code`.
 *
 * `repairs`: the reporter's guesses, best first, such as an unclosed element's
 * opening tag or a missing `)`. Builds ignore them.
 */
export class JsxPlusError extends CompileError {
  declare readonly line: number;
  declare readonly column: number;

  // `reason` is kept by `CompileError`, which is given it alone.
  constructor(readonly code: string, reason: string, readonly filename: string,
    readonly range: Range, source: string, readonly repairs: readonly Repair[] = []) {
    // A compiler error, so compiler-next reports it as the author's wherever it compiles `.auwla`
    // (`language.ts`), at the same path, line and column.
    super(reason, filename, ...positionOf(source, range[0]));
    this.message = `${reason} (${filename}:${this.line}:${this.column}) [${code}]`;
    this.name = 'JsxPlusError';
  }
}

/** One-based line and UTF-16 column of an offset, counting `\r\n`, `\r` and `\n` as line ends. */
function positionOf(source: string, offset: number): [line: number, column: number] {
  const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
  return [lines.length, lines[lines.length - 1]!.length + 1];
}
