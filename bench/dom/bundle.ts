/**
 * Bundle a DOM benchmark page from the selected compiler's generated files:
 * `./compiled-tsx-app` resolves to `compiled-tsx-app.ts` (existing compiler)
 * or `compiled-tsx-app.next.ts` (`BENCH_COMPILER=next`).
 *
 *   bun run bench/dom/bundle.ts <entry.ts> <outfile.js>
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import { compiledSuffix } from '../load-compiler';

export async function bundleDomPage(entry: string, outfile: string): Promise<void> {
  const suffix = compiledSuffix();
  await build({
    entryPoints: [entry], outfile, bundle: true, format: 'iife',
    plugins: [{
      name: 'selected-compiler-output',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/compiled-[a-z-]+$/ }, ({ path, resolveDir }) => {
          const file = resolve(resolveDir, `${path}${suffix}.ts`);
          if (!existsSync(file)) {
            throw new Error(`${file} is missing; run the DOM builds with the same BENCH_COMPILER first`);
          }
          return { path: file };
        });
      },
    }],
  });
}

if (import.meta.main) {
  const [entry, outfile] = process.argv.slice(2);
  if (entry === undefined || outfile === undefined) throw new Error('usage: bundle.ts <entry.ts> <outfile.js>');
  await bundleDomPage(resolve(entry), resolve(outfile));
  console.log(`Bundled ${entry} from compiled-*${compiledSuffix()}.ts into ${outfile}.`);
}

export const domDirectory = dirname(import.meta.filename);
