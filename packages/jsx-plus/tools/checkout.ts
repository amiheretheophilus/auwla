/**
 * Development tool: bundle this checkout's runtime, data, router and server sources instead of
 * their packages' `dist`, which can be older than the compiler that emits calls into them. A
 * subpath such as `@memoized-dom/router/internal` is `src/internal.ts`. Used by the examples'
 * previews and by the tests that bundle their fixture apps; it lives in neither folder, since
 * tests never depend on the examples.
 *
 * A browser build gets each package's browser entry (`src/index.ts`). A server build gets the
 * runtime's server entry (`src/server.ts`), as the package's export conditions choose outside a
 * browser, and the server package's own subpaths.
 */
import type { BunPlugin } from 'bun';
import { fileURLToPath } from 'node:url';

const PACKAGES = new URL('../../', import.meta.url);

/** Source files whose name is not the subpath's, by `<package>/<subpath>`. */
const RENAMED: Record<'browser' | 'server', Record<string, string>> = {
  browser: {},
  server: { 'runtime/index': 'runtime/src/server.ts', 'server/router': 'server/src/http-router.ts' },
};

export function checkoutPackagesFor(target: 'browser' | 'server'): BunPlugin {
  return {
    name: `example-checkout-packages-${target}`,
    setup(builder) {
      builder.onResolve({ filter: /^@memoized-dom\/(?:runtime|data|router|server)(?:\/[a-z-]+)?$/ }, ({ path }) => {
        const [, name, subpath = 'index'] = /^@memoized-dom\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(path)!;
        const file = RENAMED[target][`${name}/${subpath}`] ?? `${name}/src/${subpath}.ts`;
        return { path: fileURLToPath(new URL(file, PACKAGES)) };
      });
    },
  };
}

/** The browser build's packages. */
export const checkoutPackages: BunPlugin = checkoutPackagesFor('browser');
