/**
 * The acceptance switch (`wiki/compiler/testing.md`, layer 7): the old suites run against
 * compiler-next without changing a test.
 *
 *     bun test --preload ./test-support/compiler-next.ts ./tests/derived-literals.test.ts
 *
 * Every test that imports `@memoized-dom/compiler` gets compiler-next's `compile` and
 * `compileModules`. Whatever compiler-next does not provide yet stays the old compiler's, so a
 * test of server functions still runs. Tests that import `packages/compiler/src/…` directly test
 * the old compiler's internals, and this switch does not reach them.
 */
import { mock } from 'bun:test';
import * as oldCompiler from '../packages/compiler/src/index';
import { compile, compileModules } from '../packages/compiler-next/src/index';

mock.module('@memoized-dom/compiler', () => ({ ...oldCompiler, compile, compileModules }));
