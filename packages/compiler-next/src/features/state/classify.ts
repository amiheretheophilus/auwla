/** Initial storage classification. A nested write never disables the initializer here. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Resolved } from '../../core/resolve';
import { importedDefinition, isParameter, isRuntimeBinding } from '../../core/resolve';
import type { BindingComputation } from '../../core/graph/classification';
import type { BindingFacts, BindingKind } from '../../core/graph';

export function classifyState(
  resolved: Resolved,
  computations: ReadonlyMap<Binding, BindingComputation>,
  props: ReadonlySet<Binding>,
): ReadonlyMap<Binding, BindingFacts> {
  const facts = new Map<Binding, BindingFacts>();
  
  for (const entry of resolved.modules) {
    
    for (const binding of entry.module.bindings) {
      if (!isRuntimeBinding(binding)) continue;
      
      const computation = computations.get(binding)!;
      const initial = computation.initial ?? undefined;
      const reads = computation.reads;
      const takeovers = computation.takeovers;
      
      if (props.has(binding)) {
        facts.set(binding, { kind: 'Prop', initial, reads, takeovers });
        continue;
      }
      if (importedDefinition(binding) !== null) {
        // A placeholder: the derived feature gives an import the settled kind
        // of the binding it names. Package imports have no definition and stay opaque.
        facts.set(binding, { kind: 'Constant', reads, takeovers });
        continue;
      }

      const name = binding.declarations[0];
      const parent = name && binding.module.parentOf(name);
      const functionDeclaration = is.Function(parent) && parent.id === name;
      const canCompute = !isParameter(binding) && (initial !== undefined || functionDeclaration);
      const writes = entry.writes.get(binding) ?? [];
      
      let kind: BindingKind = 'Constant';
      if (!canCompute || computation.opaque) {
        kind = 'Opaque';
      } else if (writes.length > 0) {
        kind = 'State';
      }
      facts.set(binding, { kind, initial, reads, takeovers });
    }
  }
  // A mutation through an alias can change data reached from its initializer.
  // Keep those roots reactive; runtime identity observation determines which
  // roots actually changed, including shallow copies with shared nested data.
  const work = [...facts.keys()].filter((binding) => {
    const entry = resolved.modules.find((entry) => entry.module === binding.module);
    return entry?.writes.get(binding)?.some((site) => site.kind !== 'assign' && site.kind !== 'update');
  });
  
  const visited = new Set<Binding>();
  
  for (let index = 0; index < work.length; index++) {
      const binding = work[index]!;
      
      if (visited.has(binding)) continue;
      
      visited.add(binding);
    
    for (const read of facts.get(binding)?.reads ?? []) {
      
      const dependency = read.binding ?? read.reference.binding;
      if (dependency === null || !mayFlowIntoValue(binding.module, read.reference.node)) continue;
      const fact = facts.get(dependency);
      if (fact?.kind === 'Constant') facts.set(dependency, { ...fact, kind: 'State' });
      if (fact !== undefined) work.push(dependency);
    }
  }
  return facts;
}

/**
 * Whether the value read at `node` can become part of the value its statement
 * computes. Arithmetic, comparison, `typeof`, template text and a conditional's
 * test always produce a new primitive or choose a branch, so they cannot hand
 * an object to the computed value. Everything else is kept, conservatively.
 */
function mayFlowIntoValue(module: Binding['module'], node: Node): boolean {
  let child: Node = node;
  
  for (const parent of module.ancestors(node)) {
    
    if (is.Function(parent) || is.Statement(parent) || is.VariableDeclarator(parent)) return true;
    if (is.BinaryExpression(parent) || is.UnaryExpression(parent) || is.UpdateExpression(parent)) return false;
    if (is.TemplateLiteral(parent)) return false;
    if (is.ConditionalExpression(parent) && parent.test === child) return false;
    child = parent;
    
  }
  return true;
}
