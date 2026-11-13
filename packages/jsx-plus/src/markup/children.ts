/**
 * Child grammar: turn the masked text of one body (or conditional block) into
 * JSX children. Nested markup has already been read and masked by the body
 * scanner (element.ts); here each `_` mask is spliced back from `nested`.
 */
import { parse, TokenKind as K } from 'yuku-parser';
import type { IfStatement, Node, SequenceExpression } from 'yuku-parser';
import {
  childExpression, childStatements, closingDelimiter, firstError, hasError, isMarkupOpening, type HostFragment,
} from '../host';
import type { BlockView, ChildView, ExpressionView, ForView, IfView, Range } from '../model';
import { anchored, assemble, generated, replaceRange, type Piece } from '../source';
import type { ChildReplacement, Children, MarkupContext } from './context';

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
  context: MarkupContext, nested: readonly ChildReplacement[], code: string, start: number, bodyEnd: Range,
): Children {
  return new ChildReader(context, nested).body(code, start, bodyEnd);
}

class ChildReader {
  constructor(
    private readonly context: MarkupContext,
    /** Markup and interpolated text already read here, in source order. */
    private readonly nested: readonly ChildReplacement[],
  ) {}

  private get source(): string {
    return this.context.source;
  }

  body(code: string, start: number, bodyEnd: Range): Children {
    // A top-level semicolon is an explicit child boundary in G-BOUNDARY. Parse
    // each chunk in expression context before trying host statements, so an
    // object/function/class after another child keeps its expression grammar.
    // ASI and expression continuation within each chunk still belong to yuku.
    const tokens = childStatements(code, this.context.checking).tokens;
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
    const asExpression = childExpression(code, this.context.checking);
    const expression = asExpression.expression;
    if (!hasError(asExpression.diagnostics) && expression !== undefined) {
      if (expression.type === 'SequenceExpression') {
        this.rejectComma(expression, asExpression, start);
      }
      const child = this.expressionChild(expression, start - asExpression.origin);
      return { views: [child.view], pieces: child.pieces };
    }

    const parsed = childStatements(code, this.context.checking);
    const problem = firstError(parsed.diagnostics);
    if (problem !== undefined) {
      this.reportChunkError(code, start, chunkEnd, parsed, problem);
    }
    return this.statements(parsed, start);
  }

