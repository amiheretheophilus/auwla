/** Propagate reactive inputs without letting potential later writes replace initial derivation. */
import type { Binding, GlobalWrites } from '../../core/resolve';
import { importedDefinition, isWrittenGlobal } from '../../core/resolve';
import type { BindingFacts, ReadFact } from '../../core/graph';

export function classifyDerived(
  initial: ReadonlyMap<Binding, BindingFacts>,
  globals: GlobalWrites,
): ReadonlyMap<Binding, BindingFacts> {
  const facts = new Map(initial);
  const dependents = new Map<Binding, Set<Binding>>();
  const reactive = new Set<Binding>();
  const work: Binding[] = [];

  function mark(binding: Binding) {
    if (reactive.has(binding)) return;
    reactive.add(binding);
    work.push(binding);
  }

  function connect(target: Binding, dependency: Binding) {
    if (target === dependency) return;
    const readers = dependents.get(dependency) ?? new Set<Binding>();
    readers.add(target);
    dependents.set(dependency, readers);
  }

  /** A read of a global the program writes; other globals are not inputs (`globals.ts`). */
  function readsWrittenGlobal(read: ReadFact): boolean {
    if (read.binding !== undefined || read.reference.binding !== null) return false;
    return isWrittenGlobal(globals, read.reference.name);
  }

  for (const [binding, fact] of facts) {
    if (fact.kind !== 'Constant') mark(binding);
    for (const read of fact.reads ?? []) {
      const dependency = read.binding ?? read.reference.binding;
      if (dependency !== null) connect(binding, dependency);
    }
    const definition = importedDefinition(binding);
    if (definition !== null) connect(binding, definition);
  }

  // An unresolved read has no named dependency to put in the worklist; a
  // written global is a reactive input of its own.
  for (const [binding, fact] of facts) {
    if (!fact.reads?.some(readsWrittenGlobal)) continue;
    mark(binding);
    if (fact.kind !== 'Prop' && fact.initial !== undefined) {
      facts.set(binding, { ...fact, kind: 'Derived' });
    }
  }

  // A worklist settles chains and cycles without repeatedly rebuilding the graph.
  for (let index = 0; index < work.length; index++) {
    const dependency = work[index]!;
    for (const binding of dependents.get(dependency) ?? []) {
      const fact = facts.get(binding)!;
      if (fact.kind !== 'Prop' && fact.initial !== undefined) {
        facts.set(binding, { ...fact, kind: 'Derived' });
      }
      mark(binding);
    }
  }

  // An import is the binding it names, so it takes that binding's settled kind.
  for (const [binding, fact] of facts) {
    const definition = importedDefinition(binding);
    const target = definition === null ? undefined : facts.get(definition);
    if (target !== undefined) facts.set(binding, { ...fact, kind: target.kind });
  }
  return facts;
}
