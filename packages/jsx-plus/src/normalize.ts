/**
 * A syntax adapter, not a JavaScript parser or reactive compiler. Yuku supplies
 * host tokens and statement/expression structure. Temporary, equal-width masks
 * let it scan past each extended element without changing authored offsets.
 * Only the emitted TSX is handed to compiler-next; masks never leave this file.
 */
import { parse, TokenKind as K } from 'yuku-parser';
import type { Node, TokenList, ParseResult, IfStatement } from 'yuku-parser';
import { JsxPlusError } from './diagnostics';
import type { BlockView, ChildView, ElementView, ExpressionView, FragmentView, IfView, NormalizedSource } from './model';
import { assemble, copied, generated, replaceRange, type Piece, type Replacement } from './source';

interface Markup extends Replacement {
  readonly view: ElementView | FragmentView;
}

interface Children {
  readonly views: ChildView[];
  readonly pieces: Piece[];
}

interface Delimiter {
  readonly close: number;
  readonly childBlock: boolean;
  readonly ifHeader: boolean;
  readonly start: number;
}

const lex = (source: string): ParseResult => parse(source, { lang: 'tsx', sourceType: 'module', tokens: true });

function opening(tokens: TokenList, index: number): boolean {
  return tokens.kind(index) === K.LessThan && index + 1 < tokens.length
    && (tokens.kind(index + 1) === K.JSXIdentifier || tokens.kind(index + 1) === K.GreaterThan);
}

function mask(source: string, start: number, end: number): string {
  // Preserve UTF-16 width and line breaks, including CRLF and surrogate pairs.
  return source.slice(0, start) + '_' + source.slice(start + 1, end).replace(/[^\r\n]/g, ' ') + source.slice(end);
}

class Reader {
  constructor(readonly source: string, readonly filename: string) {}

  error(code: string, message: string, start: number, end = start + 1): never {
    throw new JsxPlusError(code, message, this.filename, [start, Math.min(end, this.source.length)], this.source);
  }

  file(): NormalizedSource {
    const roots: Markup[] = [];
    let shadow = this.source;

    for (;;) {
      const result = lex(shadow);
      const tokens = result.tokens!;
      let start: number | undefined;

      for (let index = 0; index < tokens.length; index++) {
        if (opening(tokens, index)) {
          start = tokens.start(index);
          break;
        }
      }

      if (start === undefined) break;
      const markup = this.element(start);
      roots.push(markup);
      shadow = mask(shadow, markup.start, markup.end);
    }

    const output = assemble(replaceRange(this.source, 0, this.source.length, roots));
    // Validate ordinary host context after normalization. No custom evaluator or
    // second set of binding rules is introduced by this adapter.
    const result = parse(output.code, { lang: 'tsx', sourceType: 'module' });
    const problem = result.diagnostics.find((entry) => entry.severity === 'error');
    if (problem !== undefined) {
      const mapping = output.mappings.find((entry) => entry.generated[0] <= problem.start && problem.start < entry.generated[1]);
      const start = mapping === undefined ? 0 : mapping.authored[0] + problem.start - mapping.generated[0];
      this.error('HOST', problem.message, start);
    }

    return { ...output, roots: roots.map((entry) => entry.view) };
  }

  element(start: number): Markup {
    const attributes: Markup[] = [];
    let shadow = this.source.slice(start);
    let openingEnd = 0;
    let name = '';
    let selfClosing = false;

    // Attribute expressions can themselves contain extended markup. Normalize
    // those recursively before using the host tokens to locate the outer `>`.
    for (;;) {
      const tokens = lex(shadow).tokens!;
      let braces = 0;
      let nested: Markup | undefined;
      const first = 0;
      if (tokens.kind(first) !== K.LessThan) this.error('HOST', 'Expected an element', start);

      if (tokens.kind(1) === K.GreaterThan) {
        openingEnd = start + tokens.end(1);
        break;
      }

      let nameEnd = tokens.end(1);
      for (let index = 2; index + 1 < tokens.length && (tokens.kind(index) === K.Dot || tokens.kind(index) === K.Colon); index += 2) {
        nameEnd = tokens.end(index + 1);
      }
      name = this.source.slice(start + tokens.start(1), start + nameEnd);

      for (let index = 2; index < tokens.length; index++) {
        const kind = tokens.kind(index);
        if (braces > 0 && opening(tokens, index)) {
          nested = this.element(start + tokens.start(index));
          break;
        }
        if (kind === K.LeftBrace) braces++;
        if (kind === K.RightBrace) braces--;
        if (kind === K.GreaterThan && braces === 0) {
          openingEnd = start + tokens.end(index);
          selfClosing = tokens.kind(index - 1) === K.Slash;
          break;
        }
      }

      if (nested === undefined) break;
      attributes.push(nested);
      shadow = mask(shadow, nested.start - start, nested.end - start);
    }

    if (openingEnd === 0) this.error('HOST', 'Incomplete opening tag', start, this.source.length);
    const opener = replaceRange(this.source, start, openingEnd, attributes);
    if (selfClosing) {
      return { start, end: openingEnd, pieces: opener,
        view: { kind: 'element', range: [start, openingEnd], name, children: [] } };
    }

    const body = this.body(openingEnd, name, start);
    const pieces = [...opener, ...body.children.pieces, copied(this.source, body.closeStart, body.end)];
    const range = [start, body.end] as const;
    const view: ElementView | FragmentView = name === ''
      ? { kind: 'fragment', range, children: body.children.views }
      : { kind: 'element', range, name, children: body.children.views };
    return { start, end: body.end, pieces, view };
  }

