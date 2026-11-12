/** Shared frontend order for production compilation and read-only inspection. */
import { parseModule } from '../core/parse';
import { resolve } from '../core/resolve';
import { classifyGraph } from '../core/graph/classify';
import { lowerRoutes } from '../features/routes';
import type { CompileModulesOptions } from '../options';

export function analyzeFrontend(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
) {
  let parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  let resolved = resolve(parsed, options);

  // Routes join across modules, so they lower on a first analysis (`features/routes/`).
  const routed = lowerRoutes(parsed, resolved, options);
  if (routed !== null) {
    parsed = routed;
    resolved = resolve(parsed, options);
  }

  const graph = classifyGraph(resolved);

  return { resolved, graph };
}
