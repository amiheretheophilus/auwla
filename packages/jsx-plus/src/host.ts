/**
 * Host-parser access for the normalizer: parsing code fragments in a neutral
 * context, offset-adjusted token views and small token-level questions.
 * Parser-owned AST nodes are never modified.
 */
import { parse, TokenKind as K } from 'yuku-parser';
import type { Diagnostic, Node, ParseResult, TokenList } from 'yuku-parser';

/** Token access with offsets relative to the fragment that was parsed. */
export interface HostTokens {
  readonly length: number;
  kind(index: number): number;
  start(index: number): number;
  end(index: number): number;
  /** Index of the token containing `offset`, or -1. */
  at(offset: number): number;
}

class SliceTokens implements HostTokens {
  readonly first: number;
  readonly length: number;

  constructor(readonly tokens: TokenList, readonly origin: number, end: number) {
    let first = 0;
    while (first < tokens.length && tokens.start(first) < origin) first++;

    let last = first;
    while (last < tokens.length && tokens.start(last) < end) last++;

    this.first = first;
    this.length = last - first;
  }

  kind(index: number): number { return this.tokens.kind(this.first + index); }
  start(index: number): number { return this.tokens.start(this.first + index) - this.origin; }
  end(index: number): number { return this.tokens.end(this.first + index) - this.origin; }

  at(offset: number): number {
    const index = this.tokens.at(offset + this.origin) - this.first;
    return index >= 0 && index < this.length ? index : -1;
  }
}

/** True when the token at `index` is the `<` of a JSX element or fragment opener. */
export function isMarkupOpening(tokens: HostTokens, index: number): boolean {
  if (tokens.kind(index) !== K.LessThan || index + 1 >= tokens.length) {
    return false;
  }
  const next = tokens.kind(index + 1);
  return next === K.JSXIdentifier || next === K.GreaterThan;
}

/**
 * The token kind that closes an opening delimiter, or undefined when `kind`
 * opens nothing. Template literals pair a head `` `...${ `` with a tail `` }...` ``.
 */
export function closingDelimiter(kind: number): number | undefined {
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

const PREFIX = 'async function* __jsx_plus_parse__() {\n';

export interface HostFragment {
  /** Subtract origin from parser node offsets to get offsets in the fragment. */
  readonly origin: number;
  readonly statements: readonly Node[];
  readonly tokens: HostTokens;
  readonly diagnostics: readonly Diagnostic[];
  readonly comments: readonly { readonly start: number; readonly end: number }[];
}

/** True when any diagnostic is an error (not a warning). */
export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === 'error');
}

/** The first error-severity diagnostic, if any. */
export function firstError(diagnostics: readonly Diagnostic[]): Diagnostic | undefined {
  return diagnostics.find((entry) => entry.severity === 'error');
}

/**
 * Locate the opening quote/backtick of an unclosed host literal, before parser
 * recovery invents later structure. `boundary` is where the parser reported
 * the problem; tokens from there on are unreliable.
 *
 * Yuku reports some unclosed strings at the end of input. The last completed
 * token before the problem, plus any trivia after it, then locates the opener.
 * An open template has its own head token. Quote characters inside comments
 * are never guessed at.
 */
export function unterminatedLiteral(fragment: HostFragment, source: string): {
  readonly start: number;
  readonly boundary: number;
} | undefined {
  const problem = fragment.diagnostics.find((entry) => /Unterminated (string|template)/.test(entry.message));
  if (problem === undefined) {
    return undefined;
  }

  const templates: number[] = [];
  let previousEnd = 0;
  for (let index = 0; index < fragment.tokens.length; index++) {
    if (fragment.tokens.end(index) > problem.start) {
      break;
    }
    previousEnd = fragment.tokens.end(index);
    const kind = fragment.tokens.kind(index);
    if (kind === K.TemplateHead) {
      templates.push(fragment.tokens.start(index));
    } else if (kind === K.TemplateTail && templates.length > 0) {
      templates.pop();
    }
  }

  let start = /template/.test(problem.message) ? templates[templates.length - 1] : undefined;
  if (start === undefined) {
    start = previousEnd;
    for (const comment of fragment.comments) {
      if (comment.start >= start && comment.end <= problem.start && source.slice(start, comment.start).trim() === '') {
        start = comment.end;
      }
    }
    while (start < source.length && /\s/.test(source[start]!)) {
      start++;
    }
  }
  return { start, boundary: problem.start };
}

function fragment(source: string, expression: boolean): HostFragment {
  const prefix = PREFIX + (expression ? '(' : '');
  const suffix = expression ? '\n);\n}' : '\n}';
  const result: ParseResult = parse(prefix + source + suffix, {
    lang: 'tsx', sourceType: 'module', tokens: true,
  });
  const declaration = result.program.body[0];
  const statements = declaration?.type === 'FunctionDeclaration' && declaration.body !== null
    ? declaration.body.body : [];
  const offset = (position: number) => Math.max(0, Math.min(source.length, position - prefix.length));

  return {
    origin: prefix.length,
    statements,
    tokens: new SliceTokens(result.tokens!, prefix.length, prefix.length + source.length),
    diagnostics: result.diagnostics.map((entry) => ({
      ...entry, start: offset(entry.start), end: offset(entry.end),
    })),
    comments: result.comments
      .filter((comment) => comment.start >= prefix.length && comment.end <= prefix.length + source.length)
      .map((comment) => ({ start: offset(comment.start), end: offset(comment.end) })),
  };
}

/**
 * Parse fragments in a permissive async/generator context so `yield`/`await`
 * keep their expression grammar. This wrapper is a parser input only. It is
 * never emitted, never evaluated and introduces no authored scope. The final
 * normalized module is parsed in its actual context to check legality there.
 */
export function childStatements(source: string): HostFragment {
  return fragment(source, false);
}

/** Parse `source` as one parenthesized expression; `expression` is unset when it is not one. */
export function childExpression(source: string): HostFragment & { readonly expression?: Node } {
  const result = fragment(source, true);
  const statement = result.statements[0];
  const expression = statement?.type === 'ExpressionStatement'
    && statement.expression.type === 'ParenthesizedExpression'
    ? statement.expression.expression : undefined;
  return { ...result, expression };
}

/** Parse a complete module. */
export function parseModule(source: string): ParseResult {
  return parse(source, { lang: 'tsx', sourceType: 'module' });
}
