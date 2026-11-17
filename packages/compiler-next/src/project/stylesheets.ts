/**
 * The stylesheets a program imports (`import './app.css'`), in the order a browser applies them
 * (`wiki/compiler/project.md`, "Build-time page").
 *
 * A bundler gives the page the CSS its modules import, in the order the modules run: each module
 * after the modules it imports, and its own imports in the order written. A page with no script
 * still needs that CSS, so it gets a `<link>` for each, in the same order (`page.ts`).
 */
import { importCandidates, isStylesheet } from '../core/resolve/imports';
import type { CollectedModule } from './collect';

/** Whether a project path names a stylesheet. */
export function isStylesheetPath(path: string): boolean {
  return isStylesheet(path);
}

/**
 * Project paths of the stylesheets `entries` import, directly or through modules, in order. A
 * module in `skip` is not entered.
 */
export function stylesheetsOf(
  entries: readonly string[],
  modules: ReadonlyMap<string, CollectedModule>,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const stylesheets: string[] = [];
  const seen = new Set<string>();

  const visit = (path: string): void => {
    if (seen.has(path) || skip.has(path)) return;
    seen.add(path);
    const module = modules.get(path);
    if (module === undefined) return;
    for (const [specifier, target] of module.imports) {
      if (target !== false) {
        visit(target);
        continue;
      }
      // A relative import of a stylesheet: the first candidate is the specifier itself.
      const stylesheet = importCandidates(specifier, path)?.[0];
      if (stylesheet !== undefined && isStylesheetPath(stylesheet) && !seen.has(stylesheet)) {
        seen.add(stylesheet);
        stylesheets.push(stylesheet);
      }
    }
  };

  for (const entry of entries) visit(entry);
  return stylesheets;
}

/**
 * The stylesheets each route component that loads with its route brings, by its key
 * (`CompiledProject.routeComponents`): those its module reaches that the rest of the program does
 * not. A browser gets them with the route's chunk; a page the server renders for that route links
 * them in its head, in development as in a build (`@memoized-dom/server`, `route-styles.ts`), so
 * another route's styles never apply to it. Undefined when no route component brings one.
 */
export function routeStylesheetsOf(
  entries: readonly string[],
  modules: ReadonlyMap<string, CollectedModule>,
  routeComponents: Readonly<Record<string, string>> | undefined,
): Record<string, string[]> | undefined {
  if (routeComponents === undefined) return undefined;
  const lazy = new Set(Object.values(routeComponents));
  const eager = new Set(stylesheetsOf(entries, modules, lazy));

  const byComponent: Record<string, string[]> = {};
  for (const [key, module] of Object.entries(routeComponents)) {
    // Another route component this one imports loads with its own route.
    const others = new Set([...lazy].filter((path) => path !== module));
    const own = stylesheetsOf([module], modules, others).filter((stylesheet) => !eager.has(stylesheet));
    if (own.length > 0) byComponent[key] = own;
  }
  return Object.keys(byComponent).length === 0 ? undefined : byComponent;
}
