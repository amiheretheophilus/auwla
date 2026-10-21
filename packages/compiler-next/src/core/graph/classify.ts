/** Feature order lives here; each feature consumes only shared core contracts. */
import { classifyState } from '../../features/state/classify';
import { classifyDerived } from '../../features/derived/classify';
import { collectComputations } from '../../features/derived/computations';
import { componentFunctions, propBindings } from '../../features/props/classify';
import type { Resolved } from '../resolve';
import { summarizeFunctions } from '../resolve/functions';
import { propertyReads } from '../resolve/members';
import { buildGraph } from '.';
import { escapingFacts } from './escaping';
import { InputQueries } from './inputs';
import type { SemanticGraph } from './model';

export function classifyGraph(resolved: Resolved): SemanticGraph {
  const properties = propertyReads(resolved);
  const summaries = summarizeFunctions(resolved, properties);
  const queries = new InputQueries(summaries, properties);
  const computations = collectComputations(resolved, queries);
  const components = componentFunctions(resolved);
  const props = propBindings(resolved, components);
  // Ref/source classifiers join ahead of state/derived in their feature slices.
  const state = classifyState(resolved, computations, props);
  const facts = classifyDerived(state, resolved.globals);
  const escaping = escapingFacts(resolved, queries, components);
  return { ...buildGraph(resolved, facts, escaping), functions: [...summaries.values()] };
}
