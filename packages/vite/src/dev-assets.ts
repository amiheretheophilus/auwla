/**
 * The stylesheets a page the server renders in development links in its head, so it is styled
 * before any script runs. The compiler says which they are (`CompiledProject.stylesheets` and
 * `routeStylesheets`); here they become the URLs Vite serves them at.
 *
 * The eager ones go in every page's document (`configureDevelopmentDelivery`). Those a route
 * component brings go, by its key, to the server, which links them only on a page that renders
 * that route (`@memoized-dom/server`, `route-styles.ts`), as it does after a build.
 */
import { isAbsolute, relative, sep } from 'node:path';
import type { ViteDevServer } from 'vite';

export interface DevelopmentStyles {
  /** URLs of the stylesheets every page links, in the order a browser applies them. */
  readonly eager: readonly string[];
  /** URLs of the stylesheets each route component brings with its route, by its key. */
  readonly routes: Readonly<Record<string, readonly string[]>>;
}

const registered = new WeakMap<ViteDevServer, DevelopmentStyles>();

/**
 * Records the stylesheets of the last client build that compiled. `stylesheets` and
 * `routeStylesheets` are the compiler's files, as project paths resolved to Vite's file ids.
 */
export function registerClientStyles(
  server: ViteDevServer,
  stylesheets: readonly string[],
  routeStylesheets: Readonly<Record<string, readonly string[]>>,
): void {
  const root = server.config.root;
  const urls = (files: readonly string[]) => files.flatMap((file) => styleUrl(root, file) ?? []);
  const lazy = new Set(Object.values(routeStylesheets).flat());
  registered.set(server, {
    eager: urls(stylesheets.filter((file) => !lazy.has(file))),
    routes: Object.fromEntries(Object.entries(routeStylesheets).map(([key, files]) => [key, urls(files)])),
  });
}

/** The stylesheets registered for the dev server, or none before its first build. */
export function clientStyles(server: ViteDevServer): DevelopmentStyles {
  return registered.get(server) ?? { eager: [], routes: {} };
}

/** The URL Vite serves a file at: below the root, or through `/@fs/` outside it. */
function styleUrl(root: string, id: string): string | null {
  const marker = id.search(/[?#]/);
  const file = marker === -1 ? id : id.slice(0, marker);
  const suffix = marker === -1 ? '' : id.slice(marker);
  if (!isAbsolute(file)) return file.startsWith('/') ? `${file}${suffix}` : null;
  const path = relative(root, file);
  if (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) {
    return `/${path.split(sep).join('/')}${suffix}`;
  }
  return `/@fs/${file.replaceAll('\\', '/')}${suffix}`;
}
