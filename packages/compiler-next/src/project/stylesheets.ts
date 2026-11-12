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

/** Project paths of the stylesheets `entries` import, directly or through modules, in order. */
export function stylesheetsOf(entries: readonly string[], modules: ReadonlyMap<string, CollectedModule>): string[] {
  const stylesheets: string[] = [];
  const seen = new Set<string>();

  const visit = (path: string): void => {
    if (seen.has(path)) return;
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
