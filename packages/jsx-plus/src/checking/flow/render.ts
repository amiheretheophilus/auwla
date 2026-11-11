import { parse } from 'yuku-parser';
import { assemble, copied, generated } from '../../source';
import type { Piece } from '../../source';
import type { NormalizedSource, Range } from '../../model';
import type { CheckingOutput, DiagnosticDirectives, SpanMapping } from '../protocol';
import type { FlowPlan } from './plan';

function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];

  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

export function renderFlow(normalized: NormalizedSource, plan: FlowPlan): {
  primaryDirectives: DiagnosticDirectives;
  supplemental: CheckingOutput;
} | null {
  const pieces: Piece[] = [];
  let offset = 0;

  for (const insertion of plan.insertions) {
    pieces.push(copied(normalized.code, offset, insertion.offset));
    pieces.push(generated(insertion.text));
    offset = insertion.offset;
  }
  pieces.push(copied(normalized.code, offset, normalized.code.length));
  const output = assemble(pieces);

  // Never delegate checking to syntactically invalid generated code.
  const parsed = parse(output.code, { lang: 'tsx', sourceType: 'module' });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return null;
  }

  const mappings: SpanMapping[] = [];
  let firstInner = 0;

  // Compose supplemental -> normalized spans with normalized -> authored spans.
  // Both inputs are ordered, so skip exhausted spans instead of rescanning them.
  for (const outer of output.mappings) {
    while (firstInner < normalized.mappings.length
      && normalized.mappings[firstInner]!.generated[1] <= outer.authored[0]) {
      firstInner++;
    }

    for (let index = firstInner; index < normalized.mappings.length; index++) {
      const inner = normalized.mappings[index]!;
      if (inner.generated[0] >= outer.authored[1]) {
        break;
      }
      const start = Math.max(outer.authored[0], inner.generated[0]);
      const end = Math.min(outer.authored[1], inner.generated[1]);
      if (start >= end) {
        continue;
      }

      mappings.push([
        outer.generated[0] + start - outer.authored[0], end - start,
        inner.authored[0] + start - inner.generated[0], end - start,
        0, 0,
      ]);
    }
  }

  function translated(position: number): number {
    let result = position;
    for (const insertion of plan.insertions) {
      if (insertion.offset <= position) {
        result += insertion.text.length;
      }
    }
    return result;
  }

  const active = mergeRanges(plan.regions.map((region) => [
    translated(region.normalized[0]), translated(region.normalized[1]),
  ]));
  const ignored: DiagnosticDirectives['directives'] = [];
  let previousEnd = 0;

  for (const [start, end] of active) {
    if (previousEnd < start) {
      ignored.push([0, 0, previousEnd, start, 0]);
    }
    previousEnd = end;
  }
  if (previousEnd < output.code.length) {
    ignored.push([0, 0, previousEnd, output.code.length, 0]);
  }

  const primaryRanges = mergeRanges(plan.regions.map((region) => region.normalized));
  const primaryDirectives: DiagnosticDirectives['directives'] = [];

  for (const [start, end] of primaryRanges) {
    const included = plan.regions.filter((region) => {
      return region.normalized[0] < end && start < region.normalized[1];
    });
    let authoredStart = Infinity;
    let authoredEnd = -Infinity;

    for (const region of included) {
      authoredStart = Math.min(authoredStart, region.authored[0]);
      authoredEnd = Math.max(authoredEnd, region.authored[1]);
    }

    primaryDirectives.push([authoredStart, authoredEnd - authoredStart, start, end, 0]);
  }

  return {
    primaryDirectives: {
      unusedExpectDirectiveDiagnostics: [],
      directives: primaryDirectives,
    },
    supplemental: {
      text: output.code,
      extension: '.tsx',
      mappings,
      diagnosticDirectives: { unusedExpectDirectiveDiagnostics: [], directives: ignored },
    },
  };
}
