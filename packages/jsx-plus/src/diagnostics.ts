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
export class JsxPlusError extends SyntaxError {
  readonly line: number;
  readonly column: number;

  constructor(readonly code: string, readonly reason: string, readonly filename: string,
    readonly range: Range, source: string, readonly repairs: readonly Repair[] = []) {
    const prefix = source.slice(0, range[0]);
    const lines = prefix.split(/\r\n|\r|\n/);
    const line = lines.length;
    const column = lines[lines.length - 1]!.length + 1;
    super(`${reason} (${filename}:${line}:${column}) [${code}]`);
    this.name = 'JsxPlusError';
    this.line = line;
    this.column = column;
  }
}
