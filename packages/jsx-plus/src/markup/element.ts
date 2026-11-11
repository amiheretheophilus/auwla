/**
 * Element reading: the opening tag with its attribute values, then the body
 * up to the matching closing tag. Nested markup is read recursively and
 * masked, then the remaining text is rescanned (see masks.ts).
 */
import { TokenKind as K } from 'yuku-parser';
import { parenthesizedAttribute } from '../attributes/parenthesized';
import { identifierAttribute } from '../attributes/identifier';
import type { AttributeValue } from '../attributes/value';
import { childStatements, closingDelimiter, isMarkupOpening, unterminatedLiteral, type HostTokens } from '../host';
import { blankRange, maskMarkup } from '../masks';
import type { ElementView, FragmentView } from '../model';
import { copied, replaceRange } from '../source';
import { readChildren } from './children';
import type { Children, Markup, MarkupContext } from './context';

/** Read the element or fragment whose `<` is at authored offset `start`. */
export function readElement(context: MarkupContext, start: number): Markup {
  const tag = readOpeningTag(context, start);
  const opener = replaceRange(context.source, start, tag.end, tag.attributes);
  if (tag.selfClosing) {
    return {
      start, end: tag.end, pieces: opener,
      view: { kind: 'element', range: [start, tag.end], name: tag.name, children: [] },
    };
  }

  const body = readBody(context, tag.end, tag.name, start);
  const pieces = [...opener, ...body.children.pieces, copied(context.source, body.closeStart, body.end)];
  const range = [start, body.end] as const;
  const view: ElementView | FragmentView = tag.name === ''
    ? { kind: 'fragment', range, children: body.children.views }
    : { kind: 'element', range, name: tag.name, children: body.children.views };
  return { start, end: body.end, pieces, view };
}

interface OpeningTag {
  /** Empty for a fragment. */
  readonly name: string;
  readonly attributes: readonly AttributeValue[];
  /** Authored offset just after the tag's `>`. */
  readonly end: number;
  readonly selfClosing: boolean;
}

/** Element names can be dotted (`a.b`) or namespaced (`svg:rect`). */
function elementName(context: MarkupContext, tokens: HostTokens, start: number): string {
  let nameEnd = tokens.end(1);
  for (let index = 2; index + 1 < tokens.length && (tokens.kind(index) === K.Dot || tokens.kind(index) === K.Colon); index += 2) {
    nameEnd = tokens.end(index + 1);
  }
  return context.source.slice(start + tokens.start(1), start + nameEnd);
}

function readOpeningTag(context: MarkupContext, start: number): OpeningTag {
  const attributes: AttributeValue[] = [];
  let shadow = context.source.slice(start);

  // Each pass scans the opening tag until it either reaches the closing `>`
  // or finds one value needing a rewrite (a bare identifier, a `(...)` value,
  // or markup nested in `{...}`). That value is read, masked in the shadow,
  // and the tag is scanned again, so the host lexer never sees extended syntax.
  for (;;) {
    const tokens = childStatements(shadow).tokens;
    if (tokens.kind(0) !== K.LessThan) context.error('HOST', 'Expected an element', start);

    if (tokens.kind(1) === K.GreaterThan) {
      return { name: '', attributes, end: start + tokens.end(1), selfClosing: false };
    }
    const name = elementName(context, tokens, start);

    let braces = 0;
    let value: AttributeValue | null = null;
    for (let index = 2; index < tokens.length && value === null; index++) {
      const kind = tokens.kind(index);
      if (braces === 0 && kind === K.Assign) {
        value = identifierAttribute(context.source, start + tokens.start(index),
          (code, message, from, to) => context.error(code, message, from, to));
      } else if (braces === 0 && kind === K.LeftParen && tokens.kind(index - 1) === K.Assign) {
        value = parenthesizedAttribute({
          source: context.source,
          start: start + tokens.start(index),
          element: (position) => readElement(context, position),
          error: (code, message, from, to) => context.error(code, message, from, to),
        });
      } else if (braces > 0 && isMarkupOpening(tokens, index)) {
        const markup = readElement(context, start + tokens.start(index));
        value = { ...markup, mask: (tag, origin) => maskMarkup(tag, markup.start - origin, markup.end - origin) };
      } else if (kind === K.LeftBrace) {
        braces++;
      } else if (kind === K.RightBrace) {
        braces--;
      } else if (kind === K.GreaterThan && braces === 0) {
        return { name, attributes, end: start + tokens.end(index), selfClosing: tokens.kind(index - 1) === K.Slash };
      }
    }

    if (value === null) {
      context.error('HOST', 'Incomplete opening tag', start, context.source.length);
    }
    attributes.push(value);
    shadow = value.mask(shadow, start);
  }
}

/** An open delimiter on the body scanner's stack. */
interface Delimiter {
  /** Token kind that closes it. */
  readonly close: number;
  /** A `{` that opens a direct `if`/`else` or `for` child block. */
  readonly childBlock: boolean;
  /** The `(` of a child-level `if (...)` or `for (...)`; a `{` after its `)` is a child block. */
  readonly header: boolean;
  /** Authored offset of the delimiter. */
  readonly start: number;
}

