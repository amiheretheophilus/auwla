import { compile as compileNext, CompileError, type CompileOptions } from '@memoized-dom/compiler-next';
import { normalize } from './normalize';
import { nearestAuthoredOffset } from './source';
import { JsxPlusError } from './diagnostics';
import type { NormalizedSource } from './model';

/** UI compilation adapter. Backend selection/loading is separate future config work. */
export function compile(source: string, options: CompileOptions = {}): string {
  const filename = options.moduleId ?? './App.auwla';
  if (/\.[cm]?[jt]sx?$/.test(filename)) return compileNext(source, options);

  const normalized = normalize(source, { filename });
  try {
    // Only the syntax package knows the authored extension. Compiler-next gets
    // its existing TSX input and owns every subsequent production stage.
    return compileNext(normalized.code, { ...options, moduleId: `${filename}.tsx` });
  } catch (error) {
    if (error instanceof CompileError) throw authoredCompileError(error, normalized, source, filename);
    throw error;
  }
}

/**
 * Offset of a one-based line and UTF-16 column. Lines end at `\n` only, as in
 * compiler-next's `locate`. Undefined when the line does not exist.
 */
function offsetOf(text: string, line: number, column: number): number | undefined {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = text.indexOf('\n', offset);
    if (newline < 0) return undefined;
    offset = newline + 1;
  }
  return offset + column - 1;
}

/**
 * Re-anchor a compiler-next error, located in the normalized TSX, on the
 * authored source. Errors without a position are returned unchanged.
 */
export function authoredCompileError(
  error: CompileError, normalized: Pick<NormalizedSource, 'code' | 'mappings'>, source: string, filename: string,
): CompileError | JsxPlusError {
  if (error.line === undefined || error.column === undefined) return error;
  const offset = offsetOf(normalized.code, error.line, error.column);
  if (offset === undefined) return error;

  // The compiler's own `(path:line:col)` suffix names the generated TSX.
  const message = error.message.replace(` (${error.path}:${error.line}:${error.column})`, '');
  const authored = nearestAuthoredOffset(normalized.mappings, offset);
  return new JsxPlusError('COMPILER', message, filename, [authored, authored + 1], source);
}
