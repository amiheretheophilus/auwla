/**
 * Element reading: the opening tag with its attribute values, then the body
 * up to the matching closing tag. Nested markup is read recursively and
 * masked, then the remaining text is rescanned (see masks.ts).
 */
import { TokenKind as K } from 'yuku-parser';
import { parenthesizedAttribute } from '../attributes/parenthesized';
import { identifierAttribute } from '../attributes/identifier';
import type { AttributeValue } from '../attributes/value';
import { childExpression, childStatements, closingDelimiter, hasError, isMarkupOpening, unterminatedLiteral, type HostTokens } from '../host';
import { blankRange, maskMarkup } from '../masks';
import { JsxPlusError, type Repair } from '../diagnostics';
import type { ElementView, FragmentView, Range } from '../model';
import { blank, closeAttributeValue, closeChildString } from '../repairs';
import { copied, replaceRange } from '../source';
import { readChildren, SIBLING_SEPARATOR } from './children';
import { interpolatedText } from './text';
import type { ChildReplacement, Children, JoinedSibling, Markup, MarkupContext } from './context';

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

  context.open.push(tag.name);
  let body: Body;
  try {
    body = readBody(context, tag.end, tag.name, start);
  } finally {
    context.open.pop();
  }
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
    const tokens = childStatements(shadow, context.checking).tokens;
    if (tokens.kind(0) !== K.LessThan) context.error('HOST', 'Expected an element', start);

    if (tokens.kind(1) === K.GreaterThan) {
      return { name: '', attributes, end: start + tokens.end(1), selfClosing: false };
    }
    const name = elementName(context, tokens, start);

    // Authored offsets of the `{` still open in this scan, and the outermost
    // `{...}` value containers it closed.
    const braces: number[] = [];
    const containers: Range[] = [];
    let value: AttributeValue | null = null;
    for (let index = 2; index < tokens.length && value === null; index++) {
      const kind = tokens.kind(index);
      if (braces.length === 0 && kind === K.Arrow) {
        // `class=>`: the lexer reads `=>` as one token, so the tag would run on
        // to a later `>`. The value is missing (JPX1009, an empty value).
        const greater = start + tokens.start(index) + 1;
        context.error('JPX1009', 'Attribute value is missing after `=`; write a value such as `name={value}`', greater, greater + 1);
      }
      if (braces.length === 0 && kind === K.Assign) {
        value = identifierAttribute(context.source, start + tokens.start(index),
          (code, message, from, to) => context.error(code, message, from, to));
      } else if (braces.length === 0 && kind === K.LeftParen && tokens.kind(index - 1) === K.Assign) {
        value = parenthesizedAttribute({
          source: context.source,
          checking: context.checking,
          start: start + tokens.start(index),
          element: (position) => readElement(context, position),
          error: (code, message, from, to, repairs) => context.error(code, message, from, to, repairs),
        });
      } else if (braces.length > 0 && isMarkupOpening(tokens, index)) {
        const markup = readElement(context, start + tokens.start(index));
        value = { ...markup, mask: (tag, origin) => maskMarkup(tag, markup.start - origin, markup.end - origin) };
      } else if (kind === K.LeftBrace) {
        braces.push(start + tokens.start(index));
      } else if (kind === K.RightBrace) {
        const open = braces.pop();
        if (open !== undefined && braces.length === 0) {
          containers.push([open, start + tokens.start(index)]);
        }
      } else if (kind === K.GreaterThan && braces.length === 0) {
        return { name, attributes, end: start + tokens.end(index), selfClosing: tokens.kind(index - 1) === K.Slash };
      }
    }

    if (value === null) {
      // The tag never ended. An attribute `{` that never closed, or that a later
      // unrelated `}` closed, swallowed the rest of the file: report that `{`.
      // Such a container holds no single expression.
      const unclosed = braces[0] ?? containers.find(([open, close]) =>
        hasError(childExpression(shadow.slice(open - start + 1, close - start), context.checking).diagnostics))?.[0];
      if (unclosed !== undefined) {
        context.error('HOST', 'Unclosed `{` in an attribute value', unclosed, unclosed + 1,
          closeAttributeValue(context.source, unclosed, '}'));
      }
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
  const nested: ChildReplacement[] = [];
  let shadow = source.slice(start);

  function maskQuotedText(position: number): boolean {
    // Inspect the shadow: an authored quote remains under a completed `_` mask.
    const spelling = shadow[position - start];
    if (spelling !== '"' && spelling !== "'") {
      return false;
    }
    const text = interpolatedText(context, position, (offset) => readElement(context, offset));
    if (text === null) {
      return false;
    }
    nested.push(text);
    shadow = maskMarkup(shadow, text.start - start, text.end - start);
    return true;
  }

  rescan: for (;;) {
    const result = childStatements(shadow, context.checking);
    const tokens = result.tokens;
    const literal = unterminatedLiteral(result, shadow);
    const stack: Delimiter[] = [];
    let expectChildBlock = false;
    // Authored offsets of child-level `<` read as comparisons in this pass. A
    // sibling tag written without a `;` after a text or expression child
    // (G-BOUNDARY rule 5) leaves one of these; see `reportJoinedSibling`.
    const comparisons: number[] = [];

    for (let index = 0; index < tokens.length; index++) {
      const kind = tokens.kind(index);
      const position = start + tokens.start(index);
      const childLevel = stack.length === 0 || stack[stack.length - 1]!.childBlock;
      if (childLevel && maskQuotedText(position)) {
        continue rescan;
      }
      if (literal !== undefined && tokens.start(index) >= literal.boundary) {
        // The host lexer can omit an unfinished string token entirely. Recover
        // its authored opener before falling back to the generic string error.
        if (childLevel && maskQuotedText(start + literal.start)) {
          continue rescan;
        }
        context.error('JPX1003', 'Unterminated child string or template', start + literal.start, start + literal.start + 1,
          closeChildString(source, start + literal.start));
      }
      const previousMarkup = !childLevel || index === 0 ? undefined
        : nested.find((entry) => entry.view.kind !== 'expression'
          && entry.start === start + tokens.start(index - 1));

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
      if (kind === K.LessThan && childLevel && !source.startsWith('</', position)) {
        comparisons.push(position);
      }

      // In host mode a closing tag's slash can be rescanned as one whole regex
      // token if another slash occurs later. The body's delimiter wins at this
      // depth (G-BOUNDARY); strings/comments/regex content have no separate `<`.
      if (kind === K.LessThan && source.startsWith('</', position) && childLevel) {
        if (stack.length > 0) context.error('JPX1007', 'Unclosed conditional child block', stack[stack.length - 1]!.start);
        const closing = closingTag(source, position);
        if (closing.end === null) {
          // `</fo` while typing: no `>` follows the name. Never search past it,
          // which would take a later tag's `>` and name.
          context.error('JPX1001', 'Incomplete closing tag', position, closing.nameEnd,
            mismatchRepairs(context, closing.name, [opener, start], [position, closing.nameEnd]));
        }
        const closeEnd = closing.end - 1;
        if (closing.name !== name) {
          reportJoinedSibling(context, comparisons, closing.name, closeEnd + 1);
          context.error('JPX1001', 'Closing tag does not match its opening tag', position, closeEnd + 1,
            mismatchRepairs(context, closing.name, [opener, start], [position, closeEnd + 1]));
        }
        noteSameNameSibling(context, comparisons, name, closeEnd + 1);
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

    // Reached the end of input without the closing tag: report the most specific
    // cause, an open token before an unclosed block or element (D-RECOVERY).
    if (literal !== undefined) {
      const childLevel = stack.length === 0 || stack[stack.length - 1]!.childBlock;
      if (childLevel && maskQuotedText(start + literal.start)) {
        continue rescan;
      }
      context.error('JPX1003', 'Unterminated child string or template', start + literal.start, start + literal.start + 1,
        closeChildString(source, start + literal.start));
    }
    // While a header `(` is open, the closing tag is not at child level, so the
    // scan runs to the end of input.
    const header = stack.find((delimiter) => delimiter.header);
    if (header !== undefined) {
      context.error('JPX1011', 'The `if`/`for` header has no closing `)`', header.start, header.start + 1,
        headerRepairs(tokens, start, header.start));
    }
    const unclosedBlock = stack.find((delimiter) => delimiter.childBlock);
    if (unclosedBlock !== undefined) {
      context.error('JPX1007', 'Unclosed conditional child block', unclosedBlock.start);
    }
    // A nested opener can be set aside so its children belong to the parent.
    // Dropping the outermost opener would instead turn its children into host
    // statements and claim that a wholly unfinished template was checked.
    const repairs = context.open.length > 1 ? [blank([opener, start])] : [];
    context.error('JPX1002', 'Unclosed element or fragment', opener, start, repairs);
  }
}

/**
 * For an unclosed child `if (`/`for (` header, best first: insert the missing
 * `)` before the first `{` after the header, which keeps the loop checked; or set
 * aside the whole statement, keyword through that block's `}`, so the body never
 * reads a binding the broken header no longer declares.
 */
function headerRepairs(tokens: HostTokens, base: number, headerStart: number): Repair[] {
  let index = 0;
  while (index < tokens.length && base + tokens.start(index) !== headerStart) {
    index++;
  }
  if (index === 0 || index >= tokens.length) {
    return [];
  }
  const keyword = base + tokens.start(index - 1);

  const repairs: Repair[] = [];
  let depth = 0;
  for (let cursor = index + 1; cursor < tokens.length; cursor++) {
    const kind = tokens.kind(cursor);
    if (kind === K.LeftBrace && depth++ === 0 && cursor > index + 1) {
      repairs.push({ kind: 'insert', at: base + tokens.end(cursor - 1), text: ')' });
    }
    if (kind === K.RightBrace && depth > 0 && --depth === 0) {
      repairs.push(blank([keyword, base + tokens.end(cursor)]));
      break;
    }
  }
  return repairs;
}

/**
 * The closing tag whose `</` is at `position`: its name (dotted or namespaced,
 * possibly empty for `</>`), and the offset just after its `>`, or null when
 * something other than whitespace follows the name first.
 */
function closingTag(source: string, position: number): { name: string; nameEnd: number; end: number | null } {
  const { name, end: nameEnd } = tagName(source, position + 2);
  let cursor = nameEnd;
  while (cursor < source.length && /\s/.test(source[cursor]!)) {
    cursor++;
  }
  return { name, nameEnd, end: source[cursor] === '>' ? cursor + 1 : null };
}

/** The element name at `cursor`, after any whitespace, and the offset just after it. */
function tagName(source: string, cursor: number): { name: string; end: number } {
  while (cursor < source.length && /\s/.test(source[cursor]!)) {
    cursor++;
  }
  const nameStart = cursor;
  while (cursor < source.length) {
    // Names use Unicode identifier characters, including combining marks and
    // astral letters. Indexing a single UTF-16 unit would split astral names.
    const character = String.fromCodePoint(source.codePointAt(cursor)!);
    if (!/[\p{ID_Continue}$:.\-\u200c\u200d]/u.test(character)) {
      break;
    }
    cursor += character.length;
  }
  return { name: source.slice(nameStart, cursor), end: cursor };
}

/**
 * G-BOUNDARY rule 5: `"Retry?" <button>"Retry"</button>` has no `;` before the
 * tag, so the host reads `"Retry?" < button > ...` as a comparison and the
 * scan later meets `</button>` as if it closed the enclosing element. Before
 * reporting that, find a `<` read as a comparison whose name is the closer's
 * and confirm it really is one whole element ending at that closer (`end`).
 * Then report JPX1005 over its opening tag, with a `;` as the repair. The
 * comparison is never rewritten into a tag; this only chooses the message.
 */
function reportJoinedSibling(context: MarkupContext, comparisons: readonly number[], closingName: string, end: number): void {
  const [sibling] = joinedSiblings(context, comparisons, closingName, end);
  if (sibling !== undefined) {
    context.error('JPX1005', SIBLING_SEPARATOR, sibling.position, sibling.openingEnd,
      [{ kind: 'insert', at: sibling.position, text: ';' }]);
  }
}

/**
 * The same mistake when the joined tag has this element's own name:
 * `<p>"a" <p>"b"</p></p>`. The inner `</p>` matches, so this element closes there and the
 * last `</p>` fails later, somewhere else. `<b>x < b > y</b>` is a real comparison with the same
 * shape, so nothing is reported here: the candidate is only remembered, and
 * `normalize.ts` reports it if the file then fails and a `;` before it gets further.
 */
function noteSameNameSibling(context: MarkupContext, comparisons: readonly number[], name: string, end: number): void {
  context.joinedSiblings.push(...joinedSiblings(context, comparisons, name, end));
}

/**
 * The `<` read as comparisons, latest first, that are also one whole element named
 * `closingName` ending exactly at `end`. Reading one is speculative, so the conditional
 * blocks it cached are dropped again.
 */
function joinedSiblings(context: MarkupContext, comparisons: readonly number[], closingName: string, end: number): JoinedSibling[] {
  const found: JoinedSibling[] = [];
  for (let index = comparisons.length - 1; index >= 0; index--) {
    const position = comparisons[index]!;
    if (tagName(context.source, position + 1).name !== closingName) {
      continue;
    }
    const cached = new Set(context.blocks.keys());
    try {
      const opening = readOpeningTag(context, position);
      if (readElement(context, position).end === end) {
        found.push({ position, openingEnd: opening.end });
      }
    } catch (error) {
      if (!(error instanceof JsxPlusError)) throw error;
    } finally {
      for (const key of [...context.blocks.keys()]) {
        if (!cached.has(key)) context.blocks.delete(key);
      }
    }
  }
  return found;
}

/**
 * Where a mismatched closing tag's damage likely is. When an enclosing element
 * has its name, this element was left unclosed: set aside its opening tag, so
 * its children belong to the parent. Otherwise the closing tag is stray.
 */
function mismatchRepairs(context: MarkupContext, closingName: string, opening: Range, closing: Range): Repair[] {
  const enclosing = context.open.slice(0, -1);
  const order = enclosing.includes(closingName) ? [opening, closing] : [closing, opening];
  return order.map(blank);
}
