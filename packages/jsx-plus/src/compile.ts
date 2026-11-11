import { compile as compileNext, CompileError, type CompileOptions } from '@memoized-dom/compiler-next';
import { normalize } from './normalize';
import { authoredOffset } from './source';
import { JsxPlusError } from './diagnostics';

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
    if (!(error instanceof CompileError) || error.line === undefined || error.column === undefined) throw error;
    let offset = 0;
    for (let line = 1; line < error.line; line++) {
      const next = normalized.code.indexOf('\n', offset);
      if (next < 0) throw error;
      offset = next + 1;
    }
    offset += error.column - 1;
    const original = authoredOffset(normalized.mappings, offset);
    if (original === undefined) throw error;
    throw new JsxPlusError('COMPILER', error.message, filename, [original, original + 1], source);
  }
}
