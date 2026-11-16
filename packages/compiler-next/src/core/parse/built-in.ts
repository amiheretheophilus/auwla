/**
 * The languages the compiler reads without being told: `.auwla` (JSX+, `packages/jsx-plus`), part
 * of the framework as JSX is (`wiki/compiler/core.md`, "Source languages"). The user, 2026-11-16:
 * "the compiler already knows auwla". Every entry point and tool reads `.auwla` with no import and
 * no option, because the two functions that find a module's language include it
 * (`languageOf`, `languageExtensions`).
 *
 * JSX+ is loaded the first time a `.auwla` module is read, not when the compiler loads: JSX+ itself
 * uses compiler-next's `analysis` entry (its errors extend `CompileError`), so importing it from
 * here at load time would be a cycle that can reach `CompileError` before it exists. By the first
 * `.auwla` module, the compiler has finished loading. An app with no `.auwla` file never loads it.
 */
import { createRequire } from 'node:module';
import type { SourceLanguage } from './languages';

let loaded: SourceLanguage | undefined;

/** JSX+'s language, loaded once. Bun reads its sources; Node its built files (`package.json`). */
function jsxPlus(): SourceLanguage {
  loaded ??= (createRequire(import.meta.url)('@memoized-dom/jsx-plus/language') as { auwla: SourceLanguage }).auwla;
  return loaded;
}

/** `.auwla`, standing in for JSX+'s language until a module needs it. */
const AUWLA: SourceLanguage = {
  extensions: ['.auwla'],
  toTsx: (text, path) => jsxPlus().toTsx(text, path),
};

export const BUILT_IN_LANGUAGES: readonly SourceLanguage[] = [AUWLA];
