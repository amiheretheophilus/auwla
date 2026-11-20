/**
 * Builds the navigation benchmark's pages: `app.tsx` compiled three ways, each bundled with
 * `browser.ts` into its own page (each installs the same route table):
 *
 * - `optimized`: every pass, as an app is built;
 * - `without-route-regions`: every pass but `route-regions`, so the two differ by that pass alone;
 * - `general`: no pass, the general path.
 *
 *   bun run bench/navigation/build.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compiledSuffix, loadBenchmarkCompiler } from '../load-compiler';

export const VARIANTS = ['optimized', 'without-route-regions', 'general'] as const;
export type Variant = (typeof VARIANTS)[number];

const OPTIMIZE: Record<Variant, boolean | { readonly skip: readonly string[] }> = {
  optimized: true,
  'without-route-regions': { skip: ['route-regions'] },
  general: false,
};

const directory = import.meta.dirname;
export const distDirectory = resolve(directory, 'dist');

export async function buildNavigationPages(): Promise<void> {
  const { compileModules } = await loadBenchmarkCompiler();
  const suffix = compiledSuffix();
  mkdirSync(distDirectory, { recursive: true });

  const appId = './bench/navigation/app.tsx';
  const sources = {
    [appId]: readFileSync(resolve(directory, 'app.tsx'), 'utf8'),
    './bench/navigation/entry.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './app';\nmount('root', App);\n`,
  };

  for (const variant of VARIANTS) {
    const output = compileModules(sources, {
      runtimePath: '@memoized-dom/runtime',
      entries: ['./bench/navigation/entry.ts'],
      routedEnvironment: 'client',
      optimize: OPTIMIZE[variant],
    });
    const compiled = output[appId];
    if (compiled === undefined) throw new Error(`the compiler gave no output for ${appId}`);
    writeFileSync(resolve(distDirectory, `compiled-${variant}${suffix}.ts`), compiled);
    writeFileSync(
      resolve(distDirectory, `entry-${variant}.ts`),
      `import { install } from '../browser';\nimport { App } from './compiled-${variant}${suffix}';\ninstall(App);\n`,
    );

    // An ES module: the compiled app prepares its first route with a top-level await.
    await build({
      entryPoints: [resolve(distDirectory, `entry-${variant}.ts`)],
      outfile: resolve(distDirectory, `navigation-${variant}.js`),
      bundle: true,
      format: 'esm',
      target: 'es2022',
      minify: true,
      logLevel: 'warning',
    });
    writeFileSync(resolve(distDirectory, `${variant}.html`), `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Navigation benchmark: ${variant}</title></head>
<body><div id="root"></div><script type="module" src="/navigation-${variant}.js"></script></body>
</html>
`);
  }
}

if (import.meta.main) {
  await buildNavigationPages();
  console.log(`Built the navigation pages (${VARIANTS.join(', ')}) in ${distDirectory}.`);
}
