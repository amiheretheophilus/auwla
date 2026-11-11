import { normalize } from '../normalize';
import { JsxPlusError } from '../diagnostics';

/** TypeScript 7.1 content-mapper protocol. All offsets use UTF-16 code units. */
export type SpanMapping = [
  virtualStart: number, virtualLength: number,
  originalStart: number, originalLength: number,
  kind: 0,
];

export interface CheckingSource {
  readonly text: string;
  readonly extension: '.tsx';
  readonly mappings: SpanMapping[];
  readonly diagnostics?: readonly {
    readonly messageText: string;
    readonly start: number;
    readonly length: number;
    readonly code: number;
  }[];
}

/**
 * Checking shares the syntax frontend, never DOM compilation. Verbatim spans
 * alone participate in edits; generated braces/ternaries have no authored span.
 * Framework-aware flow typing and partial recovery are separate future work.
 */
export function projectForChecking(source: string, filename: string): CheckingSource {
  try {
    const normalized = normalize(source, { filename });
    return {
      text: normalized.code,
      extension: '.tsx',
      mappings: normalized.mappings.map(({ generated, authored }) => [
        generated[0], generated[1] - generated[0],
        authored[0], authored[1] - authored[0], 0,
      ]),
    };
  } catch (error) {
    if (!(error instanceof JsxPlusError)) throw error;
    // A failed parse must not become a successful executable projection. Return
    // its authored diagnostic and a syntactically empty checking module. We do
    // not pretend the remainder of an incomplete file has been checked.
    return {
      text: 'export {};\n',
      extension: '.tsx',
      mappings: [],
      diagnostics: [{
        messageText: error.message,
        start: error.range[0],
        length: error.range[1] - error.range[0],
        code: /^JPX\d+$/.test(error.code) ? Number(error.code.slice(3)) : 1999,
      }],
    };
  }
}
