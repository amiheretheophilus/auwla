/**
 * Select the compiler a benchmark build uses:
 *
 * - `--compiler=<path>`: an isolated compiler snapshot's entry, for one build;
 * - `BENCH_COMPILER=<path>`: the same for every step of a chained script such as
 *   `bun run bench`, since an environment variable reaches each step and a flag only the last;
 * - otherwise the compiler, `packages/compiler`.
 *
 * The old compiler was deleted with Phase 10's exit (`wiki/compiler/plan.md`). A baseline commit
 * that still has it is compared through `bench/dom/compare.ts --before-ref=<commit>` or a
 * snapshot path here.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPILER = resolve(import.meta.dirname, '../packages/compiler/src/index.ts');

/** A snapshot compiler's entry path, or null for the compiler in this checkout. */
export function selectedCompilerPath(): string | null {
  const argument = process.argv.find(value => value.startsWith('--compiler='));
  if (argument !== undefined) return resolve(argument.slice('--compiler='.length));
  const choice = process.env.BENCH_COMPILER;
  if (choice === undefined || choice === '') return null;
  if (choice === 'old' || choice === 'next') {
    throw new Error(`BENCH_COMPILER=${choice}: there is one compiler now; give a snapshot's entry path, or leave it unset`);
  }
  return resolve(choice);
}

/**
 * What generated benchmark files carry before `.ts`: nothing for the compiler in this checkout
 * (`compiled-tsx-app.ts`), `.custom` for a snapshot, so a snapshot's output never overwrites the
 * tracked files.
 */
export function compiledSuffix(): string {
  return selectedCompilerPath() === null ? '' : '.custom';
}

export async function loadBenchmarkCompiler(): Promise<typeof import('@memoized-dom/compiler')> {
  const path = selectedCompilerPath() ?? COMPILER;
  return import(pathToFileURL(path).href);
}
