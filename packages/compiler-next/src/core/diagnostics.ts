/** Errors the compiler reports, with the place in the authored module. */

export class CompileError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    const place = line === undefined ? path : `${path}:${line}:${column}`;
    super(`memo-dom: ${message} (${place})`);
    this.name = 'CompileError';
  }

  /** An error at a UTF-16 offset in `source`, as yuku reports positions. */
  static at(message: string, path: string, source: string, offset: number): CompileError {
    const { line, column } = locate(source, offset);
    return new CompileError(message, path, line, column);
  }
}

/** One-based line and column of a UTF-16 offset. */
export function locate(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset && index < source.length; index++) {
    if (source[index] === '\n') {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
