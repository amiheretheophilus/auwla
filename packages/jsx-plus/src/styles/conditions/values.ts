import { tokenize, tokenTypes as T } from 'css-tree';

interface Token {
  readonly type: number;
  readonly start: number;
  readonly end: number;
}

interface ClauseRange {
  readonly start: number;
  readonly headerEnd: number;
  readonly complete: boolean;
  readonly valueStart: number;
  valueEnd: number;
}

export type ConditionClause = ClauseRange & (
  | { readonly kind: 'class'; readonly name: string }
  | { readonly kind: 'viewport'; readonly minWidth: string }
);

export type Report = (message: string, start: number, end: number) => void;

/** CSS tokens keep quoted/commented/URL contents atomic, including escaped identifiers. */
export function conditionClauses(source: string, report: Report, skipBraces = true): ConditionClause[] {
  const tokens: Token[] = [];
  tokenize(source, (type, start, end) => tokens.push({ type, start, end }));
  const clauses: ConditionClause[] = [];
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
    const head = tokens[index + 1];
    if (head === undefined || head.start !== token.end) {
      continue;
    }
    const isClass = source.slice(head.start, head.end) === '.';
    const isViewport = head.type === T.Number || head.type === T.Dimension || head.type === T.Percentage;
    if (!isClass && !isViewport) {
      continue;
    }

    const label = isClass ? 'class' : 'viewport';
    const previous = tokens[index - 1];
    if (previous !== undefined && !trivia(previous)) {
      report(`A ${label} condition needs whitespace or a comment before @`, token.start, head.end);
    }

    let end = head.end;
    let next = index + 2;
    let condition: { kind: 'class'; name: string } | { kind: 'viewport'; minWidth: string };
    let valid = true;
    if (isClass) {
      const name = tokens[next];
      if (name?.type === T.Ident && name.start === head.end) {
        condition = { kind: 'class', name: source.slice(name.start, name.end) };
        end = name.end;
        next++;
      } else {
        condition = { kind: 'class', name: '' };
        valid = false;
        report('Expected a CSS class name after @.', token.start, end);
      }
    } else {
      const threshold = source.slice(head.start, head.end);
      const minWidth = viewportWidth(threshold);
      condition = { kind: 'viewport', minWidth: minWidth ?? '' };
      if (minWidth === undefined) {
        valid = false;
        report('A viewport threshold must be a finite nonnegative number with no unit, px, em or rem', token.start, end);
      }
    }

    while (tokens[next] !== undefined && trivia(tokens[next]!)) {
      next++;
    }
    const colon = tokens[next];
    if (colon?.type === T.Colon) {
      end = colon.end;
    } else if (valid) {
      report(`Expected : after the ${label} condition`, token.start, end);
    }
    if (clauses.length > 0) {
      clauses[clauses.length - 1]!.valueEnd = token.start;
    }
    clauses.push({
      start: token.start,
      headerEnd: end,
      ...condition,
      complete: valid && colon?.type === T.Colon,
      valueStart: end,
      valueEnd: source.length,
    });
  }
  return clauses;
}

/** Normalize threshold units only; ordinary CSS property values keep their units. */
function viewportWidth(source: string): string | undefined {
  const match = /^([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(px|em|rem)?$/i.exec(source);
  if (match === null) {
    return undefined;
  }
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }
  // Avoid Number#toString turning tiny valid CSS numbers into exponent output
  // unnecessarily; the CSS tokenizer already established the numeric boundary.
  return `${match[1]}${(match[2] ?? 'px').toLowerCase()}`;
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