  /**
   * G-CORE: a comma operator used as one child must be parenthesized. The
   * author may have meant a `;`, quoted text or a grouped comma expression.
   */
  private rejectComma(sequence: SequenceExpression, fragment: HostFragment, start: number): never {
    const afterFirst = sequence.expressions[0]!.end - fragment.origin;
    let comma = afterFirst;
    for (let index = 0; index < fragment.tokens.length; index++) {
      if (fragment.tokens.start(index) >= afterFirst && fragment.tokens.kind(index) === K.Comma) {
        comma = fragment.tokens.start(index);
        break;
      }
    }
    this.context.error(
      'JPX1005',
      'A comma does not separate children: use ";" between children, quote text, or parenthesize a comma expression',
      start + comma,
    );
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

  /** ASI-separated children of one chunk, parsed as `fragment`, starting at authored offset `start`. */
  private statements(fragment: HostFragment, start: number): Children {
    // Converts parser node offsets to authored offsets.
    const base = start - fragment.origin;
    const views: ChildView[] = [];
    const pieces: Piece[] = [];

    for (const node of fragment.statements) {
      if (node.type === 'EmptyStatement') continue;

      if (node.type === 'ForOfStatement' || node.type === 'ForInStatement' || node.type === 'ForStatement') {
        const loop = this.loop(node, base);
        views.push(loop.view);
        pieces.push(generated('{'), ...loop.pieces, generated('}'));
        continue;
      }

      if (node.type === 'IfStatement') {
        const condition = this.conditional(node, base);
        views.push(condition.view);
        pieces.push(generated('{'), ...condition.pieces, generated('}'));
        continue;
      }

      let child: Child<ChildView>;
      if (node.type === 'ExpressionStatement') {
        if (node.expression.type === 'SequenceExpression') {
          this.rejectComma(node.expression, fragment, start);
        }
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
    return !hasError(childExpression(candidate, this.context.checking).diagnostics);
  }

  private expressionChild(node: Node, base: number): Child<ChildView> {
    const start = base + node.start;
    const maskedEnd = base + node.end;
    // A complete mask is either markup or an interpolated string expression.
    const replacement = this.nested.find((entry) => entry.start === start && maskedEnd === start + 1);
    if (replacement !== undefined) {
      const pieces = replacement.view.kind === 'expression'
        ? [generated('{'), ...replacement.pieces, generated('}')]
        : [...replacement.pieces];
      return { view: replacement.view, pieces };
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

  /** Empty header expressions still need an exact position for scope completion. */
  private expressionPieces(expression: ExpressionView): Piece[] {
    const [start, end] = expression.range;
    if (this.context.checking && start === end) {
      return [anchored(start)];
    }
    return replaceRange(this.source, start, end, this.nested);
  }

  /** The child block of an `if`/`else` or `for`; `owner` names that construct in errors. */
  private block(node: Node, base: number, owner: 'Conditional' | 'Loop'): Child<BlockView> {
    const start = base + node.start;
    const end = base + node.end;
    if (node.type !== 'BlockStatement') {
      this.context.error('JPX1006', `${owner} children require a block body`, start, end);
    }
    // The body scanner reads every child-level `if`/`else`/`for` block with
    // the child grammar before the surrounding statement is parsed. Reading it
    // here instead would apply statement grammar to children, so refuse.
    const children = this.context.blocks.get(start);
    if (children === undefined) {
      this.context.error('INTERNAL', `${owner} block was not read by the body scanner`, start, end);
    }
    return { view: { kind: 'block', range: [start, end], children: children.views }, pieces: children.pieces };
  }

  /**
   * `for (const binding of iterable) { ... }` becomes
   * `Array.from(iterable, (binding) => row)` (S-FOR). A body that is exactly one
   * element or fragment is the row, so its `key` is the row key; any other
   * body becomes a fragment per iteration.
   */
  private loop(node: Node, base: number): Child<ForView> {
    const start = base + node.start;
    if (node.type !== 'ForOfStatement' || node.await || node.left.type !== 'VariableDeclaration'
      || node.left.kind !== 'const' || node.left.declarations.length !== 1) {
      this.context.error('JPX1010', 'A child loop must be written `for (const item of items) { ... }`', start, start + 'for'.length);
    }

    const pattern = node.left.declarations[0]!.id;
    const binding = this.expressionView(base + pattern.start, this.authoredEnd(base + pattern.end));
    const iterable = this.expressionView(base + node.right.start, this.authoredEnd(base + node.right.end));
    const body = this.block(node.body, base, 'Loop');

    const only = body.view.children.length === 1 ? body.view.children[0]! : undefined;
    const row = only?.kind === 'element' || only?.kind === 'fragment'
      ? body.pieces
      : [generated('<>'), ...body.pieces, generated('</>')];
    const pieces = [
      generated('Array.from('), ...this.expressionPieces(iterable),
      generated(', ('), ...replaceRange(this.source, binding.range[0], binding.range[1], this.nested),
      generated(') => '), ...row, generated(')'),
    ];

    return {
      view: { kind: 'for', range: [start, base + node.end], binding, iterable, body: body.view },
      pieces,
    };
  }

  /** `if (test) {...} else ...` becomes `(test)?<>...</>:...` with `null` for a missing else. */
  private conditional(node: IfStatement, base: number): Child<IfView> {
    const test = this.expressionView(base + node.test.start, this.authoredEnd(base + node.test.end));
    const consequent = this.block(node.consequent, base, 'Conditional');
    const alternate = node.alternate === null ? null
      : node.alternate.type === 'IfStatement' ? this.conditional(node.alternate, base)
        : this.block(node.alternate, base, 'Conditional');

    // The authored `if (...)` groups the entire test. Keep that grouping when
    // lowering to a ternary, including assignment, comma and nested ternaries.
    const pieces = [
      generated('('), ...this.expressionPieces(test), generated(')?<>'),
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
