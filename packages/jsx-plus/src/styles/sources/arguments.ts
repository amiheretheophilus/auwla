import { ident, string, tokenize, tokenTypes as T } from 'css-tree';

interface Token {
  readonly type: number;
  readonly start: number;
  readonly end: number;
}

export interface UseArgument {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly closed: boolean;
  readonly value: string;
}

export interface UseCall {
  readonly start: number;
  readonly path?: UseArgument;
  readonly id?: UseArgument;
}

/** Tolerant argument ranges, using CSS tokens rather than matching strings with regex. */
export function readUseCalls(source: string, base = 0): readonly UseCall[] {
  const tokens: Token[] = [];
  tokenize(source, (type, start, end) => tokens.push({ type, start, end }));
  const calls: UseCall[] = [];
  const closes: number[] = [];
  const trivia = (token: Token) => token.type === T.WhiteSpace || token.type === T.Comment;
  const next = (start: number): number => {
    while (tokens[start] !== undefined && trivia(tokens[start]!)) {
      start++;
    }
    return start;
  };

  function argument(token: Token | undefined): UseArgument | undefined {
    if (token === undefined || (token.type !== T.String && token.type !== T.BadString)) {
      return undefined;
    }
    const quote = source[token.start]!;
    let escapes = 0;
    for (let offset = token.end - 2; source[offset] === '\\'; offset--) {
      escapes++;
    }
    const closed = source[token.end - 1] === quote && escapes % 2 === 0 && token.end > token.start + 1;
    const start = token.start + 1;
    const end = token.end - (closed ? 1 : 0);
    return { start: base + start, end: base + end, quote, closed, value: string.decode(source.slice(token.start, token.end)) };
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (closes.length === 0 && token.type === T.AtKeyword
      && ident.decode(source.slice(token.start + 1, token.end)).toLowerCase() === 'use') {
      const opening = next(index + 1);
      if (tokens[opening]?.type === T.LeftParenthesis) {
        const pathIndex = next(opening + 1);
        const comma = next(pathIndex + 1);
        calls.push({
          start: base + token.start,
          path: argument(tokens[pathIndex]),
          id: tokens[comma]?.type === T.Comma ? argument(tokens[next(comma + 1)]) : undefined,
        });
      }
    }
    if (token.type === T.LeftCurlyBracket) {
      closes.push(T.RightCurlyBracket);
    } else if (token.type === T.Function || token.type === T.LeftParenthesis) {
      closes.push(T.RightParenthesis);
    } else if (token.type === T.LeftSquareBracket) {
      closes.push(T.RightSquareBracket);
    } else if (token.type === closes.at(-1)) {
      closes.pop();
    }
  }
  return calls;
}

/** Native CSS string escaping, preserving the author's selected quote character. */
export function argumentText(value: string, quote: string): string {
  return string.encode(value, quote === "'").slice(1, -1);
}
