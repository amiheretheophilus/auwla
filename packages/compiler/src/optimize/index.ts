/** Optional plan replacements between the general planner and DOM emission. */
import type { SemanticGraph } from '../core/graph';
import type { ModulePlan } from '../core/plan';
import { calledFunctions } from './called-functions';
import { closedLists } from './closed-lists';
import { handlerReads } from './handler-reads';
import { helperCalls } from './helpers';
import { keyedComparisons } from './keyed-comparisons';
import { methodCalls } from './methods';
import { primitiveValues } from './primitive-values';
import { retainedListIndex } from './retained-list-index';
import { routeRegions } from './route-regions';
import { rowLists } from './row-lists';
import { textFusion } from './text-fusion';

export interface Optimization {
  readonly name: string;
  /** Keep the general plan whenever this pass cannot establish its conditions. */
  match(general: ModulePlan, graph: SemanticGraph): ModulePlan | null;
}

// Ordering lives here. A pass receives resolved facts and returns a new plan;
// it must never edit the authored syntax or another pass's input in place.
// Row lists need the method lowering's row-reuse proof.
const passes: readonly Optimization[] = [
  calledFunctions, handlerReads, primitiveValues, retainedListIndex, methodCalls, helperCalls, rowLists, keyedComparisons,
  closedLists, routeRegions, textFusion,
];

/** `enabled`: all passes, none, or all but the named ones (`CompileModulesOptions.optimize`). */
export function optimizeModules(
  plans: readonly ModulePlan[],
  graph: SemanticGraph,
  enabled: boolean | { readonly skip: readonly string[] } = true,
): readonly ModulePlan[] {
  if (enabled === false) {
    return plans;
  }
  const skipped = new Set(enabled === true ? [] : enabled.skip);
  const unknown = [...skipped].filter((name) => !passes.some((pass) => pass.name === name));
  if (unknown.length > 0) {
    throw new Error(`optimize.skip names no pass: ${unknown.join(', ')}`);
  }
  const running = passes.filter((pass) => !skipped.has(pass.name));
  if (running.length === 0) {
    return plans;
  }

  return plans.map((general) => {
    let current = general;
    for (const pass of running) {
      current = pass.match(current, graph) ?? current;
    }
    return current;
  });
}
