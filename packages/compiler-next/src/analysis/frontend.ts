/** Shared frontend order for production compilation and read-only inspection. */
import { parseModule } from '../core/parse';
import { resolve } from '../core/resolve';
import { classifyGraph } from '../core/graph/classify';
import type { CompileModulesOptions } from '../options';

export function analyzeFrontend(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
) {
  const parsed = Object.entries(modules).map(([path, source]) => parseModule(path, source));
  const resolved = resolve(parsed, options);
  const graph = classifyGraph(resolved);

  return { resolved, graph };
}
