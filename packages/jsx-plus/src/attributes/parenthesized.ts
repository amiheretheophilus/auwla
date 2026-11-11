import type { Repair } from '../diagnostics';
import { childStatements, closingDelimiter, isMarkupOpening, unterminatedLiteral } from '../host';
import { maskAttributeValue, maskMarkup } from '../masks';
import { closeAttributeValue, closeChildString } from '../repairs';
import { generated, replaceRange } from '../source';
import type { Replacement } from '../source';
import type { AttributeValue } from './value';

interface AttributeReader {
  readonly source: string;
  /** Authored offset of the value's opening `(`. */
  readonly start: number;
  /** Read nested markup that starts at an authored offset. */
  element(start: number): Replacement;
  error(code: string, message: string, start: number, end?: number, repairs?: readonly Repair[]): never;
}

function unmatchedParenthesis(reader: AttributeReader): never {
  return reader.error('JPX1008', "Attribute expression requires a matching ')'", reader.start, reader.start + 1,
    closeAttributeValue(reader.source, reader.start, ')'));
}

/**
 * Read one `=(...)` value with host tokens. Nested markup inside it is
 * normalized first, then masked, and the value is rescanned until its outer
 * `)` is found. The value keeps ordinary expression timing: it becomes `{(...)}`.
 */
export function parenthesizedAttribute(reader: AttributeReader): AttributeValue {
  const { source, start } = reader;
  const nested: Replacement[] = [];
  let shadow = source.slice(start);

  rescan: for (;;) {
    const result = childStatements(shadow);
    const tokens = result.tokens;
    // Once yuku reports the missing `)`, every later token is recovery guesswork.
    const missingParen = result.diagnostics.find((entry) => entry.severity === 'error'
      && (/Expected '\)'/.test(entry.message) || /in parenthesized expression/.test(entry.message)));
    const open: number[] = [];

    for (let index = 0; index < tokens.length; index++) {
      const kind = tokens.kind(index);
      if (missingParen !== undefined && tokens.start(index) >= missingParen.start) {
        unmatchedParenthesis(reader);
      }

      if (isMarkupOpening(tokens, index)) {
        const markup = reader.element(start + tokens.start(index));
        nested.push(markup);
        shadow = maskMarkup(shadow, markup.start - start, markup.end - start);
        continue rescan;
      }

      const close = closingDelimiter(kind);
      if (close !== undefined) {
        open.push(close);
      } else if (open.length > 0 && kind === open[open.length - 1]) {
        open.pop();
        if (open.length === 0) {
          const end = start + tokens.end(index);
          return {
            start,
            end,
            pieces: [generated('{'), ...replaceRange(source, start, end, nested), generated('}')],
            mask: (tag, origin) => maskAttributeValue(tag, start - origin, end - origin),
          };
        }
      }
    }

    const literal = unterminatedLiteral(result, shadow);
    if (literal !== undefined) {
      const quote = start + literal.start;
      reader.error('JPX1003', 'Unterminated string or template in attribute expression', quote, quote + 1,
        closeChildString(source, quote));
    }
    unmatchedParenthesis(reader);
  }
}
