/**
 * Child grammar: turn the masked text of one body (or conditional block) into
 * JSX children. Nested markup has already been read and masked by the body
 * scanner (element.ts); here each `_` mask is spliced back from `nested`.
 */
import { parse, TokenKind as K } from 'yuku-parser';
import type { IfStatement, Node } from 'yuku-parser';
import { childExpression, childStatements, closingDelimiter, firstError, hasError, isMarkupOpening } from '../host';
import type { BlockView, ChildView, ExpressionView, IfView, Range } from '../model';
import { assemble, generated, replaceRange, type Piece } from '../source';
import type { Children, Markup, MarkupContext } from './context';

interface Child<View> {
  readonly view: View;
  readonly pieces: Piece[];
}

/**
 * Read the children in `code`, the masked text of a body starting at authored
 * offset `start`. `bodyEnd` is the closing delimiter, used to place an
 * "incomplete expression" error at the end of the body.
 */
export function readChildren(
  context: MarkupContext, nested: readonly Markup[], code: string, start: number, bodyEnd: Range,
): Children {
  return new ChildReader(context, nested).body(code, start, bodyEnd);
}

class ChildReader {
  constructor(
    private readonly context: MarkupContext,
    /** Markup already read inside this body, in source order. */
    private readonly nested: readonly Markup[],
  ) {}

  private get source(): string {
    return this.context.source;
  }

  body(code: string, start: number, bodyEnd: Range): Children {
    // A top-level semicolon is an explicit child boundary in G-BOUNDARY. Parse
    // each chunk in expression context before trying host statements, so an
    // object/function/class after another child keeps its expression grammar.
    // ASI and expression continuation within each chunk still belong to yuku.
    const tokens = childStatements(code).tokens;
    const closes: number[] = [];
    const chunks: Range[] = [];
    let chunkStart = 0;

    for (let index = 0; index < tokens.length; index++) {
      const kind = tokens.kind(index);
      const close = closingDelimiter(kind);
      if (close !== undefined) {
        closes.push(close);
      } else if (closes.length > 0 && kind === closes[closes.length - 1]) {
        closes.pop();
      } else if (kind === K.Semicolon && closes.length === 0) {
        chunks.push([chunkStart, tokens.start(index)]);
        chunkStart = tokens.end(index);
      }
    }
    chunks.push([chunkStart, code.length]);

    const children: Children = { views: [], pieces: [] };
    for (const [from, to] of chunks) {
      // A chunk ending at a `;` reports an incomplete expression at that `;`.
      const end: Range = to < code.length ? [start + to, start + to + 1] : bodyEnd;
      const chunk = this.chunk(code.slice(from, to), start + from, end);
      children.views.push(...chunk.views);
      children.pieces.push(...chunk.pieces);
    }
    return children;
  }

  /** One `;`-delimited chunk: a single expression, or ASI-separated statements. */
  private chunk(code: string, start: number, chunkEnd: Range): Children {
    // A top-level comma is not one child (G-CHILD requires parentheses); the
    // statement path below passes it through for the host check to reject.
    const asExpression = childExpression(code);
    const expression = asExpression.expression;
    if (!hasError(asExpression.diagnostics) && expression !== undefined && expression.type !== 'SequenceExpression') {
      const child = this.expressionChild(expression, start - asExpression.origin);
      return { views: [child.view], pieces: child.pieces };
    }

    const parsed = childStatements(code);
    const problem = firstError(parsed.diagnostics);
    if (problem !== undefined) {
      this.reportChunkError(code, start, chunkEnd, parsed, problem);
    }
    return this.statements(parsed.statements, start - parsed.origin);
  }

  private reportChunkError(
    code: string, start: number, chunkEnd: Range,
    parsed: ReturnType<typeof childStatements>, problem: { readonly start: number; readonly message: string },
  ): never {
    const offset = start + problem.start;
    if (problem.start >= code.length) {
      this.context.error('JPX1004', 'Incomplete child expression at its body end', chunkEnd[0], chunkEnd[1]);
    }
    const tokens = parsed.tokens;
    const token = tokens.at(problem.start);

    // Host parsing may read a sibling as a broken `< ... / >` comparison.
    // Confirm the complete tag independently before suggesting a separator.
    if (token >= 1 && tokens.kind(token) === K.GreaterThan && tokens.kind(token - 1) === K.Slash) {
      for (let candidate = token - 2; candidate >= 0; candidate--) {
        if (tokens.kind(candidate) !== K.LessThan) continue;
        const from = tokens.start(candidate);
        const to = tokens.end(token);
        const tag = parse(code.slice(from, to), { lang: 'tsx', sourceType: 'module', tokens: true });
        if (!hasError(tag.diagnostics) && isMarkupOpening(tag.tokens!, 0)) {
          this.context.error('JPX1005', 'Separate this sibling tag from the preceding expression with a semicolon', start + from, start + to);
        }
        break;
      }
    }
    this.context.error('JPX1005', problem.message, offset, token < 0 ? offset + 1 : start + tokens.end(token));
  }

