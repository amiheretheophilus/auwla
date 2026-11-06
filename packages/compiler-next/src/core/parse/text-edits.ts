/** Replacing spans of source text, which is how `core/parse/` lowers TypeScript. */

/** Replace `start…end` of the source with `text`. An insertion has `start === end`. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

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

/** Where `edit`'s text begins once every edit has been applied. */
export function offsetAfterEdits(edit: Edit, edits: readonly Edit[]): number {
  let offset = edit.start;
  for (const other of edits) {
    if (other.start < edit.start) offset += other.text.length - (other.end - other.start);
  }
  return offset;
}