  body(start: number, name: string, opener: number): { children: Children; closeStart: number; end: number } {
    const nested: Markup[] = [];
    let shadow = this.source.slice(start);

    for (;;) {
      const result = lex(shadow);
      const tokens = result.tokens!;
      const stack: Delimiter[] = [];
      let expectChildBlock = false;
      let changed = false;

      for (let index = 0; index < tokens.length; index++) {
        const kind = tokens.kind(index);
        const position = start + tokens.start(index);
        const childLevel = stack.length === 0 || stack[stack.length - 1]!.childBlock;
        const previousMarkup = index === 0 ? undefined : nested.find((entry) => entry.start === start + tokens.start(index - 1));
        const adjacent = childLevel && previousMarkup !== undefined && kind === K.LessThan
          && !this.source.startsWith('</', position);

        if (opening(tokens, index) || adjacent) {
          if (adjacent) {
            const separator = previousMarkup!.end - start - 1;
            shadow = shadow.slice(0, separator) + ';' + shadow.slice(separator + 1);
          }
          const markup = this.element(position);
          nested.push(markup);
          shadow = mask(shadow, markup.start - start, markup.end - start);
          changed = true;
          break;
        }

        // In host mode a closing tag's slash can be rescanned as one whole regex
        // token if another slash occurs later. The body's delimiter wins at this
        // depth (G-BOUNDARY); strings/comments/regex content have no separate `<`.
        if (kind === K.LessThan && this.source.startsWith('</', position) && childLevel) {
          if (stack.length > 0) this.error('JPX1007', 'Unclosed conditional child block', stack[stack.length - 1]!.start);
          const closeEnd = this.source.indexOf('>', position + 2);
          if (closeEnd < 0) this.error('JPX1002', 'Unclosed element', opener, start);
          const closingName = this.source.slice(position + 2, closeEnd).trim();
          if (closingName !== name) this.error('JPX1001', 'Closing tag does not match its opening tag', position, closeEnd + 1);
          const bodyCode = shadow.slice(0, position - start);
          // A body containing one host expression may begin with an object,
          // function or class. Parse it in expression context first; a Program
          // would reinterpret those as declarations/blocks. Multiple child
          // statements and direct `if` fall through to the statement parser.
          const expressionResult = lex(`(${bodyCode})`);
          const expressionStatement = expressionResult.program.body[0];
          if (!expressionResult.diagnostics.some((entry) => entry.severity === 'error')
            && expressionStatement?.type === 'ExpressionStatement'
            && expressionStatement.expression.type === 'ParenthesizedExpression') {
            const expression = expressionStatement.expression.expression;
            if (expression.type !== 'SequenceExpression') {
              const child = this.expressionChild(expression, start - 1, nested);
              return { children: { views: [child.view], pieces: child.pieces }, closeStart: position, end: closeEnd + 1 };
            }
          }
          const parsed = lex(bodyCode);
          const problem = parsed.diagnostics.find((entry) => entry.severity === 'error');
          if (problem !== undefined) {
            const offset = start + problem.start;
            if (problem.start >= bodyCode.length) this.error('JPX1004', 'Incomplete child expression', position, closeEnd + 1);
            const token = parsed.tokens!.at(problem.start);
            // A self-closing sibling after a non-markup value can be read as a
            // broken `< ... / >` comparison in host mode. Confirm the candidate
            // with the host JSX parser, then point at the whole opening tag.
            if (token >= 1 && parsed.tokens!.kind(token) === K.GreaterThan
              && parsed.tokens!.kind(token - 1) === K.Slash) {
              for (let candidate = token - 2; candidate >= 0; candidate--) {
                if (parsed.tokens!.kind(candidate) !== K.LessThan) continue;
                const from = parsed.tokens!.start(candidate);
                const to = parsed.tokens!.end(token);
                const tag = lex(bodyCode.slice(from, to));
                if (!tag.diagnostics.some((entry) => entry.severity === 'error') && opening(tag.tokens!, 0)) {
                  this.error('JPX1005', 'Separate this sibling tag from the preceding expression with a semicolon', start + from, start + to);
                }
                break;
              }
            }
            this.error('JPX1005', problem.message, offset, token < 0 ? offset + 1 : start + parsed.tokens!.end(token));
          }
          return { children: this.children(parsed.program.body, start, nested), closeStart: position, end: closeEnd + 1 };
        }

        if (kind === K.LeftParen || kind === K.LeftBracket || kind === K.LeftBrace || kind === K.TemplateHead) {
          const ifHeader = kind === K.LeftParen && childLevel && index > 0 && tokens.kind(index - 1) === K.If;
          stack.push({ close: kind === K.LeftParen ? K.RightParen : kind === K.LeftBracket ? K.RightBracket
            : kind === K.TemplateHead ? K.TemplateTail : K.RightBrace,
          childBlock: kind === K.LeftBrace && expectChildBlock, ifHeader, start: position });
          expectChildBlock = false;
        } else if (stack.length > 0 && kind === stack[stack.length - 1]!.close) {
          expectChildBlock = stack.pop()!.ifHeader;
        } else if (kind === K.Else && childLevel) {
          expectChildBlock = true;
        } else {
          expectChildBlock = false;
        }
      }

      if (changed) continue;
      const unterminated = result.diagnostics.find((entry) => /Unterminated (string|template)/.test(entry.message));
      if (unterminated !== undefined) {
        const end = tokens.length === 0 ? 0 : tokens.end(tokens.length - 1);
        let quote = end;
        while (/\s/.test(shadow[quote] ?? '') && quote < shadow.length) quote++;
        this.error('JPX1003', 'Unterminated child string or template', start + quote);
      }
      this.error('JPX1002', 'Unclosed element or fragment', opener, start);
    }
  }

