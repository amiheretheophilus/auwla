/**
 * G-INTERP in attribute strings: `class="card {size}"` becomes the template
 * value `class={`card ${size}`}`. The `{...}` rules are those of quoted child
 * text (markup/text.ts): host tokens find the matching `}`, the expression may
 * use the attribute's own quote, and `\{` writes a literal brace.
 */
import { assemble, copied, generated, type Piece } from '../source';
import { blankRange } from '../masks';
import { readSubstitution } from '../markup/text';
import type { Markup, MarkupContext } from '../markup/context';
import type { AttributeValue } from './value';

/** `{3}` or `{2,4}`: a regular-expression count, not a value worth inserting. */
const BARE_COUNT = /^\s*\d+\s*(,\s*\d*\s*)?$/;

/**
 * Read the quoted value after the `=` at authored offset `equals`, when it
 * contains `{` (or `\{`). Returns null for any other value: an ordinary string
 * keeps its JSX meaning, including HTML entities, and other readers own the
 * remaining forms. An unterminated string is also left to the host's JSX error.
 * `element` reads markup nested inside a substitution.
 */
export function interpolatedAttribute(
  context: MarkupContext, equals: number, element: (start: number) => Markup,
): AttributeValue | null {
  const { source } = context;
  let start = equals + 1;
  while (start < source.length && /\s/.test(source[start]!)) {
    start++;
  }
  const quote = source[start];
  if (quote !== '"' && quote !== "'") {
    return null;
  }

  const pieces: Piece[] = [generated('{`')];
  let interpolated = false;
  let segment = start + 1;
  let cursor = start + 1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === quote) {
      if (!interpolated) {
        return null;
      }
      pieces.push(...templateText(source, segment, cursor), generated('`}'));
      const end = cursor + 1;
      return {
        start, end, pieces,
        // Blanking `="..."` leaves a boolean attribute in the parser-only tag.
        mask: (shadow, origin) => blankRange(shadow, equals - origin, end - origin),
      };
    }
    if (character === '\\' && source[cursor + 1] === '{') {
      // Copied as is: `\{` in a template is a literal `{`.
      interpolated = true;
      cursor += 2;
      continue;
    }
    if (character === '{') {
      pieces.push(...templateText(source, segment, cursor));
      const substitution = readSubstitution(context, cursor, quote, element);
      rejectBareCount(context, cursor, substitution.close, substitution.pieces);
      pieces.push(generated('$'), copied(source, cursor, cursor + 1),
        ...substitution.pieces, copied(source, substitution.close, substitution.close + 1));
      interpolated = true;
      cursor = substitution.close + 1;
      segment = cursor;
      continue;
    }
    cursor++;
  }
  return null;
}

/**
 * Attribute text inside the generated template. JSX attribute strings have no
 * escapes, so a backslash is literal: it is doubled, except in `\{`, which the
 * template reads as a literal brace. A backtick would end the template.
 */
function templateText(source: string, start: number, end: number): Piece[] {
  const pieces: Piece[] = [];
  let copiedFrom = start;
  for (let cursor = start; cursor < end; cursor++) {
    const character = source[cursor];
    if (character === '\\' && source[cursor + 1] === '{') {
      cursor++;
    } else if (character === '\\' || character === '`') {
      pieces.push(copied(source, copiedFrom, cursor), generated('\\'));
      copiedFrom = cursor;
    }
  }
  pieces.push(copied(source, copiedFrom, end));
  return pieces;
}

/**
 * JPX1014: `pattern="\d{3}"` reads `{3}` as an inserted value, so the pattern
 * would silently become `\d3`. A substitution that is only a count is refused,
 * naming the two ways to keep the braces.
 */
function rejectBareCount(context: MarkupContext, open: number, close: number, pieces: readonly Piece[]): void {
  const inside = assemble(pieces).code;
  if (BARE_COUNT.test(inside)) {
    context.error('JPX1014',
      `In an attribute string, {${inside.trim()}} inserts a number. For literal braces, as in a pattern, `
        + `write \\{${inside.trim()}}, or pass the whole value in braces, for example pattern={"\\\\d{3}"}`,
      open, close + 1);
  }
}
