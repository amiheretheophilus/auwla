/** Shared frontend order for production compilation and read-only inspection. */
import { parseModule } from '../core/parse';
import { resolve } from '../core/resolve';
import { classifyGraph } from '../core/graph/classify';
import { lowerRoutes, type PrintedRouteSplit } from '../features/routes';
import type { CompileModulesOptions } from '../options';

const NO_SPLITS: ReadonlyMap<string, readonly PrintedRouteSplit[]> = new Map();

export function analyzeFrontend(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
) {
  let parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  let resolved = resolve(parsed, options);

  // Routes join across modules, so they lower on a first analysis (`features/routes/`).
  const routed = lowerRoutes(parsed, resolved, options);
  if (routed !== null) {
    parsed = routed.parsed;
    resolved = resolve(parsed, options);
  }

  const graph = classifyGraph(resolved);

  // The imports that load with their routes, which printing removes (`features/routes/split.ts`).
  const routeSplits = routed?.splits ?? NO_SPLITS;
  return { resolved, graph, routeSplits };
}
