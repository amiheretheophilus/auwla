import { TokenKind as K } from 'yuku-parser';
import { childStatements, maskMarkup } from '../host';
import { generated, replaceRange } from '../source';
import type { Replacement } from '../source';

interface AttributeReader {
  readonly source: string;
  readonly start: number;
  element(start: number): Replacement;
  error(code: string, message: string, start: number, end?: number): never;
}

/** Keep the opening-tag lexer in JSX mode after replacing a whole value. */
export function maskAttribute(source: string, start: number, end: number): string {
  let first = true;
  const inside = source.slice(start + 1, end - 1).replace(/[^\r\n]/g, () => {
    const character = first ? '0' : ' ';
    first = false;
    return character;
  });
  return source.slice(0, start) + '{' + inside + '}' + source.slice(end);
}

function closingToken(kind: number): number | undefined {
  switch (kind) {
    case K.LeftParen:
      return K.RightParen;
    case K.LeftBracket:
      return K.RightBracket;
    case K.LeftBrace:
      return K.RightBrace;
    case K.TemplateHead:
      return K.TemplateTail;
    default:
      return undefined;
  }
}

/** Read one =(...) value with host tokens, recursively normalizing its markup. */
export function parenthesizedAttribute(reader: AttributeReader): Replacement {
  const { source, start } = reader;
  const nested: Replacement[] = [];
  let shadow = source.slice(start);

  for (;;) {
    const result = childStatements(shadow);
    const tokens = result.tokens;
    const closes: { readonly kind: number; readonly start: number }[] = [];
    let changed = false;

    for (let index = 0; index < tokens.length; index++) {
      const kind = tokens.kind(index);
      if (kind === K.LessThan && index + 1 < tokens.length
        && (tokens.kind(index + 1) === K.JSXIdentifier || tokens.kind(index + 1) === K.GreaterThan)) {
        const markup = reader.element(start + tokens.start(index));
        nested.push(markup);
        shadow = maskMarkup(shadow, markup.start - start, markup.end - start);
        changed = true;
        break;
      }

      const close = closingToken(kind);
      if (close !== undefined) {
        closes.push({ kind: close, start: tokens.start(index) });
      } else if (closes.length > 0 && kind === closes[closes.length - 1]!.kind) {
        closes.pop();
        if (closes.length === 0) {
          const end = start + tokens.end(index);
          return {
            start,
            end,
            pieces: [generated('{'), ...replaceRange(source, start, end, nested), generated('}')],
          };
        }
      }
    }

    if (changed) {
      continue;
    }
    const literal = result.diagnostics.find((diagnostic) => {
      return /Unterminated (string|template)/.test(diagnostic.message);
    });
    if (literal !== undefined) {
      // Yuku reports some unclosed literals at EOF. The last completed token
      // and its trivia locate a string opener; an open template has its own
      // delimiter token. Do not guess from quote characters inside comments.
      const template = /template/.test(literal.message)
        ? closes.findLast((delimiter) => delimiter.kind === K.TemplateTail) : undefined;
      let quote = template?.start ?? (tokens.length === 0 ? 0 : tokens.end(tokens.length - 1));
      if (template === undefined) {
        for (const comment of result.comments) {
          if (comment.start >= quote && shadow.slice(quote, comment.start).trim() === '') {
            quote = comment.end;
          }
        }
        while (quote < shadow.length && /\s/.test(shadow[quote]!)) {
          quote++;
        }
      }
      reader.error('JPX1003', 'Unterminated string or template in attribute expression', start + quote);
    }
    reader.error('JPX1008', "Attribute expression requires a matching ')'", start);
  }
}
