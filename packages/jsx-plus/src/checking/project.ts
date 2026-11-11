import { normalize } from '../normalize';
import { JsxPlusError } from '../diagnostics';
import { planFlow } from './flow/plan';
import { renderFlow } from './flow/render';
import type { CheckingSource } from './protocol';

/** TypeScript 7.1 content-mapper protocol. All offsets use UTF-16 code units. */
export type { CheckingSource, SpanMapping } from './protocol';

/**
 * Checking shares the syntax frontend, never DOM compilation. Verbatim spans
 * alone participate in edits; generated braces/ternaries have no authored span.
 * Selected flow regions are checked by a supplemental view. The primary view
 * retains ordinary host narrowing and editor identity; partial recovery remains
 * separate work.
 */
export function projectForChecking(source: string, filename: string): CheckingSource {
  try {
    const normalized = normalize(source, { filename });
    const plan = planFlow(normalized, filename);
    const flow = plan === null ? null : renderFlow(normalized, plan);

    return {
      text: normalized.code,
      extension: '.tsx',
      mappings: normalized.mappings.map(({ generated, authored }) => [
        generated[0], generated[1] - generated[0],
        authored[0], authored[1] - authored[0], 0,
      ]),
      ...(flow === null ? {} : {
        diagnosticDirectives: flow.primaryDirectives,
        supplemental: [flow.supplemental],
      }),
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
