import { JsxPlusError, type Repair } from '../diagnostics';
import type { ChildView, ElementView, FragmentView } from '../model';
import type { Piece, Replacement } from '../source';

/** One complete element or fragment: its authored extent, emitted pieces and syntax view. */
export interface Markup extends Replacement {
  readonly view: ElementView | FragmentView;
}

/** The normalized children of one body or conditional block. */
export interface Children {
  readonly views: ChildView[];
  readonly pieces: Piece[];
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

  constructor(readonly source: string, readonly filename: string) {}

  /**
   * Throw an authored diagnostic. `end` is clamped to the source length.
   * `repairs` are editor-recovery guesses, best first (`Repair`).
   */
  error(code: string, message: string, start: number, end = start + 1, repairs: readonly Repair[] = []): never {
    throw new JsxPlusError(code, message, this.filename, [start, Math.min(end, this.source.length)], this.source, repairs);
  }
}
