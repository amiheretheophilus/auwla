/**
 * Options of `compileModules`. One read-only object, passed to every stage that
 * needs it (`wiki/compiler/README.md`, rule 2).
 *
 * The old compiler's options (`packages/compiler/src/linking/model.ts`) arrive
 * with the phase that needs each one (`wiki/compiler/plan.md`). Unknown options
 * are ignored, so callers can switch compilers without changes.
 */
export interface CompileModulesOptions {
  /** The runtime module the emitted code imports. Default `@memoized-dom/runtime`. */
  readonly runtimePath?: string;
  /**
   * Maps an import specifier to the path of one of the compiled modules, when the
   * default rule (relative paths, probing extensions and index files) does not.
   * Return `undefined` to use the default.
   */
  readonly resolveImport?: (specifier: string, importer: string) => string | undefined;
}

export const DEFAULT_RUNTIME_PATH = '@memoized-dom/runtime';
