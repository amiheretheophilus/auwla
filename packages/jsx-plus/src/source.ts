import type { NormalizedSource, VerbatimMapping } from './model';

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

/** Undefined means generated scaffolding, which must not receive an authored rename edit. */
export function authoredOffset(mappings: readonly VerbatimMapping[], offset: number): number | undefined {
  const mapping = mappings.find((entry) => entry.generated[0] <= offset && offset < entry.generated[1]);
  return mapping === undefined ? undefined : mapping.authored[0] + offset - mapping.generated[0];
}