interface Body {
  readonly children: Children;
  /** Authored offset of the closing tag's `<`. */
  readonly closeStart: number;
  /** Authored offset just after the closing tag's `>`. */
  readonly end: number;
}

/**
 * Scan from `start` (just after the opening tag) to the closing tag named
 * `name`. Each pass walks host tokens and stops at the first of:
 *
 * - nested markup: read it, mask it, rescan;
 * - a closed `if`/`else`/`for` child block: read its children, cache them in
 *   `context.blocks`, blank the block, rescan;
 * - the closing tag at child level: read this body's children and return.
 *
 * `opener` is the opening tag's offset, for "unclosed element" errors.
 */
function readBody(context: MarkupContext, start: number, name: string, opener: number): Body {
  const { source } = context;
  const nested: Markup[] = [];
  let shadow = source.slice(start);

  rescan: for (;;) {
    const result = childStatements(shadow);
    const tokens = result.tokens;
    const literal = unterminatedLiteral(result, shadow);
    const stack: Delimiter[] = [];
    let expectChildBlock = false;

    for (let index = 0; index < tokens.length; index++) {
      const kind = tokens.kind(index);
      const position = start + tokens.start(index);
      if (literal !== undefined && tokens.start(index) >= literal.boundary) {
        context.error('JPX1003', 'Unterminated child string or template', start + literal.start);
      }
      const childLevel = stack.length === 0 || stack[stack.length - 1]!.childBlock;
      const previousMarkup = !childLevel || index === 0 ? undefined
        : nested.find((entry) => entry.start === start + tokens.start(index - 1));

      // G-BOUNDARY rule 4: after complete markup, another opening tag or a
      // direct `if`/`for` starts a sibling. `<A/><B/>` or `<A/> if (...)` masks
      // to `_   _` or `_    if` on one line, which the host parser cannot
      // split. Put a `;` in the mask's last column and rescan.
      const afterMarkup = previousMarkup === undefined ? undefined
        : kind === K.LessThan && !source.startsWith('</', position) ? 'tag'
          : kind === K.If || kind === K.For ? 'statement' : undefined;
      if (afterMarkup !== undefined) {
        const separator = previousMarkup!.end - start - 1;
        shadow = shadow.slice(0, separator) + ';' + shadow.slice(separator + 1);
        if (afterMarkup === 'statement') continue rescan;
      }

      if (isMarkupOpening(tokens, index) || afterMarkup === 'tag') {
        const markup = readElement(context, position);
        nested.push(markup);
        shadow = maskMarkup(shadow, markup.start - start, markup.end - start);
        continue rescan;
      }

      // In host mode a closing tag's slash can be rescanned as one whole regex
      // token if another slash occurs later. The body's delimiter wins at this
      // depth (G-BOUNDARY); strings/comments/regex content have no separate `<`.
      if (kind === K.LessThan && source.startsWith('</', position) && childLevel) {
        if (stack.length > 0) context.error('JPX1007', 'Unclosed conditional child block', stack[stack.length - 1]!.start);
        const closeEnd = source.indexOf('>', position + 2);
        if (closeEnd < 0) context.error('JPX1002', 'Unclosed element', opener, start);
        const closingName = source.slice(position + 2, closeEnd).trim();
        if (closingName !== name) context.error('JPX1001', 'Closing tag does not match its opening tag', position, closeEnd + 1);
        const children = readChildren(context, nested, shadow.slice(0, position - start), start, [position, closeEnd + 1]);
        return { children, closeStart: position, end: closeEnd + 1 };
      }

      const close = closingDelimiter(kind);
      if (close !== undefined) {
        const previous = index > 0 ? tokens.kind(index - 1) : undefined;
        const header = kind === K.LeftParen && childLevel && (previous === K.If || previous === K.For);
        stack.push({ close, childBlock: kind === K.LeftBrace && expectChildBlock, header, start: position });
        expectChildBlock = false;
      } else if (stack.length > 0 && kind === stack[stack.length - 1]!.close) {
        const delimiter = stack.pop()!;
        expectChildBlock = delimiter.header;
        if (delimiter.childBlock && !context.blocks.has(delimiter.start)) {
          // A conditional body uses the child grammar, not a JS statement
          // list. Read it now, then blank it for the outer host `if` parse.
          // The cached children keep its actual values.
          const from = delimiter.start - start + 1;
          const to = position - start;
          const children = readChildren(context, nested, shadow.slice(from, to), start + from, [position, position + 1]);
          context.blocks.set(delimiter.start, children);
          shadow = blankRange(shadow, from, to);
          continue rescan;
        }
      } else if (kind === K.Else && childLevel) {
        expectChildBlock = true;
      } else {
        expectChildBlock = false;
      }
    }

    // Reached the end of input without the closing tag: report the most specific cause.
    if (literal !== undefined) {
      context.error('JPX1003', 'Unterminated child string or template', start + literal.start);
    }
    const unclosedBlock = stack.find((delimiter) => delimiter.childBlock);
    if (unclosedBlock !== undefined) {
      context.error('JPX1007', 'Unclosed conditional child block', unclosedBlock.start);
    }
    context.error('JPX1002', 'Unclosed element or fragment', opener, start);
  }
}
