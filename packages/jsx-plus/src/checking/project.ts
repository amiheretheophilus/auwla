import { normalizeForChecking } from '../normalize';
import { codeSuffix, JsxPlusError } from '../diagnostics';
import { planFlow } from './flow/plan';
import { renderFlow } from './flow/render';
import type { CheckingSource } from './protocol';
import { editorSpans } from './spans';
import { recoverMarkup } from './recovery/markup';
import type { NormalizedSource } from '../model';

/** TypeScript 7.1 content-mapper protocol. All offsets use UTF-16 code units. */
export type { CheckingSource, SpanMapping } from './protocol';

/** The editor shows the position itself; keep the JSX+ code in the text to tell it from TS codes. */
function authoredDiagnostic(error: JsxPlusError) {
  return {
    messageText: `${error.reason}${codeSuffix(error.code)}`,
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
    mappings: editorSpans(normalized),
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
      const view = checkingView(recovered.normalized, filename);
      const last = recovered.normalized.mappings.at(-1);
      if (last?.authored[1] === source.length && last.generated[1] < view.text.length) {
        // A synthetic closing tag can move a native "expected }" at EOF past
        // the last copied character. Map that diagnostic back to authored EOF
        // without moving completion/edit cursors beyond the inserted closer.
        view.mappings.push([view.text.length, 0, source.length, 0, 0, 0]);
      }
      return {
        ...view,
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
