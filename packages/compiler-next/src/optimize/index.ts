/** Optional plan replacements between the general planner and DOM emission. */
import type { SemanticGraph } from '../core/graph';
import type { ModulePlan } from '../core/plan';
import { retainedListIndex } from './retained-list-index';

export interface Optimization {
  readonly name: string;
  /** Keep the general plan whenever this pass cannot establish its conditions. */
  match(general: ModulePlan, graph: SemanticGraph): ModulePlan | null;
}

// Ordering lives here. A pass receives resolved facts and returns a new plan;
// it must never edit the authored syntax or another pass's input in place.
const passes: readonly Optimization[] = [retainedListIndex];

export function optimizeModules(
  plans: readonly ModulePlan[],
  graph: SemanticGraph,
  enabled = true,
): readonly ModulePlan[] {
  if (!enabled || passes.length === 0) {
    return plans;
  }

  return plans.map((general) => {
    let current = general;
    for (const pass of passes) {
      current = pass.match(current, graph) ?? current;
    }
    return current;
  });
}