  children(statements: readonly Node[], base: number, nested: readonly Markup[]): Children {
    const views: ChildView[] = [];
    const pieces: Piece[] = [];

    for (const node of statements) {
      if (node.type === 'EmptyStatement') continue;
      if (node.type === 'IfStatement') {
        const condition = this.conditional(node, base, nested);
        views.push(condition.view);
        pieces.push(generated('{'), ...condition.pieces, generated('}'));
        continue;
      }
      if (node.type !== 'ExpressionStatement') {
        // These are expression spellings in a child body even though the
        // boundary parser sees statement forms. Validate in expression context;
        // actual declaration statements such as `const x = ...` stay deferred.
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'BlockStatement') {
          const candidate = assemble(replaceRange(this.source, base + node.start, base + node.end, nested)).code;
          if (!lex(`(${candidate})`).diagnostics.some((entry) => entry.severity === 'error')) {
            const child = this.expressionChild(node, base, nested);
            views.push(child.view);
            pieces.push(...child.pieces);
            continue;
          }
        }
        this.error('HOST', 'This child statement is outside the initial JSX+ core profile', base + node.start, base + node.end);
      }

      const child = this.expressionChild(node.expression, base, nested);
      views.push(child.view);
      pieces.push(...child.pieces);
    }

    return { views, pieces };
  }

  expressionChild(node: Node, base: number, nested: readonly Markup[]): { view: ChildView; pieces: Piece[] } {
    const start = base + node.start;
    const maskedEnd = base + node.end;
    const markup = nested.find((entry) => entry.start === start && maskedEnd === start + 1);
    const end = markup?.end ?? maskedEnd;
    return markup === undefined
      ? { view: this.expression(start, end), pieces: [generated('{'),
        ...replaceRange(this.source, start, end, nested), generated('}')] }
      : { view: markup.view, pieces: [...markup.pieces] };
  }

  expression(start: number, end: number): ExpressionView {
    return { kind: 'expression', range: [start, end], source: this.source.slice(start, end) };
  }

  block(node: Node, base: number, nested: readonly Markup[]): { view: BlockView; pieces: Piece[] } {
    if (node.type !== 'BlockStatement') this.error('JPX1006', 'Conditional children require a block body', base + node.start, base + node.end);
    const children = this.children(node.body, base, nested);
    return { view: { kind: 'block', range: [base + node.start, base + node.end], children: children.views }, pieces: children.pieces };
  }

  conditional(node: IfStatement, base: number, nested: readonly Markup[]): { view: IfView; pieces: Piece[] } {
    const test = this.expression(base + node.test.start, base + node.test.end);
    const consequent = this.block(node.consequent, base, nested);
    const alternate = node.alternate === null ? null : node.alternate.type === 'IfStatement'
      ? this.conditional(node.alternate, base, nested) : this.block(node.alternate, base, nested);
    // The authored `if (...)` groups the entire test. Keep that grouping when
    // lowering to a ternary, including assignment, comma and nested ternaries.
    const pieces = [generated('('), ...replaceRange(this.source, test.range[0], test.range[1], nested), generated(')?<>'),
      ...consequent.pieces, generated('</>:')];
    if (alternate === null) pieces.push(generated('null'));
    else if (alternate.view.kind === 'if') pieces.push(...alternate.pieces);
    else pieces.push(generated('<>'), ...alternate.pieces, generated('</>'));

    return { view: { kind: 'if', range: [base + node.start, base + node.end], test,
      consequent: consequent.view, alternate: alternate?.view ?? null }, pieces };
  }
}

/** Extended source in; standard TSX plus exact copied-span mappings out. */
export function normalize(source: string, options: { readonly filename?: string } = {}): NormalizedSource {
  return new Reader(source, options.filename ?? './App.auwla').file();
}
