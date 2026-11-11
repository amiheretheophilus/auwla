import type { NormalizedSource, Range, VerbatimMapping } from './model';

/** Generated braces have no editable authored span. Copied text retains exact offsets. */
export interface Piece {
  readonly text: string;
  readonly authored: number | null;
}

export const generated = (text: string): Piece => ({ text, authored: null });

export function copied(source: string, start: number, end: number): Piece {
  return { text: source.slice(start, end), authored: start };
}

export interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly pieces: readonly Piece[];
}

export function replaceRange(source: string, start: number, end: number, replacements: readonly Replacement[]): Piece[] {
  const pieces: Piece[] = [];
  let position = start;

  for (const replacement of replacements) {
    if (replacement.start < start || replacement.end > end) continue;
    pieces.push(copied(source, position, replacement.start), ...replacement.pieces);
    position = replacement.end;
  }

  pieces.push(copied(source, position, end));
  return pieces;
}

export function assemble(pieces: readonly Piece[]): Pick<NormalizedSource, 'code' | 'mappings'> {
  const mappings: VerbatimMapping[] = [];
  let position = 0;

  for (const piece of pieces) {
    if (piece.text.length > 0 && piece.authored !== null) {
      mappings.push({ kind: 'verbatim', generated: [position, position + piece.text.length],
        authored: [piece.authored, piece.authored + piece.text.length] });
    }
    position += piece.text.length;
  }

  return { code: pieces.map((piece) => piece.text).join(''), mappings };
}

/*
 * Position lookups. `mappings` are ordered, non-overlapping copied spans.
 * Only `authoredOffset` and exact spans may drive editor edits; the other
 * lookups widen or approximate and are for diagnostics and syntax ranges.
 */

/** Undefined means generated scaffolding, which must not receive an authored rename edit. */
export function authoredOffset(mappings: readonly VerbatimMapping[], offset: number): number | undefined {
  const mapping = mappings.find((entry) => entry.generated[0] <= offset && offset < entry.generated[1]);
  return mapping === undefined ? undefined : mapping.authored[0] + offset - mapping.generated[0];
}

/**
 * Like `authoredOffset`, but a position in generated scaffolding maps to the
 * end of the copied text before it (0 when there is none). For placing error
 * messages only; never for edits.
 */
export function nearestAuthoredOffset(mappings: readonly VerbatimMapping[], offset: number): number {
  const exact = authoredOffset(mappings, offset);
  if (exact !== undefined) {
    return exact;
  }
  let nearest = 0;
  for (const mapping of mappings) {
    if (mapping.generated[1] > offset) {
      break;
    }
    nearest = mapping.authored[1];
  }
  return nearest;
}

/**
 * The smallest authored range covering every copied character inside the
 * generated `range`, or null when the range contains only generated text.
 * The result may enclose authored text that was not copied into `range`.
 */
export function authoredCover(mappings: readonly VerbatimMapping[], range: Range): Range | null {
  let start = Infinity;
  let end = -Infinity;

  for (const mapping of mappings) {
    const from = Math.max(range[0], mapping.generated[0]);
    const to = Math.min(range[1], mapping.generated[1]);
    if (from >= to) {
      continue;
    }
    const shift = mapping.authored[0] - mapping.generated[0];
    start = Math.min(start, from + shift);
    end = Math.max(end, to + shift);
  }

  return start === Infinity ? null : [start, end];
}
