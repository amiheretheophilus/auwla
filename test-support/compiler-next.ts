/**
 * The acceptance switch (`wiki/compiler/testing.md`, layer 7): the old suites run against
 * compiler-next without changing a test.
 *
 *     bun test --preload ./test-support/compiler-next.ts ./tests/derived-literals.test.ts
 *
 * Every test that imports `@memoized-dom/compiler` gets compiler-next's `compile` and
 * `compileModules`. The old compiler's other entry points that compile a program
 * (`compileModulesDetailed`, which `packages/vite` calls, `compileDetailed`, packages and server
 * pages) throw instead: running the old compiler there would pass or fail a test on evidence about
 * the old compiler. They move with `packages/vite` (Phase 10), whose result contract compiler-next
 * does not have yet. Parsers, diagnostics and the server-function transforms stay the old
 * compiler's, so a test of server functions still runs. Tests that import
 * `packages/compiler/src/…` directly test the old compiler's internals, and this switch does not
 * reach them.
 */
import { mock } from 'bun:test';
import * as oldCompiler from '../packages/compiler/src/index';
import { compile, compileModules } from '../packages/compiler-next/src/index';

/** An old entry point that compiles a program, and that compiler-next does not provide yet. */
function notOnCompilerNext(name: string) {
  return () => {
    throw new Error(`${name} is not on compiler-next yet; under the acceptance switch it would run the old compiler`);
  };
}

mock.module('@memoized-dom/compiler', () => ({
  ...oldCompiler,
  compile,
  compileModules,
  compileDetailed: notOnCompilerNext('compileDetailed'),
  compileModulesDetailed: notOnCompilerNext('compileModulesDetailed'),
  experimentalCompilePackage: notOnCompilerNext('experimentalCompilePackage'),
  compileServerPage: notOnCompilerNext('compileServerPage'),
  emitInitialHtml: notOnCompilerNext('emitInitialHtml'),
}));
