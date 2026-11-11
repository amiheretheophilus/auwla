/**
 * Copied spans in TypeScript's content-mapper format, plus end anchors.
 *
 * A span's end is exclusive. When generated text follows a copied span (the
 * `}` in `onClick={focusTask}` for authored `onClick=focusTask`, or in
 * `<p>{name}</p>`), the virtual position right after the expression falls in
 * a gap, and TypeScript maps it back with no exact authored counterpart. It
 * then drops completions that edit the file, such as auto-imports, when the
 * cursor ends the expression. A zero-length span at each such end maps that
 * position exactly. Copied text stays exact and generated text stays unmapped.
 */
import type { NormalizedSource } from '../model';
import type { SpanMapping } from './protocol';

export function editorSpans(normalized: Pick<NormalizedSource, 'code' | 'mappings'>): SpanMapping[] {
  const { code, mappings } = normalized;
  const result: SpanMapping[] = [];

  mappings.forEach((mapping, index) => {
    const [virtual, end] = mapping.generated;
    const [authored, authoredEnd] = mapping.authored;
    result.push([virtual, end - virtual, authored, authoredEnd - authored, 0]);

    const next = mappings[index + 1];
    const followedByGenerated = end < code.length && (next === undefined || next.generated[0] > end);
    if (followedByGenerated) {
      result.push([end, 0, authoredEnd, 0, 0]);
    }
  });
  return result;
}
