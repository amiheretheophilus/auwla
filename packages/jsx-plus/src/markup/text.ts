import { TokenKind as K } from 'yuku-parser';
import { childExpression, childStatements, closingDelimiter, hasError, isMarkupOpening, unterminatedLiteral } from '../host';
import { maskMarkup } from '../masks';
import { closeChildString, closeTextInterpolation } from '../repairs';
import { assemble, copied, generated, replaceRange, type Piece } from '../source';
import type { ChildReplacement, Markup, MarkupContext } from './context';

interface Substitution {
  /** The authored offset of the matching `}`. */
  readonly close: number;
  readonly pieces: Piece[];
}

/** Read one substitution with host tokens, including nested markup expressions. */
function readSubstitution(
  context: MarkupContext, open: number, quote: string, element: (start: number) => Markup,
): Substitution {
  const start = open + 1;
  const nested: Markup[] = [];
  let shadow = context.source.slice(start);

  rescan: for (;;) {
    const parsed = childStatements(shadow, context.checking);
    const tokens = parsed.tokens;
    const literal = unterminatedLiteral(parsed, shadow);
    const closes: number[] = [];
    let passedClosingTag = false;
    for (let index = 0; index < tokens.length; index++) {
      const kind = tokens.kind(index);
      const position = start + tokens.start(index);
      if (literal !== undefined && tokens.start(index) >= literal.boundary) {
        break;
      }
      if (kind === K.RightBrace && closes.length === 0) {
        // Preserve `${}` in the checking view so TypeScript can offer scope
        // completion at its empty expression. Production parsing stays strict.
        if (index === 0 && !context.checking) {
          context.error('JPX1013', 'Quoted text interpolation requires an expression', open, open + 1);
        }
        const pieces = replaceRange(context.source, start, position, nested);
        // A missing closer can make host recovery borrow the component's `}`
        // after its closing tag. Accept a tag-like sequence only when it was
        // valid host syntax, such as `value</p>/.test(text)` with a regex.
        if (passedClosingTag && hasError(childExpression(assemble(pieces).code).diagnostics)) {
          break;
        }
        return { close: position, pieces };
      }

      if (closes.length === 0 && kind === K.LessThan && context.source.startsWith('</', position)) {
        passedClosingTag = true;
      }

      if (isMarkupOpening(tokens, index)) {
        const markup = element(position);
        nested.push(markup);
        shadow = maskMarkup(shadow, markup.start - start, markup.end - start);
        continue rescan;
      }

      const close = closingDelimiter(kind);
      if (close !== undefined) {
        closes.push(close);
      } else if (closes.length > 0 && kind === closes[closes.length - 1]) {
        closes.pop();
      }
    }
    context.error('JPX1012', 'Quoted text interpolation requires a matching `}`', open, open + 1,
      closeTextInterpolation(context.source, open, quote));
  }
}

/** Copy host string escapes verbatim; escape only raw backticks for the template. */
function textPieces(source: string, start: number, end: number): Piece[] {
  const pieces: Piece[] = [];
  let copiedFrom = start;
  for (let cursor = start; cursor < end; cursor++) {
    if (source[cursor] === '\\') {
      cursor++;
    } else if (source[cursor] === '`') {
      pieces.push(copied(source, copiedFrom, cursor), generated('\\'));
      copiedFrom = cursor;
    }
  }
  pieces.push(copied(source, copiedFrom, end));
  return pieces;
}

/**
 * Read a quoted child-level text token. Static strings are left to the host;
 * interpolated text becomes one native template expression. Original quotes
 * are not mapped to the generated backticks, and generated `$` markers have
 * no authored span. Every copied substitution keeps its actual source offsets.
 */
export function interpolatedText(
  context: MarkupContext, start: number, element: (start: number) => Markup,
): ChildReplacement | null {
  const source = context.source;
  const quote = source[start];
  let cursor = start + 1;
  let segmentStart = cursor;
  let hasSubstitution = false;
  const pieces: Piece[] = [generated('`')];

  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      cursor += source[cursor + 1] === '\r' && source[cursor + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (character === quote) {
      if (!hasSubstitution) {
        return null;
      }
      pieces.push(...textPieces(source, segmentStart, cursor), generated('`'));
      const end = cursor + 1;
      return {
        start, end, pieces,
        view: { kind: 'expression', range: [start, end], source: source.slice(start, end) },
      };
    }
    if (character === '\n' || character === '\r') {
      break;
    }
    if (character === '{') {
      pieces.push(...textPieces(source, segmentStart, cursor));
      const expression = readSubstitution(context, cursor, quote!, element);
      pieces.push(generated('$'), copied(source, cursor, cursor + 1),
        ...expression.pieces, copied(source, expression.close, expression.close + 1));
      hasSubstitution = true;
      cursor = expression.close + 1;
      segmentStart = cursor;
      continue;
    }
    cursor++;
  }

  if (hasSubstitution) {
    context.error('JPX1003', 'Unterminated child string or template', start, start + 1,
      closeChildString(source, start));
  }
  return null;
}
