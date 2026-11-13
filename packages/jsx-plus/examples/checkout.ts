/**
 * Example-only: bundle this checkout's runtime, data and router sources instead of their packages'
 * `dist`, which can be older than the compiler that emits calls into them. A browser build gets
 * each package's browser entry (`src/index.ts`); a subpath such as `@memoized-dom/router/internal`
 * is `src/internal.ts`. Used by `preview.ts` and the tests that bundle the examples.
 */
import type { BunPlugin } from 'bun';
import { fileURLToPath } from 'node:url';

const PACKAGES = new URL('../../', import.meta.url);

export const checkoutPackages: BunPlugin = {
  name: 'example-checkout-packages',
  setup(builder) {
    builder.onResolve({ filter: /^@memoized-dom\/(?:runtime|data|router)(?:\/[a-z-]+)?$/ }, ({ path }) => {
      const [, name, subpath] = /^@memoized-dom\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(path)!;
      return { path: fileURLToPath(new URL(`${name}/src/${subpath ?? 'index'}.ts`, PACKAGES)) };
    });
  },
};
