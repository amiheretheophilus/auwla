/**
 * Routes (`wiki/compiler/routes.md`): `route="…"` regions, `route-to` links and the route table,
 * lowered to ordinary JSX and module code before the program is analyzed.
 *
 * Joining routes needs the whole program (which component a tag names, across modules), so this
 * runs on a first analysis. The lowered text is then analyzed again, as if it had been written;
 * a program without routes is analyzed once.
 */
import type { ParsedModule } from '../../core/parse';
import { composeOrigins } from '../../core/parse/text-edits';
import type { Resolved } from '../../core/resolve';
import type { CompileModulesOptions } from '../../options';
import { programComponents } from '../../core/graph/classify';
import { collectRoutes, mayHaveRoutes } from './collect';
import { buildRouteGraph } from './graph';
import { lowerRouteModules } from './lower';

/** The modules with their routes lowered, or null when the program has none. */
export function lowerRoutes(parsed: readonly ParsedModule[], resolved: Resolved, options: CompileModulesOptions): ParsedModule[] | null {
  if (!resolved.modules.some((entry) => mayHaveRoutes(entry.module.source))) return null;

  const components = programComponents(resolved);
  const collected = resolved.modules.map((entry) => collectRoutes(entry, components));
  if (collected.every((entry) => entry.templates.length === 0 && entry.links.length === 0 && entry.preparations.length === 0)) {
    return null;
  }

  const graph = buildRouteGraph(collected);
  const links = collected.flatMap((entry) => entry.links);
  const lowered = lowerRouteModules(graph, links, resolved.modules.map((entry) => entry.module), options);

  return parsed.map((input) => {
    const entry = resolved.modules.find((candidate) => candidate.path === input.path);
    const text = entry === undefined ? undefined : lowered.get(entry.module);
    if (entry === undefined || text === undefined) return input;
    // The analyzed text already settles `import x = require()`, and keeps the ambient imports
    // appended to it (`core/resolve/`), so analyzing it again adds neither twice. Its origin
    // leads back to the authored text through that analysis.
    return { ...input, source: text.text, origin: composeOrigins(text.origin, entry.origin), requireImports: [] };
  });
}
