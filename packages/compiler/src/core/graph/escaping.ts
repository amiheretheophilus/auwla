/**
 * What each escaping function reads (`../resolve/escapes.ts`;
 * `wiki/compiler/output.md`, "Phase 3 design", rule 5).
 *
 * The reads are those its parameters' defaults and its body evaluate, plus those
 * of the helpers it calls directly. Its own parameters and locals are left out:
 * they are new on every call. `buildGraph` keeps only the reactive ones.
 */
import type { Node } from 'yuku-parser';
import type { Module, Resolved } from '../resolve';
import { findEscapingFunctions } from '../resolve/escapes';
import type { FunctionNode } from '../resolve/functions';
import type { InputQueries } from './inputs';
import type { FunctionFacts, ReadFact } from './model';

export function escapingFacts(
  resolved: Resolved,
  queries: InputQueries,
  /** Components update through their own entity; they report nothing. */
  components: ReadonlySet<Node>,
): FunctionFacts[] {
  const facts: FunctionFacts[] = [];
  for (const entry of resolved.modules) {
    for (const fn of findEscapingFunctions(entry.module)) {
      if (components.has(fn)) continue;
      facts.push({
        fn,
        module: entry,
        reads: capturedReads(entry.module, fn, queries),
        receiver: queries.summaryOf(fn)?.usesReceiver ?? false,
      });
    }
  }
  return facts;
}

function capturedReads(module: Module, fn: FunctionNode, queries: InputQueries): ReadFact[] {
  const roots: Node[] = [...fn.params];
  if (fn.body !== null) roots.push(fn.body);

  const reads: ReadFact[] = [];
  const seen = new Set<ReadFact['reference']>();
  for (const root of roots) {
    for (const read of queries.inputsOf(module, root).reads) {
      if (seen.has(read.reference)) continue;
      seen.add(read.reference);
      const binding = read.binding ?? read.reference.binding;
      const declaredInside = binding !== null && binding.module === module
        && binding.declarations.every((name) => name.start >= fn.start && name.end <= fn.end);
      if (!declaredInside) reads.push(read);
    }
  }
  return reads;
}
