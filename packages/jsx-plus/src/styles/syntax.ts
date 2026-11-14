/** Native style-block dispatch for the pinned CSS Tree parser. */
import {
  fork, ident, tokenTypes as T,
  type Atrule, type Block, type CssLocation, type CssNode, type Declaration, type List, type Rule,
} from 'css-tree';

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
  Rule(): Rule;
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
  if (!this.eof) {
    this.eat(T.RightCurlyBracket);
  }
  return { type: 'Block', loc: this.getLocation(start, this.tokenStart) ?? undefined, children };
}

/** Shared by uses, class conditions and local scope: no competing CSS parsers. */
export const { parse: parseStylesheet } = fork({ node: { Block: { parse: block } } });
