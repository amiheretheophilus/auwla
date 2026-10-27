/**
 * resolve: parsed modules → `Resolved` (`wiki/compiler/core.md`).
 *
 * One `yuku-analyzer` project holds every module, so imports resolve across
 * files. yuku gives bindings, references, imports and exports; this stage adds
 * the write sites yuku does not track (`writes.ts`) and the host globals the
 * program writes (`globals.ts`). Later stages ask `Resolved`
 * about bindings and never look names up themselves.
 */
import { Analyzer, BindingFlags, type Binding, type Module } from 'yuku-analyzer';
import type { CompileModulesOptions } from '../../options';
import { CompileError } from '../diagnostics';
import type { ParsedModule } from '../parse';
import { withAmbientImports } from './ambient';
import { findGlobalWrites, type GlobalWrites } from './globals';
import { importResolver } from './imports';
import { findWrites, type WriteSite } from './writes';

export type { GlobalWrites } from './globals';
export { isWrittenGlobal } from './globals';
export type { PathKey, WriteKind, WriteSite } from './writes';
export type { Binding, Module, Reference } from 'yuku-analyzer';
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
  /** Host globals the program writes; every other global is not an input. */
  readonly globals: GlobalWrites;
  /** The write sites of a binding in any module. */
  writesOf(binding: Binding): readonly WriteSite[];
}

/**
 * Type-only imports are visible to value-space lookup in yuku, but are erased.
 * So are the parameters of a type: `id` in `select: (id: number) => void`
 * is a parameter binding to yuku, and does not exist at runtime.
 */
export function isRuntimeBinding(binding: Binding): boolean {
  return binding.visibleIn('value') && !binding.has(BindingFlags.TypeImport) && !declaredInType(binding);
}

/** Nodes whose whole subtree is a type, erased from the emitted program. */
const TYPE_ONLY = new Set([
  'TSTypeAnnotation', 'TSFunctionType', 'TSConstructorType', 'TSMethodSignature',
  'TSCallSignatureDeclaration', 'TSConstructSignatureDeclaration', 'TSDeclareFunction',
  'TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSTypeLiteral',
]);

function declaredInType(binding: Binding): boolean {
  const name = binding.declarations[0];
  if (name === undefined) return false;
  for (const ancestor of binding.module.ancestors(name)) {
    if (TYPE_ONLY.has(ancestor.type)) return true;
  }
  return false;
}

export function isParameter(binding: Binding): boolean {
  return binding.has(BindingFlags.Parameter);
}

/** For an import, the binding it names in a compiled module (through re-exports); otherwise null. */
export function importedDefinition(binding: Binding): Binding | null {
  const definition = binding.definition()?.binding;
  return definition != null && definition !== binding ? definition : null;
}

export function resolve(parsed: readonly ParsedModule[], options: CompileModulesOptions): Resolved {
  const paths = parsed.map((module) => module.path);
  const analyzer = new Analyzer({ resolve: importResolver(paths, options) });

  const modules = parsed.map((input): ResolvedModule => {
    const settings = { lang: input.lang, sourceType: 'module' } as const;
    let module = analyzer.setFile(input.path, input.source, settings);
    const ambient = withAmbientImports(module, input.source);

    if (ambient !== null) {
      module = analyzer.setFile(input.path, ambient, settings);
    }

    const error = module.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error !== undefined) {
      // Parse already checked the authored text, so this is lowered code.
      throw CompileError.at(`after lowering TypeScript: ${error.message}`, input.path, input.source, error.start);
    }
    return { path: input.path, module, hasJsx: input.hasJsx, writes: findWrites(module) };
  });

  analyzer.link();

  const byModule = new Map(modules.map((entry) => [entry.module, entry]));
  const globals = findGlobalWrites(modules.map((entry) => entry.module));
  const writesOf = (binding: Binding) => byModule.get(binding.module)?.writes.get(binding) ?? [];
  return { analyzer, modules, globals, writesOf };
}
