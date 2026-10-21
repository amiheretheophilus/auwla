/** Initial storage classification. A nested write never disables the initializer here. */
import { is } from 'yuku-ast';
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
  return facts;
}
