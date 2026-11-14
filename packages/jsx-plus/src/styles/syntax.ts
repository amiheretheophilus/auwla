/** Native style-block dispatch for the pinned CSS Tree parser. */
import {
  fork, ident, tokenTypes as T,
  type Atrule, type Block, type CssLocation, type CssNode, type Declaration, type List, type Rule,
} from 'css-tree';
import { viewportWidth } from './conditions/values';

export interface ViewportGroup {
  readonly start: number;
  readonly thresholdEnd: number;
  readonly headerEnd: number;
  readonly minWidth: string | undefined;
  readonly problem: string | undefined;
}

// Metadata lives as long as its AST, without adding a competing CSS node schema.
const viewportGroups = new WeakMap<CssNode, ViewportGroup>();
const unclosedBlocks = new WeakSet<Block>();

export function viewportGroup(node: CssNode): ViewportGroup | undefined {
  return viewportGroups.get(node);
}

export function isUnclosedBlock(node: Block): boolean {
  return unclosedBlocks.has(node);
}

// CSS Tree exposes a supported syntax-fork API, but its grammar parser context
// is not typed by @types/css-tree. Keep this narrow contract beside the adapter.
// Selectors, declarations, at-rules, tokens and recovery remain library-owned.
interface BlockParser {
  readonly tokenType: number;
  readonly tokenStart: number;
  readonly tokenIndex: number;
  readonly eof: boolean;
  lookupType(offset: number): number;
  getTokenEnd(index: number): number;
  substring(start: number, end: number): string;
  next(): void;
  eat(type: number): void;
  createList(): List<CssNode>;
  getLocation(start: number, end: number): CssLocation | null;
  Rule(): Rule | Atrule;
  Block(style: boolean): Block;
  skipSC(): void;
  Declaration(): Declaration;
  Atrule(nested: boolean): Atrule;
  Raw(stop: ((this: BlockParser) => void) | null, trim: boolean): CssNode;
  consumeUntilSemicolonIncluded(): void;
  parseWithFallback(read: (this: BlockParser) => CssNode, fallback: (this: BlockParser) => CssNode): CssNode;
}

/** A top-level `{` before `;`/`}` identifies a nested rule, except custom properties. */
function nestedRule(parser: BlockParser): boolean {
  if (parser.tokenType === T.Ident) {
    const name = parser.substring(parser.tokenStart, parser.getTokenEnd(parser.tokenIndex));
    let next = 1;
    while (parser.lookupType(next) === T.WhiteSpace || parser.lookupType(next) === T.Comment) {
      next++;
    }
    if (parser.lookupType(next) === T.Colon && ident.decode(name).startsWith('--')) {
      return false;
    }
  }

  const closes: number[] = [];
  for (let offset = 0; ; offset++) {
    const type = parser.lookupType(offset);
    if (type === T.EOF) {
      return false;
    }
    if (closes.length === 0) {
      if (type === T.LeftCurlyBracket) {
        return true;
      }
      if (type === T.Semicolon || type === T.RightCurlyBracket) {
        return false;
      }
    }
    if (type === T.Function || type === T.LeftParenthesis) {
      closes.push(T.RightParenthesis);
    } else if (type === T.LeftSquareBracket) {
      closes.push(T.RightSquareBracket);
    } else if (type === closes.at(-1)) {
      closes.pop();
    }
  }
}

function raw(this: BlockParser): CssNode {
  return this.Raw(null, true);
}

function rawDeclaration(this: BlockParser): CssNode {
  return this.Raw(this.consumeUntilSemicolonIncluded, true);
}

function block(this: BlockParser, style = false): Block {
  const start = this.tokenStart;
  const children = this.createList();
  this.eat(T.LeftCurlyBracket);

  while (!this.eof && this.tokenType !== T.RightCurlyBracket) {
    if (this.tokenType === T.WhiteSpace || this.tokenType === T.Comment || this.tokenType === T.Semicolon) {
      this.next();
      continue;
    }
    if (this.tokenType === T.AtKeyword) {
      children.push(this.parseWithFallback(this.Atrule.bind(this, style), raw));
    } else if (!style || nestedRule(this)) {
      children.push(this.parseWithFallback(this.Rule, raw));
    } else {
      children.push(this.parseWithFallback(this.Declaration, rawDeclaration));
      if (this.tokenType === T.Semicolon) {
        this.next();
      }
    }
  }
  const closed = !this.eof;
  if (closed) {
    this.eat(T.RightCurlyBracket);
  }
  const result: Block = { type: 'Block', loc: this.getLocation(start, this.tokenStart) ?? undefined, children };
  if (!closed) {
    unclosedBlocks.add(result);
  }
  return result;
}

/** Called only at a rule boundary; declarations and literal token blocks stay native. */
function numericGroup(parser: BlockParser): Atrule | undefined {
  if (parser.substring(parser.tokenStart, parser.getTokenEnd(parser.tokenIndex)) !== '@') {
    return undefined;
  }
  const type = parser.lookupType(1);
  if (type !== T.Number && type !== T.Dimension && type !== T.Percentage) {
    return undefined;
  }
  const start = parser.tokenStart;
  const atEnd = parser.getTokenEnd(parser.tokenIndex);
  parser.next();
  if (parser.tokenStart !== atEnd) {
    throw new Error('Numeric group dispatch crossed a token boundary');
  }
  const thresholdEnd = parser.getTokenEnd(parser.tokenIndex);
  const minWidth = viewportWidth(parser.substring(parser.tokenStart, thresholdEnd));
  parser.next();
  parser.skipSC();

  let problem: string | undefined;
  if (minWidth === undefined) {
    problem = 'A viewport threshold must be a finite nonnegative number with no unit, px, em or rem';
  }
  if (parser.tokenType !== T.LeftCurlyBracket) {
    problem ??= 'Expected { after the viewport group threshold';
    while (!parser.eof && parser.tokenType !== T.LeftCurlyBracket
      && parser.tokenType !== T.RightCurlyBracket && parser.tokenType !== T.Semicolon) {
      parser.next();
    }
  }
  const headerEnd = parser.tokenStart;
  const body = parser.tokenType === T.LeftCurlyBracket ? parser.Block(true) : null;
  const node: Atrule = {
    type: 'Atrule', name: 'media', block: body,
    prelude: { type: 'Raw', value: `(min-width:${minWidth ?? '0px'})` },
    loc: parser.getLocation(start, parser.tokenStart) ?? undefined,
  };
  viewportGroups.set(node, { start, thresholdEnd, headerEnd, minWidth, problem });
  return node;
}

/** Shared by uses, conditions and local scope; native rules still use CSS Tree. */
export const { parse: parseStylesheet } = fork((config) => {
  const nativeRule = config.node!.Rule as { parse(this: BlockParser): Rule };
  return {
    ...config,
    node: {
      ...config.node,
      Block: { ...config.node!.Block as object, parse: block },
      Rule: {
        ...nativeRule,
        parse(this: BlockParser) {
          return numericGroup(this) ?? nativeRule.parse.call(this);
        },
      },
    },
  };
});
