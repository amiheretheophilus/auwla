import {
  clone, generate, ident, parse, tokenize, tokenTypes as T, walk,
  type Block, type CssNode, type List, type ListItem, type Rule, type SelectorList,
} from 'css-tree';
import type { Report } from '../conditions/values';
import { parseStylesheet } from '../syntax';

const grouping = new Set(['media', 'supports', 'container', 'layer', 'starting-style', 'scope']);

/** Scope declaration subjects while preserving native nesting and ancestor qualifiers. */
export function scopeSelectors(source: string, attribute: string, report: Report): string {
  // Recovery can give an unterminated parent the same ending offset as its
  // closed child. Token braces, not just AST end characters, prove completeness.
  const braces: number[] = [];
  tokenize(source, (type, start, end) => {
    if (type === T.LeftCurlyBracket) {
      braces.push(start);
    } else if (type === T.RightCurlyBracket) {
      if (braces.length === 0) {
        report('Unexpected } in this local style', start, end);
      }
      braces.pop();
    }
  });
  for (const start of braces) {
    report('A local style requires a closing }', start, start + 1);
  }

  const tree = parseStylesheet(source, { positions: true, parseValue: false, parseCustomProperty: false });
  const selectors = new Map<Rule, string>();
  const withNestedRules = new Set<Rule>();
  const parents: CssNode[] = [];

  walk(tree, {
    enter(node: CssNode) {
      const parent = parents.at(-1);
      parents.push(node);
      if (node.type === 'Raw' && (parent?.type === 'StyleSheet' || parent?.type === 'Block')) {
        report('A local style requires a complete native rule', node.loc!.start.offset, node.loc!.end.offset);
      }
      if (node.type === 'Atrule' && !grouping.has(ident.decode(node.name).toLowerCase())) {
        report(`@${node.name} requires an explicit <style global> consumer in this CSS profile`,
          node.loc!.start.offset, node.loc!.start.offset + node.name.length + 1);
      }
      if (node.type !== 'Rule') {
        return;
      }
      for (const ancestor of parents.slice(0, -1)) {
        if (ancestor.type === 'Rule') {
          withNestedRules.add(ancestor);
        }
      }
      if (node.prelude.type !== 'SelectorList') {
        report('A local style requires a complete native selector', node.loc!.start.offset, node.block.loc!.start.offset);
        return;
      }

      const prelude = clone(node.prelude) as SelectorList;
      for (const selector of prelude.children) {
        if (selector.type !== 'Selector') {
          continue;
        }

        // A marker on the subject allows external ancestor qualifiers. It goes
        // before a pseudo-element, since no selector may follow ::before/::after.
        let before: ListItem<CssNode> | undefined;
        selector.children.forEach((child, item) => {
          if (child.type === 'Combinator') {
            before = undefined;
          } else if (before === undefined && (child.type === 'PseudoElementSelector'
            || (child.type === 'PseudoClassSelector'
              && /^(?:before|after|first-line|first-letter)$/i.test(ident.decode(child.name))))) {
            before = item;
          }
        });

        const marker = parse(`:where([${attribute}])`, { context: 'selector' });
        if (marker.type === 'Selector') {
          for (const child of marker.children) {
            if (before === undefined) {
              selector.children.appendData(child);
            } else {
              selector.children.insertData(child, before);
            }
          }
        }
      }
      selectors.set(node, generate(prelude));
    },
    leave() {
      parents.pop();
    },
  });

  function original(node: CssNode): string {
    return source.slice(node.loc!.start.offset, node.loc!.end.offset);
  }

  /**
   * A nested rule must inherit the original ancestor selector. Scoping the
   * ancestor itself would turn `body.dark { .title {...} }` into a selector that
   * requires our marker on body. Instead scope the ancestor's own declarations
   * inside `&:where(...)`, leaving its nested selector context unchanged.
   */
  function inherited(block: Block): string {
    let result = '';
    let pending = '';
    let hasDeclaration = false;
    let position = block.loc!.start.offset + 1;

    function flush(): void {
      result += hasDeclaration ? `&:where([${attribute}]){${pending}}` : pending;
      pending = '';
      hasDeclaration = false;
    }

    for (const child of block.children) {
      pending += source.slice(position, child.loc!.start.offset);
      if (child.type === 'Rule') {
        flush();
        result += render(child);
      } else if (child.type === 'Atrule' && child.block !== null) {
        flush();
        result += source.slice(child.loc!.start.offset, child.block.loc!.start.offset) + inherited(child.block);
      } else {
        pending += original(child);
        hasDeclaration ||= child.type === 'Declaration';
      }
      position = child.loc!.end.offset;
    }
    pending += source.slice(position, block.loc!.end.offset - 1);
    flush();
    return '{' + result + '}';
  }

  function container(children: List<CssNode>, start: number, end: number): string {
    let result = '';
    let position = start;
    for (const child of children) {
      result += source.slice(position, child.loc!.start.offset) + render(child);
      position = child.loc!.end.offset;
    }
    return result + source.slice(position, end);
  }

  function render(node: CssNode): string {
    if (node.type === 'Rule') {
      if (withNestedRules.has(node)) {
        return source.slice(node.loc!.start.offset, node.block.loc!.start.offset) + inherited(node.block);
      }
      return source.slice(node.loc!.start.offset, node.prelude.loc!.start.offset)
        + selectors.get(node) + source.slice(node.prelude.loc!.end.offset, node.loc!.end.offset);
    }
    if (node.type === 'Atrule' && node.block !== null) {
      return source.slice(node.loc!.start.offset, node.block.loc!.start.offset)
        + '{' + container(node.block.children, node.block.loc!.start.offset + 1, node.block.loc!.end.offset - 1) + '}';
    }
    return original(node);
  }

  return tree.type === 'StyleSheet' ? container(tree.children, 0, source.length) : source;
}
