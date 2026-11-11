import type { Replacement } from '../source';

/**
 * A rewritten attribute value, plus how to hide it from the host parser while
 * the rest of the opening tag is scanned. Each value form needs a different
 * mask to keep the remaining tag lexing as JSX, so the reader that recognised
 * the form also supplies its mask.
 */
export interface AttributeValue extends Replacement {
  /** Return `shadow`, whose first character is authored offset `origin`, with this value hidden. */
  mask(shadow: string, origin: number): string;
}
