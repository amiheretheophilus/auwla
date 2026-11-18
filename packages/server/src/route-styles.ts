/**
 * A lazy route's styles on a page the server renders (the compiler's
 * `wiki/compiler/routes.md`, "A lazy route's styles").
 *
 * A browser build loads a component that only a route shows with its route, in a chunk of its
 * own, and that chunk brings its stylesheets. On a page the server rendered, the chunk runs only
 * after the page shows, so the route's markup would show unstyled first. The tool knows which
 * stylesheets each chunk loads; the server knows which route components it rendered. Their
 * links go into the document's head before the page is sent.
 */

/** Stylesheet URLs by route component key, as the tool's build found them. */
export type RouteStyles = Readonly<Record<string, readonly string[]>>;

/**
 * `prefix` (the document up to the app's outlet) with a stylesheet link for each style of the
 * given route components that it does not link already. The links close the head; a template
 * with no head in its prefix gets them just before the outlet, where a stylesheet still applies
 * before the app's markup shows.
 */
export function withRouteStyles(prefix: string, components: readonly string[], styles: RouteStyles | undefined): string {
  if (styles === undefined || components.length === 0) {
    return prefix;
  }

  const hrefs: string[] = [];
  for (const component of components) {
    for (const href of styles[component] ?? []) {
      if (!hrefs.includes(href) && !prefix.includes(`href="${escapeAttribute(href)}"`)) hrefs.push(href);
    }
  }
  if (hrefs.length === 0) {
    return prefix;
  }

  const links = hrefs.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`).join('');
  const head = /<\/head\s*>/i.exec(prefix);
  if (head === null) {
    return prefix + links;
  }
  return prefix.slice(0, head.index) + links + prefix.slice(head.index);
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
