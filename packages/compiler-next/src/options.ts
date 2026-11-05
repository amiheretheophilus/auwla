/**
 * Options of `compileModules`. One read-only object, passed to every stage that
 * needs it (`wiki/compiler/README.md`, rule 2).
 *
 * The old compiler's options (`packages/compiler/src/linking/model.ts`) arrive
 * with the phase that needs each one (`wiki/compiler/plan.md`). Unknown options
 * are ignored, so callers can switch compilers without changes.
 */
export interface CompileModulesOptions {
  /** Disable optional plan fast paths to retain the general implementation. */
  readonly optimize?: boolean;
  /** The runtime module the emitted code imports. Default `@memoized-dom/runtime`. */
  readonly runtimePath?: string;
  /**
   * `client`: this build never receives data from a server, so it can leave out
   * restoring it. Default `universal`. Vite passes this (`packages/vite/src/graph/collector.ts`).
   */
  readonly dataDelivery?: 'universal' | 'client';
  /**
   * The modules whose exports code outside this graph can use, such as the app's entry.
   * Everything else is called only from modules in the graph, so the compiler can follow
   * what those calls pass (`wiki/compiler/sources.md`). Default: every module.
   */
  readonly entries?: readonly string[];
  /**
   * Maps an import specifier to the path of one of the compiled modules, when the
   * default rule (relative paths, probing extensions and index files) does not.
   * Return `undefined` to use the default.
   */
  readonly resolveImport?: (specifier: string, importer: string) => string | undefined;
}

export const DEFAULT_RUNTIME_PATH = '@memoized-dom/runtime';
