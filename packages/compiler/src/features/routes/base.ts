/**
 * The prefix an application is served below (`base`, `options.ts`; `wiki/compiler/routes.md`,
 * "Base path"). The router reads route pathnames below it and writes it in front when it
 * navigates; the compiler writes it in front of each `route-to` link, so a link's `href` is right
 * in server HTML, in a new tab and before any script runs.
 */
import { CompileError } from '../../core/diagnostics';

/**
 * `/app/` and `/app` → `/app`; `/` or none → null, which adds nothing. Only a path: Vite's `./`
 * and full URLs place assets, and give no prefix a route can be read below. `path` is where the
 * error is reported: the module that installs the route table.
 */
export function routeBase(base: string | undefined, path: string): string | null {
  if (base === undefined) return null;
  if (!base.startsWith('/') || /[?#:*\\]/.test(base) || base.includes('//')) {
    throw new CompileError(`the base '${base}' must be a path such as '/app/', with no parameters, query or hash`, path);
  }
  const trimmed = base.replace(/\/+$/, '');
  return trimmed === '' ? null : trimmed;
}

/** `/about` below `/app` is `/app/about`; the root is `/app` itself, as the router writes it. */
export function mountedPath(base: string | null, path: string): string {
  if (base === null) return path;
  return path === '/' ? base : `${base}${path}`;
}
