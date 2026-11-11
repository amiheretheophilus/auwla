import { childExpression, hasError } from '../host';
import { blankRange } from '../masks';
import { copied, generated } from '../source';
import type { AttributeValue } from './value';

/** Characters that start a value some other reader owns: strings, `{...}`, `(...)`, markup, `/>`. */
const OTHER_VALUE_STARTS = ['"', "'", '{', '(', '<', '/'];

type ReportError = (code: string, message: string, start: number, end: number) => never;

/**
 * Read an undelimited `name=value` starting at the `=` at `equals`.
 *
 * - Returns null when another reader owns the value (it starts with a quote,
 *   `{`, `(`, `<` or `/`) or the tag ends before the value does.
 * - Returns the value when it is one host identifier: `onClick=addTask`.
 * - Reports JPX1009 otherwise (`a.b`, `true`, `run()`): plain JSX has no
 *   valid undelimited value, so the only repair is explicit delimiters.
 *
 * The host parser, not this function, decides what spells an identifier.
 */
export function identifierAttribute(source: string, equals: number, error: ReportError): AttributeValue | null {
  let start = equals + 1;
  while (start < source.length && /\s/.test(source[start]!)) {
    start++;
  }

  // Keep the common path (string, braces, parentheses) free of another host parse.
  if (start === source.length || OTHER_VALUE_STARTS.includes(source[start]!)) {
    return null;
  }

  // The value ends at attribute whitespace or the tag's `>`/`/>`.
  let end = start;
  while (end < source.length && !/[\s>]/.test(source[end]!) && !source.startsWith('/>', end)) {
    end++;
  }
  if (end === source.length || start === end) {
    return null;
  }

  const parsed = childExpression(source.slice(start, end));
  if (parsed.expression?.type !== 'Identifier' || hasError(parsed.diagnostics)) {
    error('JPX1009', 'An undelimited attribute value must be one identifier; wrap other expressions in (...) or {...}', start, end);
  }

  return {
    start,
    end,
    pieces: [generated('{'), copied(source, start, end), generated('}')],
    // Blanking `=identifier` leaves a boolean attribute in the parser-only tag.
    mask: (shadow, origin) => blankRange(shadow, equals - origin, end - origin),
  };
}
