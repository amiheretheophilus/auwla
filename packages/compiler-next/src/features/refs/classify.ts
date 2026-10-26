/** Implicit ref assignments participate in the same graph as authored writes. */
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { Binding, Resolved } from '../../core/resolve';
import { importedDefinition } from '../../core/resolve';
import type { BindingFacts } from '../../core/graph';
import { unwrap } from '../../core/plan/jsx';

export interface RefTarget {
  readonly expression: Extract<Node, { type: 'Identifier' | 'MemberExpression' }>;
  readonly binding: Binding;
}

/** Array entries may independently be assignment targets or authored callbacks. */
export function refTargets(resolved: Resolved): RefTarget[] {
  const targets: RefTarget[] = [];
  for (const { module } of resolved.modules) {
    const visit = (value: Node): void => {
      value = unwrap(value as Expression);
      if (is.ArrayExpression(value)) {
        for (const entry of value.elements) {
          if (entry !== null && !is.SpreadElement(entry)) visit(entry);
        }
        return;
      }
      if (!is.Identifier(value) && !is.MemberExpression(value)) return;
      const expression = value;
      while (is.MemberExpression(value)) value = value.object;
      if (!is.Identifier(value)) return;
      const binding = module.referenceOf(value)?.binding;
      if (binding !== null && binding !== undefined) targets.push({ expression, binding });
    };
    for (const attribute of module.findAll('JSXAttribute')) {
      if (!is.JSXIdentifier(attribute.name) || attribute.name.name !== 'ref') continue;
      if (is.JSXExpressionContainer(attribute.value) && !is.JSXEmptyExpression(attribute.value.expression)) {
        visit(attribute.value.expression);
      }
    }
  }
  return targets;
}

export function classifyRefs(initial: ReadonlyMap<Binding, BindingFacts>, targets: readonly RefTarget[]) {
  const facts = new Map(initial);
  for (const { expression, binding } of targets) {
    const fact = facts.get(binding);
    if (fact === undefined || fact.kind === 'Prop') continue;
    facts.set(binding, { ...fact, kind: is.Identifier(expression) ? 'Ref' : 'State' });
    if (is.MemberExpression(expression)) {
      const definition = importedDefinition(binding);
      const source = definition === null ? undefined : facts.get(definition);
      if (definition !== null && source !== undefined) {
        facts.set(definition, { ...source, kind: 'State' });
      }
    }
  }
  return facts;
}
