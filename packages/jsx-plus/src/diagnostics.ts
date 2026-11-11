import type { Range } from './model';

/**
 * An error at an authored source range. `message` is for terminals and logs
 * and includes `(file:line:column) [code]`; editors, which show the position
 * themselves, use `reason` and `code`.
 */
export class JsxPlusError extends SyntaxError {
  readonly line: number;
  readonly column: number;

  constructor(readonly code: string, readonly reason: string, readonly filename: string,
    readonly range: Range, source: string) {
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
