/**
 * Routes (`wiki/compiler/routes.md`): `route="…"` regions, `route-to` links and the route table,
 * lowered to ordinary JSX and module code before the program is analyzed.
 *
 * Joining routes needs the whole program (which component a tag names, across modules), so this
 * runs on a first analysis. The lowered text is then analyzed again, as if it had been written;
 * a program without routes is analyzed once.
 */
import type { ParsedModule } from '../../core/parse';
import type { Resolved } from '../../core/resolve';
import { programComponents } from '../../core/graph/classify';
import { collectRoutes, mayHaveRoutes } from './collect';
import { buildRouteGraph } from './graph';
import { lowerRouteModules } from './lower';

/** The modules with their routes lowered, or null when the program has none. */
export function lowerRoutes(parsed: readonly ParsedModule[], resolved: Resolved): ParsedModule[] | null {
  if (!resolved.modules.some((entry) => entry.hasJsx && mayHaveRoutes(entry.module.source))) return null;

  const components = programComponents(resolved);
  const collected = resolved.modules.filter((entry) => entry.hasJsx).map((entry) => collectRoutes(entry, components));
  if (collected.every((entry) => entry.templates.length === 0 && entry.links.length === 0)) return null;

  const graph = buildRouteGraph(collected);
  const links = collected.flatMap((entry) => entry.links);
  const lowered = lowerRouteModules(graph, links, resolved.modules.map((entry) => entry.module));

  return parsed.map((input) => {
    const module = resolved.modules.find((entry) => entry.path === input.path)?.module;
    const text = module === undefined ? undefined : lowered.get(module);
    // The analyzed text already settles `import x = require()`, and keeps the ambient imports
    // appended to it (`core/resolve/`), so analyzing it again adds neither twice.
    return text === undefined ? input : { ...input, source: text, requireImports: [] };
  });
}
