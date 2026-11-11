/**
 * Parser-only masks.
 *
 * The normalizer repeatedly asks the host parser to scan past markup it has
 * already read. It does that by hiding the read text in a temporary copy of the
 * source (a "shadow"). Every mask keeps the original UTF-16 length and every
 * line break, so an offset in the shadow is the same offset in the authored
 * source. Shadows are only ever handed to the host parser; emitted code is
 * always built from the authored source (see source.ts).
 */

/** Replace every character except line breaks with a space. */
export function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

/** Blank `source[start, end)`. */
export function blankRange(source: string, start: number, end: number): string {
  return source.slice(0, start) + blank(source.slice(start, end)) + source.slice(end);
}

/**
 * Replace complete markup with the identifier `_` followed by blanks, so the
 * host parser sees one ordinary value where the element was.
 */
export function maskMarkup(source: string, start: number, end: number): string {
  return source.slice(0, start) + '_' + blank(source.slice(start + 1, end)) + source.slice(end);
}

/**
 * Replace a whole `(...)` attribute value with `{0   }`, so the rest of the
 * opening tag still lexes as JSX. The first non-line-break character inside
 * becomes `0` because an empty JSX attribute container is itself an error.
 */
export function maskAttributeValue(source: string, start: number, end: number): string {
  const inside = blank(source.slice(start + 1, end - 1));
  const zero = inside.indexOf(' ');
  const value = zero < 0 ? inside : inside.slice(0, zero) + '0' + inside.slice(zero + 1);
  return source.slice(0, start) + '{' + value + '}' + source.slice(end);
}
