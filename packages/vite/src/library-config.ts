import type { ExperimentalCompilePackageOptions, PackageBoundaryEntries } from '@memoized-dom/compiler';

/** One authoring surface for a publishable compiler-aware library. */
export interface LibraryConfig {
  entry: string;
  /** Each directory is an explicit public boundary, not a list of components. */
  subpaths?: readonly string[];
  outDir?: string;
  minify?: boolean;
  sourcemap?: boolean;
  declarations?: boolean | { tsconfig: string };
  /** Normal publishing metadata overrides; generated layout fields stay tool-owned. */
  package?: Readonly<Record<string, unknown>>;
  aliases?: Readonly<Record<string, string>>;
  /** Advanced runtime implementers only: ordinary libraries need neither option. */
  runtimeOwnedState?: boolean;
  boundaries?: PackageBoundaryEntries;
  compiler?: Omit<ExperimentalCompilePackageOptions, 'packageEntries' | 'resolveImport' | 'hot' | 'initialContent'>;
}
