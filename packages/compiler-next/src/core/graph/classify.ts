/** Feature order lives here; each feature consumes only shared core contracts. */
import { classifyState } from '../../features/state/classify';
import { classifyDerived } from '../../features/derived/classify';
import { collectComputations } from '../../features/derived/computations';
import { propBindings } from '../../features/props/classify';
import type { Resolved } from '../resolve';
import { summarizeFunctions } from '../resolve/functions';
import { propertyReads } from '../resolve/members';
import { buildGraph } from '.';
import { InputQueries } from './inputs';
import type { SemanticGraph } from './model';

export function classifyGraph(resolved: Resolved): SemanticGraph {
  const properties = propertyReads(resolved);
  const summaries = summarizeFunctions(resolved, properties);
  const queries = new InputQueries(summaries, properties);
  const computations = collectComputations(resolved, queries);
  const props = propBindings(resolved);
  // Ref/source classifiers join ahead of state/derived in their feature slices.
  const state = classifyState(resolved, computations, props);
  const facts = classifyDerived(state, resolved.globals);
  return { ...buildGraph(resolved, facts), functions: [...summaries.values()] };
}
