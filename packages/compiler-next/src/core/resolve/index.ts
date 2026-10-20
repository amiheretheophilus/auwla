/**
 * resolve: parsed modules → `Resolved` (`wiki/compiler/core.md`).
 *
 * One `yuku-analyzer` project holds every module, so imports resolve across
 * files. yuku gives bindings, references, imports and exports; this stage adds
 * the write sites yuku does not track (`writes.ts`). Later stages ask `Resolved`
 * about bindings and never look names up themselves.
 */
import { Analyzer, BindingFlags, type Binding, type Module } from 'yuku-analyzer';
import type { CompileModulesOptions } from '../../options';
import { CompileError } from '../diagnostics';
import type { ParsedModule } from '../parse';
import { importResolver } from './imports';
import { findWrites, type WriteSite } from './writes';

export type { PathKey, WriteKind, WriteSite } from './writes';
export type { Binding, Reference } from 'yuku-analyzer';
export { declaringRunner, runnerOf } from './writes';

export interface ResolvedModule {
  readonly path: string;
  /** yuku's model: bindings, references, imports, exports, scopes, the AST. */
  readonly module: Module;
  readonly hasJsx: boolean;
  /** Every place each binding may change: reassignment and mutation. */
  readonly writes: ReadonlyMap<Binding, readonly WriteSite[]>;
}

export interface Resolved {
  readonly analyzer: Analyzer;
  /** In the order the caller gave them. */
  readonly modules: readonly ResolvedModule[];
}

/** Type-only imports are visible to value-space lookup in yuku, but are erased. */
export function isRuntimeBinding(binding: Binding): boolean {
  return binding.visibleIn('value') && !binding.has(BindingFlags.TypeImport);
}

export function resolve(parsed: readonly ParsedModule[], options: CompileModulesOptions): Resolved {
  const paths = parsed.map((module) => module.path);
  const analyzer = new Analyzer({ resolve: importResolver(paths, options) });

  const modules = parsed.map((input): ResolvedModule => {
    const module = analyzer.setFile(input.path, input.source, { lang: input.lang, sourceType: 'module' });
    const error = module.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error !== undefined) {
      // Parse already checked the authored text, so this is lowered code.
      throw CompileError.at(`after lowering TypeScript: ${error.message}`, input.path, input.source, error.start);
    }
    return { path: input.path, module, hasJsx: input.hasJsx, writes: findWrites(module) };
  });

  analyzer.link();
  return { analyzer, modules };
}
