/** Feature order lives here; each feature consumes only shared core contracts. */
import { classifyState } from '../../features/state/classify';
import { classifyDerived } from '../../features/derived/classify';
import { classifyRefs, refTargets } from '../../features/refs/classify';
import { collectComputations } from '../../features/derived/computations';
import { componentFunctions, propBindings } from '../../features/props/classify';
import type { Resolved } from '../resolve';
import { summarizeFunctions } from '../resolve/functions';
import { propertyReads } from '../resolve/members';
import { buildGraph } from '.';
import { escapingFacts } from './escaping';
import { InputQueries } from './inputs';
import type { SemanticGraph } from './model';
import type { FunctionNode } from '../resolve/functions';

/** Planning reuses the same dependency caches and component identities. */
export interface ClassifiedGraph extends SemanticGraph {
  readonly queries: InputQueries;
  readonly components: ReadonlySet<FunctionNode>;
}

export function classifyGraph(resolved: Resolved): ClassifiedGraph {
  const properties = propertyReads(resolved);
  const summaries = summarizeFunctions(resolved, properties);
  const queries = new InputQueries(summaries, properties);
  const computations = collectComputations(resolved, queries);
  const components = componentFunctions(resolved);
  const props = propBindings(resolved, components);
  // Implicit ref writes supply reactive roots before derivation propagates.
  const state = classifyState(resolved, computations, props);
  const facts = classifyDerived(classifyRefs(state, refTargets(resolved)), resolved.globals);
  const escaping = escapingFacts(resolved, queries, components);
  return {
    ...buildGraph(resolved, facts, escaping),
    functions: [...summaries.values()],
    queries,
    components,
  };
}
