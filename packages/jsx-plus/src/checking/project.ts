import { normalizeForChecking } from '../normalize';
import { JsxPlusError } from '../diagnostics';
import { planFlow } from './flow/plan';
import { renderFlow } from './flow/render';
import type { CheckingSource } from './protocol';
import { recoverMarkup } from './recovery/markup';
import type { NormalizedSource } from '../model';

/** TypeScript 7.1 content-mapper protocol. All offsets use UTF-16 code units. */
export type { CheckingSource, SpanMapping } from './protocol';

function authoredDiagnostic(error: JsxPlusError) {
  return {
    messageText: error.message,
    start: error.range[0],
    length: error.range[1] - error.range[0],
    code: /^JPX\d+$/.test(error.code) ? Number(error.code.slice(3)) : 1999,
  };
}

function checkingView(normalized: NormalizedSource, filename: string): CheckingSource {
  const plan = planFlow(normalized, filename);
  const flow = plan === null ? null : renderFlow(normalized, plan);
  return {
    text: normalized.code,
    extension: '.tsx',
    mappings: normalized.mappings.map(({ generated, authored }) => [
      generated[0], generated[1] - generated[0], authored[0], authored[1] - authored[0], 0,
    ]),
    ...(flow === null ? {} : {
      diagnosticDirectives: flow.primaryDirectives,
      supplemental: [flow.supplemental],
    }),
  };
}

/**
 * Checking shares the syntax frontend, never DOM compilation. Verbatim spans
 * alone participate in edits; generated braces/ternaries have no authored span.
 * Selected flow regions are checked by a supplemental view. The primary view
 * retains ordinary host narrowing and editor identity. Damaged markup can be
 * quarantined for checking while strict production normalization still rejects it.
 */
export function projectForChecking(source: string, filename: string): CheckingSource {
  try {
    return checkingView(normalizeForChecking(source, filename), filename);
  } catch (error) {
    if (!(error instanceof JsxPlusError)) throw error;
    const recovered = recoverMarkup(source, filename, error);
    if (recovered !== null) {
      return {
        ...checkingView(recovered.normalized, filename),
        diagnostics: recovered.errors.map(authoredDiagnostic),
      };
    }
    // If a valid surrounding module cannot be recovered, retain the authored
    // error and an empty module rather than claim that the remainder was checked.
    return {
      text: 'export {};\n',
      extension: '.tsx',
      mappings: [],
      diagnostics: [authoredDiagnostic(error)],
    };
  }
}