  /** `base` converts parser node offsets to authored offsets. */
  private statements(statements: readonly Node[], base: number): Children {
    const views: ChildView[] = [];
    const pieces: Piece[] = [];

    for (const node of statements) {
      if (node.type === 'EmptyStatement') continue;

      if (node.type === 'IfStatement') {
        const condition = this.conditional(node, base);
        views.push(condition.view);
        pieces.push(generated('{'), ...condition.pieces, generated('}'));
        continue;
      }

      let child: Child<ChildView>;
      if (node.type === 'ExpressionStatement') {
        child = this.expressionChild(node.expression, base);
      } else if (this.isExpressionSpelling(node, base)) {
        child = this.expressionChild(node, base);
      } else {
        this.context.error('HOST', 'This child statement is outside the initial JSX+ core profile', base + node.start, base + node.end);
      }
      views.push(child.view);
      pieces.push(...child.pieces);
    }

    return { views, pieces };
  }

  /**
   * `function f() {}`, `class {}` and `{ a: 1 }` parse as statements at a
   * statement boundary but are expression children here. Accept them when
   * they are valid in expression context; real declarations such as
   * `const x = ...` stay outside the core profile.
   */
  private isExpressionSpelling(node: Node, base: number): boolean {
    if (node.type !== 'FunctionDeclaration' && node.type !== 'ClassDeclaration' && node.type !== 'BlockStatement') {
      return false;
    }
    const candidate = assemble(replaceRange(this.source, base + node.start, base + node.end, this.nested)).code;
    return !hasError(childExpression(candidate).diagnostics);
  }

  private expressionChild(node: Node, base: number): Child<ChildView> {
    const start = base + node.start;
    const maskedEnd = base + node.end;
    // A child that is exactly one `_` mask is nested markup: emit it as is.
    const markup = this.nested.find((entry) => entry.start === start && maskedEnd === start + 1);
    if (markup !== undefined) {
      return { view: markup.view, pieces: [...markup.pieces] };
    }
    const end = this.authoredEnd(maskedEnd);
    return {
      view: this.expressionView(start, end),
      pieces: [generated('{'), ...replaceRange(this.source, start, end, this.nested), generated('}')],
    };
  }

  /**
   * A host expression can end at the one-character mask for nested markup,
   * e.g. `yield <b>...</b>` or a ternary's last arm. Its authored extent must
   * include the entire element before replaceRange can splice it back in.
   */
  private authoredEnd(maskedEnd: number): number {
    return this.nested.find((entry) => entry.start + 1 === maskedEnd)?.end ?? maskedEnd;
  }

  private expressionView(start: number, end: number): ExpressionView {
    return { kind: 'expression', range: [start, end], source: this.source.slice(start, end) };
  }

  private block(node: Node, base: number): Child<BlockView> {
    const start = base + node.start;
    const end = base + node.end;
    if (node.type !== 'BlockStatement') {
      this.context.error('JPX1006', 'Conditional children require a block body', start, end);
    }
    // The body scanner reads every child-level `if`/`else` block with the
    // child grammar before the surrounding statement is parsed. Reading it
    // here instead would apply statement grammar to children, so refuse.
    const children = this.context.blocks.get(start);
    if (children === undefined) {
      this.context.error('INTERNAL', 'Conditional block was not read by the body scanner', start, end);
    }
    return { view: { kind: 'block', range: [start, end], children: children.views }, pieces: children.pieces };
  }

  /** `if (test) {...} else ...` becomes `(test)?<>...</>:...` with `null` for a missing else. */
  private conditional(node: IfStatement, base: number): Child<IfView> {
    const test = this.expressionView(base + node.test.start, this.authoredEnd(base + node.test.end));
    const consequent = this.block(node.consequent, base);
    const alternate = node.alternate === null ? null
      : node.alternate.type === 'IfStatement' ? this.conditional(node.alternate, base)
        : this.block(node.alternate, base);

    // The authored `if (...)` groups the entire test. Keep that grouping when
    // lowering to a ternary, including assignment, comma and nested ternaries.
    const pieces = [
      generated('('), ...replaceRange(this.source, test.range[0], test.range[1], this.nested), generated(')?<>'),
      ...consequent.pieces, generated('</>:'),
    ];
    if (alternate === null) {
      pieces.push(generated('null'));
    } else if (alternate.view.kind === 'if') {
      pieces.push(...alternate.pieces);
    } else {
      pieces.push(generated('<>'), ...alternate.pieces, generated('</>'));
    }

    return {
      view: {
        kind: 'if', range: [base + node.start, base + node.end], test,
        consequent: consequent.view, alternate: alternate?.view ?? null,
      },
      pieces,
    };
  }
}
