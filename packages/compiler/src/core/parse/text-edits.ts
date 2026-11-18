/**
 * Replacing spans of source text, which is how `core/parse/` lowers TypeScript, and how slots and
 * routes are lowered. Edited text can also say where each part of it came from (`TextOrigin`),
 * which source maps follow back to the authored text (`core/emit/source-map.ts`).
 */

/** Replace `start…end` of the source with `text`. An insertion has `start === end`. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /**
   * Where the parts of `text` came from in the same source, when it moves authored code (a slot's
   * content moved to a prop). Without it the text is the compiler's, placed where the edit is.
   */
  readonly traced?: TracedText;
}

/** Where an offset in edited text was in the text before the edits. */
export interface TextOrigin {
  original(offset: number): number;
}

/** The origin of text nothing edited. */
export const UNEDITED: TextOrigin = { original: (offset) => offset };

export function applyEdits(source: string, edits: readonly Edit[]): string {
  // From the end, so earlier offsets stay valid. Insertions at the same place keep
  // their order.
  const ordered = edits
    .map((edit, order) => ({ ...edit, order }))
    .sort((left, right) => right.start - left.start || right.order - left.order);
  let result = source;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/** `applyEdits`, and where each part of the result came from. */
export function applyEditsWithOrigin(source: string, edits: readonly Edit[]): { text: string; origin: TextOrigin } {
  if (edits.length === 0) return { text: source, origin: UNEDITED };
  const traced = TracedText.edited(source, edits);
  return { text: traced.text, origin: traced.origin };
}

/** Where `edit`'s text begins once every edit has been applied. */
export function offsetAfterEdits(edit: Edit, edits: readonly Edit[]): number {
  let offset = edit.start;
  for (const other of edits) {
    if (other.start < edit.start) offset += other.text.length - (other.end - other.start);
  }
  return offset;
}

/** `later`, whose text was made from `earlier`'s: an offset goes back through both. */
export function composeOrigins(later: TextOrigin, earlier: TextOrigin): TextOrigin {
  if (later === UNEDITED) return earlier;
  if (earlier === UNEDITED) return later;
  return { original: (offset) => earlier.original(later.original(offset)) };
}

/**
 * One run of traced text, from `start` to the next run: kept from the source offset for offset
 * (`exact`), or written by the compiler, which maps as a whole to `original`, the place it was
 * put. Written text not yet placed has `original` -1.
 */
interface Run {
  readonly start: number;
  readonly original: number;
  readonly exact: boolean;
}

/**
 * Text put together from pieces of one source and from strings the compiler writes, remembering
 * where each piece came from. Edits apply to it as to a string (`edited`), so code that moves
 * authored text builds it the way it built the string.
 */
export class TracedText {
  private constructor(readonly text: string, private readonly runs: readonly Run[]) {}

  /** Text the compiler writes. */
  static written(text: string): TracedText {
    return new TracedText(text, text === '' ? [] : [{ start: 0, original: -1, exact: false }]);
  }

  /** `source` from `start` to `end`, unchanged. */
  static kept(source: string, start: number, end: number): TracedText {
    return new TracedText(source.slice(start, end), end > start ? [{ start: 0, original: start, exact: true }] : []);
  }

  /**
   * `source` from `start` to `end` with the edits inside it applied, as `applyEdits` does: by
   * place, and insertions at one place in the order given.
   */
  static edited(source: string, edits: readonly Edit[], start = 0, end = source.length): TracedText {
    const ordered = edits
      .map((edit, order) => ({ edit, order }))
      .filter(({ edit }) => edit.start >= start && edit.end <= end)
      .sort((left, right) => left.edit.start - right.edit.start || left.order - right.order);

    const parts: TracedText[] = [];
    let cursor = start;
    for (const { edit } of ordered) {
      if (edit.start > cursor) parts.push(TracedText.kept(source, cursor, edit.start));
      parts.push((edit.traced ?? TracedText.written(edit.text)).placedAt(edit.start));
      cursor = Math.max(cursor, edit.end);
    }
    if (end > cursor) parts.push(TracedText.kept(source, cursor, end));
    return TracedText.join(parts);
  }

  /** The pieces one after another. A string is text the compiler writes. */
  static join(parts: readonly (TracedText | string)[]): TracedText {
    let text = '';
    const runs: Run[] = [];
    for (const part of parts) {
      const traced = typeof part === 'string' ? TracedText.written(part) : part;
      for (const run of traced.runs) runs.push({ ...run, start: run.start + text.length });
      text += traced.text;
    }
    return new TracedText(text, runs);
  }

  /** Part of the text, as `String.prototype.slice` with non-negative bounds. */
  slice(from: number, to = this.text.length): TracedText {
    const runs: Run[] = [];
    for (let index = 0; index < this.runs.length; index++) {
      const run = this.runs[index]!;
      const runEnd = this.runs[index + 1]?.start ?? this.text.length;
      if (runEnd <= from || run.start >= to) continue;
      const skipped = Math.max(0, from - run.start);
      runs.push({ start: run.start + skipped - from, original: run.exact ? run.original + skipped : run.original, exact: run.exact });
    }
    return new TracedText(this.text.slice(from, to), runs);
  }

  /** Written text not yet placed now maps to `offset`, where an edit puts it. */
  placedAt(offset: number): TracedText {
    return new TracedText(this.text, this.runs.map((run) => (run.original === -1 ? { ...run, original: offset } : run)));
  }

  /** Where each offset of the text was in the source. */
  get origin(): TextOrigin {
    const runs = this.runs;
    return {
      original(offset) {
        if (runs.length === 0) return 0;
        const run = runs[lastRunAt(runs, offset)]!;
        if (run.original === -1) return 0;
        return run.exact ? run.original + (offset - run.start) : run.original;
      },
    };
  }
}

/** The index of the last run starting at or before `offset`. */
function lastRunAt(runs: readonly Run[], offset: number): number {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (runs[middle]!.start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
