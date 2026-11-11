import { JsxPlusError } from '../../diagnostics';
import { hasError, parseModule } from '../../host';
import { blankRange } from '../../masks';
import { normalizeForChecking } from '../../normalize';
import type { NormalizedSource, Range, VerbatimMapping } from '../../model';

export interface RecoveredMarkup {
  readonly normalized: NormalizedSource;
  readonly errors: readonly JsxPlusError[];
}

function lineAt(source: string, position: number): Range {
  let start = position;
  let end = position;
  while (start > 0 && source[start - 1] !== '\n' && source[start - 1] !== '\r') {
    start--;
  }
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
    end++;
  }
  return [start, end];
}

/** Only unmodified characters are eligible for native diagnostics/editor edits. */
function outsideHoles(mappings: readonly VerbatimMapping[], holes: readonly Range[]): VerbatimMapping[] {
  const result: VerbatimMapping[] = [];
  for (const mapping of mappings) {
    let cursor = mapping.authored[0];
    const end = mapping.authored[1];
    function include(to: number) {
      if (cursor < to) {
        const start = mapping.generated[0] + cursor - mapping.authored[0];
        result.push({ kind: 'verbatim', generated: [start, start + to - cursor], authored: [cursor, to] });
      }
    }
    for (const hole of holes) {
      if (hole[1] <= cursor || hole[0] >= end) {
        continue;
      }
      include(hole[0]);
      cursor = Math.min(end, hole[1]);
    }
    include(end);
  }
  return result;
}

/**
 * Whether every quarantined character was blank or inside markup that read again
 * completely. Such a quarantine changed only that markup, which normalized to a
 * whole JSX expression, so it cannot cause a host syntax error elsewhere.
 */
function onlyMarkupQuarantined(source: string, normalized: NormalizedSource, holes: readonly Range[]): boolean {
  return holes.every(([start, end]) => {
    for (let index = start; index < end; index++) {
      if (source[index]!.trim() === '') continue;
      if (!normalized.roots.some((root) => root.range[0] <= index && index < root.range[1])) return false;
    }
    return true;
  });
}

/**
 * Quarantine up to three damaged markup lines from this exact revision. A host
 * syntax error that remains is accepted only when the quarantine could not have
 * caused it (`onlyMarkupQuarantined`): it is then the author's own, left mapped
 * for native TypeScript recovery as in an undamaged file. Otherwise the
 * remaining module must parse. Recovery is never used for production
 * compilation and never borrows an older projection.
 */
export function recoverMarkup(source: string, filename: string, first: JsxPlusError): RecoveredMarkup | null {
  let shadow = source;
  let error = first;
  const errors: JsxPlusError[] = [];
  const holes: Range[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const line = lineAt(source, error.range[0]);
    if (line[0] === line[1] || holes.some((hole) => hole[0] === line[0])) {
      return null;
    }
    errors.push(error);
    holes.push(line);
    holes.sort((a, b) => a[0] - b[0]);
    shadow = blankRange(shadow, line[0], line[1]);

    try {
      const normalized = normalizeForChecking(shadow, filename);
      if (!onlyMarkupQuarantined(source, normalized, holes) && hasError(parseModule(normalized.code).diagnostics)) {
        return null;
      }
      const mappings = outsideHoles(normalized.mappings, holes);
      const hasCode = mappings.some((mapping) => source.slice(...mapping.authored).trim() !== '');
      if (!hasCode) {
        return null;
      }
      return { normalized: { ...normalized, mappings }, errors };
    } catch (next) {
      if (!(next instanceof JsxPlusError)) {
        throw next;
      }
      error = next;
    }
  }
  return null;
}
