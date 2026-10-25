/**
 * Select the compiler a benchmark build uses:
 *
 * - `--compiler=<path>`: an isolated compiler snapshot's entry, for one build;
 * - `BENCH_COMPILER=next`: the rewrite (`packages/compiler-next`). An
 *   environment variable reaches every step of a chained script such as
 *   `bun run bench`; a flag reaches only the last;
 * - otherwise the existing compiler, `@memoized-dom/compiler`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPILER_NEXT = resolve(import.meta.dirname, '../packages/compiler-next/src/index.ts');

/** The selected compiler's entry path, or null for the existing compiler. */
export function selectedCompilerPath(): string | null {
  const argument = process.argv.find(value => value.startsWith('--compiler='));
  if (argument !== undefined) return resolve(argument.slice('--compiler='.length));
  const choice = process.env.BENCH_COMPILER;
  if (choice === undefined || choice === '' || choice === 'old') return null;
  if (choice === 'next') return COMPILER_NEXT;
  throw new Error(`BENCH_COMPILER=${choice}: use 'old' or 'next'`);
}

/**
 * What generated benchmark files carry before `.ts` for the selected compiler:
 * `compiled-tsx-app.ts` is the existing compiler's, `compiled-tsx-app.next.ts`
 * compiler-next's, so both stay side by side and neither overwrites the other.
 * Another `--compiler=<path>` writes `.custom`.
 */
export function compiledSuffix(): string {
  const path = selectedCompilerPath();
  if (path === null) return '';
  return path === COMPILER_NEXT ? '.next' : '.custom';
}

export async function loadBenchmarkCompiler(): Promise<typeof import('@memoized-dom/compiler')> {
  const path = selectedCompilerPath();
  return path === null ? import('@memoized-dom/compiler') : import(pathToFileURL(path).href);
}
