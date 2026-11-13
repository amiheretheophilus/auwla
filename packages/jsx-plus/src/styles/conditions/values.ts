import { tokenize, tokenTypes as T } from 'css-tree';

interface Token {
  readonly type: number;
  readonly start: number;
  readonly end: number;
}

export interface ClassClause {
  readonly start: number;
  readonly headerEnd: number;
  readonly name: string;
  readonly complete: boolean;
  readonly valueStart: number;
  valueEnd: number;
}

export type Report = (message: string, start: number, end: number) => void;

/** CSS tokens keep quoted/commented/URL contents atomic, including escaped identifiers. */
export function classClauses(source: string, report: Report, skipBraces = true): ClassClause[] {
  const tokens: Token[] = [];
  tokenize(source, (type, start, end) => tokens.push({ type, start, end }));
  const clauses: ClassClause[] = [];
  const closes: number[] = [];
  const trivia = (token: Token) => token.type === T.WhiteSpace || token.type === T.Comment;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.type === T.Function || token.type === T.LeftParenthesis) {
      closes.push(T.RightParenthesis);
    } else if (token.type === T.LeftSquareBracket) {
      closes.push(T.RightSquareBracket);
    } else if (skipBraces && token.type === T.LeftCurlyBracket) {
      closes.push(T.RightCurlyBracket);
    } else if (token.type === closes.at(-1)) {
      closes.pop();
    }
    if (closes.length > 0 || source.slice(token.start, token.end) !== '@') {
      continue;
    }
    const dot = tokens[index + 1];
    if (dot === undefined || dot.start !== token.end || source.slice(dot.start, dot.end) !== '.') {
      continue;
    }

    const previous = tokens[index - 1];
    if (previous !== undefined && !trivia(previous)) {
      report('A class condition needs whitespace or a comment before @', token.start, dot.end);
    }
    const name = tokens[index + 2];
    let end = dot.end;
    let className = '';
    let next = index + 2;
    if (name?.type === T.Ident && name.start === dot.end) {
      className = source.slice(name.start, name.end);
      end = name.end;
      next++;
    } else {
      report('Expected a CSS class name after @.', token.start, end);
    }
    while (tokens[next] !== undefined && trivia(tokens[next]!)) {
      next++;
    }
    const colon = tokens[next];
    if (colon?.type === T.Colon) {
      end = colon.end;
    } else if (className !== '') {
      report('Expected : after the class condition', token.start, end);
    }
    if (clauses.length > 0) {
      clauses[clauses.length - 1]!.valueEnd = token.start;
    }
    clauses.push({
      start: token.start,
      headerEnd: end,
      name: className,
      complete: className !== '' && colon?.type === T.Colon,
      valueStart: end,
      valueEnd: source.length,
    });
  }
  return clauses;
}

export function hasValue(source: string): boolean {
  let found = false;
  tokenize(source, (type) => {
    if (type !== T.WhiteSpace && type !== T.Comment) {
      found = true;
    }
  });
  return found;
}
