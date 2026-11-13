/**
 * `.auwla` as a compiler-next source language (`compiler-next/src/core/parse/languages.ts`).
 *
 * This is all JSX+ gives a build. Compiler-next reads each `.auwla` module as the TSX `normalize`
 * returns, and does everything else itself, as for a `.tsx` module: imports between files,
 * routes, planning, emission, source maps, projects, and the Bun and Vite plugins. Pass it to any
 * of them:
 *
 * ```ts
 * import { auwla } from '@memoized-dom/jsx-plus';
 * compileModules(files, { languages: [auwla] });
 * memoizedDom({ client: './src/main.ts', languages: [auwla] }); // Bun, or Vite's plugin
 * ```
 *
 * It reads no files and uses no runtime's APIs, so it runs wherever compiler-next runs.
 */
import type { SourceLanguage, TextOrigin } from '@memoized-dom/compiler-next';
import type { VerbatimMapping } from './model';
import { normalize } from './normalize';

export const auwla: SourceLanguage = {
  extensions: ['.auwla'],
  toTsx(text, path) {
    // A syntax error throws a `JsxPlusError`, which is a located `CompileError`.
    const normalized = normalize(text, { filename: path });
    return {
      code: normalized.code,
      origin: copiedSpanOrigin(normalized.mappings),
      ...(normalized.stylesheet === undefined ? {} : { stylesheet: normalized.stylesheet }),
    };
  },
};

/**
 * Where each offset of normalized TSX was in the `.auwla` text. Copied text maps exactly.
 * Generated syntax (`{`, `}` around a child expression) maps to the end of the copied text
 * before it, as `nearestAuthoredOffset` does, which places errors and map segments next to what
 * the author wrote. Found by binary search: a source map asks once per segment.
 */
export function copiedSpanOrigin(mappings: readonly VerbatimMapping[]): TextOrigin {
  const spans = [...mappings].sort((left, right) => left.generated[0] - right.generated[0]);
  return {
    original(offset) {
      // The last span starting at or before `offset`.
      let low = 0;
      let high = spans.length - 1;
      let found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (spans[middle]!.generated[0] <= offset) {
          found = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (found < 0) return 0;
      const span = spans[found]!;
      return offset < span.generated[1] ? span.authored[0] + offset - span.generated[0] : span.authored[1];
    },
  };
}
