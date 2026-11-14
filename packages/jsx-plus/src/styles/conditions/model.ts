import { ident, walk, type CssNode, type Declaration } from 'css-tree';
import { parseStylesheet } from '../syntax';
import { conditionClauses, hasValue, type ConditionClause } from './values';

export interface ConditionProblem {
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface ConditionalDeclaration {
  readonly declaration: Declaration;
  readonly base: string;
  readonly clauses: readonly ConditionClause[];
  readonly valueStart: number;
}

/** A shared syntax model for production lowering and the equal-width editor view. */
export function readConditions(source: string) {
  const problems: ConditionProblem[] = [];
  const report = (message: string, start: number, end: number) => problems.push({ message, start, end });
  const markers = source.includes('@') ? conditionClauses(source, () => {}, false) : [];
  const declarations = new Map<Declaration, ConditionalDeclaration>();
  const affected = new Set<CssNode>();
  const headers: { start: number; end: number }[] = [];
  if (markers.length === 0) {
    return { tree: undefined, declarations, affected, headers, problems };
  }

  const tree = parseStylesheet(source, { positions: true, parseValue: false, parseCustomProperty: false });
  const parents: CssNode[] = [];
  const accounted = new Set<number>();
  walk(tree, {
    enter(node: CssNode) {
      if (node.type === 'Declaration' && node.value.loc !== null && node.value.loc !== undefined) {
        const valueStart = node.value.loc.start.offset;
        const valueEnd = node.value.loc.end.offset;
        const value = source.slice(valueStart, valueEnd);
        const localReport = (message: string, start: number, end: number) => report(message, valueStart + start, valueStart + end);
        const clauses = conditionClauses(value, localReport);

        // Anything nested in a function, string, URL or custom-property token
        // block stays literal native CSS, even if it contains an @. spelling.
        for (const marker of markers) {
          if (valueStart <= marker.start && marker.start < valueEnd) {
            accounted.add(marker.start);
          }
        }
        if (clauses.length > 0) {
          if (typeof node.important === 'string' && ident.decode(node.important).toLowerCase() !== 'important') {
            report('Only a final !important is supported on a conditional declaration', valueEnd, node.loc!.end.offset);
          }
          for (const clause of clauses) {
            headers.push({ start: valueStart + clause.start, end: valueStart + clause.headerEnd });
            if (clause.complete && !hasValue(value.slice(clause.valueStart, clause.valueEnd))) {
              const label = clause.kind === 'class' ? 'class' : 'viewport';
              localReport(`A ${label} condition requires a CSS value`, clause.start, clause.headerEnd);
            }
          }
          const base = value.slice(0, clauses[0]!.start);
          if (!hasValue(base)) {
            localReport('A conditional declaration requires a base CSS value', 0, clauses[0]!.headerEnd);
          }
          // The direct parent is a Block; its owner must be a selector rule.
          const owner = parents.at(-2);
          const keyframes = parents.some((parent) => parent.type === 'Atrule'
            && /^(?:-\w+-)?keyframes$/i.test(ident.decode(parent.name)));
          if (owner?.type !== 'Rule' || keyframes || owner.prelude.type !== 'SelectorList') {
            localReport('CSS conditions require a qualified style rule, outside keyframes and descriptors', clauses[0]!.start, clauses[0]!.headerEnd);
          }
          declarations.set(node, { declaration: node, base: base.trim(), clauses, valueStart });
          for (const parent of parents) {
            affected.add(parent);
          }
        }
      }
      parents.push(node);
    },
    leave() {
      parents.pop();
    },
  });

  for (const marker of markers) {
    if (!accounted.has(marker.start)) {
      report('A CSS condition requires a complete native property declaration in a style rule', marker.start, marker.headerEnd);
      headers.push({ start: marker.start, end: marker.headerEnd });
    }
  }
  return { tree, declarations, affected, headers, problems };
}
