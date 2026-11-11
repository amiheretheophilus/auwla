import { parse } from 'yuku-parser';
import type { Diagnostic, Node, ParseResult, TokenList } from 'yuku-parser';

/** Only this token view adjusts offsets; parser-owned AST nodes stay untouched. */
export interface HostTokens {
  readonly length: number;
  kind(index: number): number;
  start(index: number): number;
  end(index: number): number;
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

const PREFIX = 'async function* __jsx_plus_parse__() {\n';

export interface HostFragment {
  /** Subtract origin from parser node offsets to get offsets in the fragment. */
  readonly origin: number;
  readonly statements: readonly Node[];
  readonly tokens: HostTokens;
  readonly diagnostics: readonly Diagnostic[];
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

export function childExpression(source: string): HostFragment & { readonly expression?: Node } {
  const result = fragment(source, true);
  const statement = result.statements[0];
  const expression = statement?.type === 'ExpressionStatement'
    && statement.expression.type === 'ParenthesizedExpression'
    ? statement.expression.expression : undefined;
  return { ...result, expression };
}
