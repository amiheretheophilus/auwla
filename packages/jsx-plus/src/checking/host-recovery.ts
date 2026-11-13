/**
 * Recover host expression shape for the syntax reader while an editor is typing.
 * Placeholders exist only in parser input. The reader emits authored slices, so
 * TypeScript still sees the unfinished expression and owns its diagnostics.
 */
import { parse } from 'yuku-parser';
import type { Diagnostic, ParseResult } from 'yuku-parser';

const PLACEHOLDER = '__auwla_edit__';
const MAX_INSERTIONS = 8;

export interface RecoveredHost {
  readonly parsed: ParseResult;
  /** Translate parser-input offsets back to the original wrapped fragment. */
  readonly original: (offset: number) => number;
}

/** Missing expression slots only; structural syntax errors use markup recovery. */
function expressionSlot(source: string, problem: Diagnostic): boolean {
  if (/^Expected property name/.test(problem.message)) {
    return true;
  }
  if (problem.help !== 'Expected an expression') {
    return false;
  }
  const next = source[problem.start];
  return next === undefined || ')]}:,;'.includes(next) || source.startsWith('</', problem.start);
}

export function recoverHostExpressions(
  source: string, initial: ParseResult, start: number, end: number,
): RecoveredHost | null {
  if (source.slice(start, end).trim() === '') {
    return null;
  }
  const insertions: number[] = [];
  let input = source;
  let parsed = initial;

  function original(offset: number): number {
    let shift = 0;
    for (const at of insertions) {
      const insertedStart = at + shift;
      if (offset < insertedStart) {
        break;
      }
      if (offset <= insertedStart + PLACEHOLDER.length) {
        return at;
      }
      shift += PLACEHOLDER.length;
    }
    return offset - shift;
  }

  for (let attempt = 0; attempt < MAX_INSERTIONS; attempt++) {
    const problem = parsed.diagnostics.find((entry) => entry.severity === 'error');
    if (problem === undefined || !expressionSlot(input, problem)) {
      break;
    }
    // A trailing `name.` can be diagnosed on the parser wrapper's closer,
    // after its generated newline. Put the slot at the authored fragment end.
    const inputEnd = end + insertions.length * PLACEHOLDER.length;
    if (problem.start > inputEnd && input.slice(inputEnd, problem.start).trim() !== '') {
      break;
    }
    const position = Math.min(problem.start, inputEnd);
    const at = original(position);
    if (at < start || at > end || insertions.includes(at)) {
      break;
    }

    input = input.slice(0, position) + PLACEHOLDER + input.slice(position);
    insertions.push(at);
    insertions.sort((a, b) => a - b);
    parsed = parse(input, { lang: 'tsx', sourceType: 'module', tokens: true });
  }

  return insertions.length === 0 ? null : { parsed, original };
}

/** Copy parser-owned syntax; only positional fields move, never authored values. */
export function restoreHostOffsets<T>(value: T, original: (offset: number) => number): T {
  if (Array.isArray(value)) {
    return value.map((entry) => restoreHostOffsets(entry, original)) as T;
  }
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const restored: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    restored[key] = (key === 'start' || key === 'end') && typeof entry === 'number'
      ? original(entry)
      : restoreHostOffsets(entry, original);
  }
  return restored as T;
}
