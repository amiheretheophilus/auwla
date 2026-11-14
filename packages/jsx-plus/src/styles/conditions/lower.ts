import { clone, generate, ident, parse, type CssNode, type ListItem, type Rule, type SelectorList } from 'css-tree';
import { readConditions, type ConditionalDeclaration } from './model';
import type { Report } from './values';
import { isUnclosedBlock } from '../syntax';

/** Add the class to the selected element, before a pseudo-element, never to an ancestor. */
function classSelector(prelude: SelectorList, name: string): string {
  const selectors = clone(prelude) as SelectorList;
  for (const selector of selectors.children) {
    if (selector.type !== 'Selector') {
      continue;
    }
    let before: ListItem<CssNode> | undefined;
    selector.children.forEach((node, item) => {
      if (node.type === 'Combinator') {
        before = undefined;
      } else if (before === undefined && (node.type === 'PseudoElementSelector'
        || (node.type === 'PseudoClassSelector' && /^(?:before|after|first-line|first-letter)$/i.test(ident.decode(node.name))))) {
        before = item;
      }
    });
    const className: CssNode = { type: 'ClassSelector', name };
    if (before === undefined) {
      selector.children.appendData(className);
    } else {
      selector.children.insertData(className, before);
    }
  }
  return generate(selectors);
}

export function lowerConditions(source: string, report: Report): string {
  const model = readConditions(source);
  for (const problem of model.problems) {
    report(problem.message, problem.start, problem.end);
  }
  if (model.tree === undefined || (model.declarations.size === 0 && model.groups.size === 0) || model.problems.length > 0) {
    return source;
  }
  for (const node of model.affected) {
    if (node.type === 'Block' && (isUnclosedBlock(node) || source[node.loc!.end.offset - 1] !== '}')) {
      report('A style block containing CSS conditions requires a closing }', node.loc!.start.offset, node.loc!.start.offset + 1);
      return source;
    }
  }

  const inherited = parse('&', { context: 'selectorList' }) as SelectorList;
  const preserveNestingOrder = model.groups.size > 0;

  function conditional(rule: Rule | undefined, entry: ConditionalDeclaration): string {
    const value = source.slice(entry.declaration.value.loc!.start.offset, entry.declaration.value.loc!.end.offset);
    const important = entry.declaration.important ? ' !important' : '';
    const prelude = rule === undefined ? inherited : rule.prelude as SelectorList;
    const authoredSelector = rule === undefined ? '&'
      : source.slice(rule.prelude.loc!.start.offset, rule.prelude.loc!.end.offset);
    return entry.clauses.map((clause) => {
      const selector = clause.kind === 'class' ? classSelector(prelude, clause.name) : authoredSelector;
      const declaration = `${entry.declaration.property}:${value.slice(clause.valueStart, clause.valueEnd).trim()}${important};`;
      const qualified = `${selector}{${declaration}}`;
      if (clause.kind === 'viewport') {
        return `@media (min-width:${clause.minWidth}){${qualified}}`;
      }
      return qualified;
    }).join('\n');
  }

  function renderRule(rule: Rule): string {
    const start = rule.loc!.start.offset;
    const bodyStart = rule.block.loc!.start.offset + 1;
    const bodyEnd = rule.block.loc!.end.offset - 1;
    const opening = source.slice(start, bodyStart);
    const output: string[] = [];
    let body = '';
    let position = bodyStart;
    let afterNested = false;

    for (const node of rule.block.children) {
      const nodeStart = node.loc!.start.offset;
      let nodeEnd = node.loc!.end.offset;
      body += source.slice(position, nodeStart);
      const entry = node.type === 'Declaration' ? model.declarations.get(node) : undefined;
      if (entry === undefined) {
        const text = render(node);
        // Older CSS bundlers collect bare declarations before nested rules.
        // An explicit & rule preserves a declaration authored after a group.
        body += afterNested && node.type === 'Declaration' ? `&{${text}}` : text;
        if (preserveNestingOrder && (node.type === 'Rule' || node.type === 'Atrule')) {
          afterNested = true;
        }
      } else {
        const important = entry.declaration.important ? ' !important' : '';
        const base = `${entry.declaration.property}:${entry.base}${important};`;
        body += afterNested ? `&{${base}}` : base;
        output.push(opening + body + '}', conditional(rule, entry));
        body = '';
        afterNested = false;
        if (source[nodeEnd] === ';') {
          nodeEnd++;
        }
      }
      position = nodeEnd;
    }
    body += source.slice(position, bodyEnd);
    if (body.trim() !== '' || output.length === 0) {
      output.push(opening + body + '}');
    }
    return output.join('\n');
  }

  function render(node: CssNode): string {
    if (!model.affected.has(node)) {
      return source.slice(node.loc!.start.offset, node.loc!.end.offset);
    }
    if (node.type === 'Rule') {
      return renderRule(node);
    }
    if (node.type === 'Declaration') {
      const entry = model.declarations.get(node)!;
      const important = entry.declaration.important ? ' !important' : '';
      return `${entry.declaration.property}:${entry.base}${important};\n${conditional(undefined, entry)}`;
    }
    if (node.type === 'StyleSheet' || node.type === 'Block') {
      const start = node.loc!.start.offset + (node.type === 'Block' ? 1 : 0);
      const end = node.loc!.end.offset - (node.type === 'Block' ? 1 : 0);
      let result = '';
      let position = start;
      let afterNested = false;
      for (const child of node.children) {
        const text = render(child);
        const wrapped = node.type === 'Block' && afterNested && child.type === 'Declaration';
        result += source.slice(position, child.loc!.start.offset) + (wrapped ? `&{${text}}` : text);
        position = child.loc!.end.offset;
        if (child.type === 'Declaration' && model.declarations.has(child) && source[position] === ';') {
          position++;
        }
        if (preserveNestingOrder && (child.type === 'Rule' || child.type === 'Atrule'
          || (child.type === 'Declaration' && model.declarations.has(child)))) {
          afterNested = true;
        }
      }
      result += source.slice(position, end);
      return node.type === 'Block' ? '{' + result + '}' : result;
    }
    if (node.type === 'Atrule' && node.block !== null) {
      const group = model.groups.get(node);
      if (group !== undefined) {
        const trivia = source.slice(group.thresholdEnd, group.headerEnd);
        return `@media (min-width:${group.minWidth})${trivia}${render(node.block)}`;
      }
      return source.slice(node.loc!.start.offset, node.block.loc!.start.offset) + render(node.block);
    }
    return source.slice(node.loc!.start.offset, node.loc!.end.offset);
  }

  return render(model.tree);
}
