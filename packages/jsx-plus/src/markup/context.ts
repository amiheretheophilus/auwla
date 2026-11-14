import { JsxPlusError, type Repair } from '../diagnostics';
import type { ChildView, ElementView, FragmentView } from '../model';
import type { Piece, Replacement } from '../source';

/** A child expression that was read separately and masked before host parsing. */
export interface ChildReplacement extends Replacement {
  readonly view: ChildView;
}

/** One complete element or fragment: its authored extent, emitted pieces and syntax view. */
export interface Markup extends ChildReplacement {
  readonly view: ElementView | FragmentView;
}

/** The normalized children of one body or conditional block. */
export interface Children {
  readonly views: ChildView[];
  readonly pieces: Piece[];
}

/**
 * A child-level `<` that the host read as a comparison but that is also one whole element,
 * ending at a closing tag of the same name (`element.ts`, `noteSameNameSibling`).
 */
export interface JoinedSibling {
  /** Authored offset of its `<`, where the missing `;` goes. */
  readonly position: number;
  /** Authored offset just after its opening tag's `>`. */
  readonly openingEnd: number;
}

/** State shared by every reader while one source file is normalized. */
export class MarkupContext {
  /**
   * Conditional child blocks, keyed by the authored offset of their `{`.
   * The body scanner reads each block with the child grammar as soon as it
   * closes, then blanks it so the outer host `if` parses. The child reader
   * later finds the already-normalized children here.
   */
  readonly blocks = new Map<number, Children>();

  /** Names of the elements being read, outermost first (`''` for a fragment). */
  readonly open: string[] = [];

  /** Candidates for a missing `;`, reported only if the file then fails (`normalize.ts`). */
  readonly joinedSiblings: JoinedSibling[] = [];

  constructor(readonly source: string, readonly filename: string, readonly checking = false) {}

  /**
   * Throw an authored diagnostic. `end` is clamped to the source length.
   * `repairs` are editor-recovery guesses, best first (`Repair`).
   */
  error(code: string, message: string, start: number, end = start + 1, repairs: readonly Repair[] = []): never {
    throw new JsxPlusError(code, message, this.filename, [start, Math.min(end, this.source.length)], this.source, repairs);
  }
}
