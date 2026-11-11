import { childExpression, hasError } from '../host';
import { blankRange } from '../masks';
import { copied, generated } from '../source';
import type { AttributeValue } from './value';

/** Characters that start a value some other reader owns: strings, `{...}`, `(...)`, markup, `/>`. */
const OTHER_VALUE_STARTS = ['"', "'", '{', '(', '<', '/'];

/**
 * Read a bare `name=identifier` value starting at the `=` at `equals`.
 * Returns null when the value is not a single delimited host identifier, so
 * calls, members and literals fall through to ordinary JSX parsing.
 * The host parser, not this function, decides what spells an identifier.
 */
export function identifierAttribute(source: string, equals: number): AttributeValue | null {
  let start = equals + 1;
  while (start < source.length && /\s/.test(source[start]!)) {
    start++;
  }

  // Keep the common path (string, braces, parentheses) free of another host parse.
  if (start === source.length || OTHER_VALUE_STARTS.includes(source[start]!)) {
    return null;
  }

  // The identifier ends at attribute whitespace or the tag's `>`/`/>`.
  let end = start;
  while (end < source.length && !/[\s/>]/.test(source[end]!)) {
    end++;
  }
  const boundary = source[end];
  const delimited = boundary !== undefined
    && (/\s/.test(boundary) || boundary === '>' || source.startsWith('/>', end));
  if (!delimited || start === end) {
    return null;
  }

  const parsed = childExpression(source.slice(start, end));
  if (parsed.expression?.type !== 'Identifier' || hasError(parsed.diagnostics)) {
    return null;
  }

  return {
    start,
    end,
    pieces: [generated('{'), copied(source, start, end), generated('}')],
    // Blanking `=identifier` leaves a boolean attribute in the parser-only tag.
    mask: (shadow, origin) => blankRange(shadow, equals - origin, end - origin),
  };
}
