/**
 * Public configuration for the Vite connected-graph adapter.
 */
import type { CompileModulesOptions } from '@memoized-dom/compiler';

export interface MemoizedDomViteOptions
  extends Omit<CompileModulesOptions, 'aliases' | 'resolveImport' | 'hot'> {
  /** Browser bootstrap and connected compiler-graph entry. */
  clientEntry: string;
  /** Server composition root. Omit for browser-only applications. */
  serverEntry?: string;
  /** Production host and CLI dev target. Direct createDevServer() calls use their launching runtime. */
  runtime?: 'bun' | 'node' | 'cloudflare';
  /** Opt installed ESM packages into compiler analysis and a generated dependency cache. */
  compilePackages?: readonly string[];
  /**
   * Additional source paths allowed outside the Vite project root.
   */
  include?: RegExp | readonly RegExp[];
  /**
   * Source paths excluded from connected-graph compilation.
   */
  exclude?: RegExp | readonly RegExp[];
  /**
   * Server-only convention root. Its define.ts registers application
   * server types and its functions directory contains server functions.
   */
  server?: string;
}

export interface ResolvedAdapterOptions
  extends Omit<MemoizedDomViteOptions, 'clientEntry'> {
  entries: readonly string[];
}

export function resolveAdapterOptions(
  options: MemoizedDomViteOptions,
): ResolvedAdapterOptions {
  if (options.clientEntry.trim() === '') {
    throw new Error('memoized-dom: clientEntry must not be empty');
  }
  if (options.compilePackages !== undefined && (!Array.isArray(options.compilePackages) ||
      !options.compilePackages.every(name => typeof name === 'string' &&
        /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)))) {
    throw new Error('memoized-dom: compilePackages must be an array of package names, not paths or subpath entries');
  }
  if (options.compilePackages?.length && options.frontend) {
    throw new Error('memoized-dom: compilePackages currently requires the default frontend for reproducible cache identity');
  }
  return { ...options, ...(options.compilePackages ? { compilePackages: [...new Set(options.compilePackages)] } : {}), entries: [options.clientEntry] };
}
