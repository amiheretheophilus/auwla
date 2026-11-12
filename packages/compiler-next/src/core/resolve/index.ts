/**
 * resolve: parsed modules → `Resolved` (`wiki/compiler/core.md`).
 *
 * One `yuku-analyzer` project holds every module, so imports resolve across
 * files. yuku gives bindings, references, imports and exports; this stage adds
 * the write sites yuku does not track (`writes.ts`) and the host globals the
 * program writes (`globals.ts`). Later stages ask `Resolved`
 * about bindings and never look names up themselves.
 */
import { Analyzer, BindingFlags, type Binding, type Export, type Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { CompileModulesOptions } from '../../options';
import { CompileError } from '../diagnostics';
import type { ParsedModule } from '../parse';
import { composeOrigins, type TextOrigin } from '../parse/text-edits';
import { withAmbientImports } from './ambient';
import { findGlobalWrites, type GlobalWrites } from './globals';
import { importResolver, withRequireImports } from './imports';
import { capturedExport, importedBinding, namespaceModule } from './exports';
import { neverChanges } from './members';
import { findWrites, type WriteSite } from './writes';

export type { GlobalWrites } from './globals';
export { isWrittenGlobal } from './globals';
export type { PathKey, WriteKind, WriteSite } from './writes';
export type { Binding, Module, Reference } from 'yuku-analyzer';
export { declaringRunner, runnerOf } from './writes';
export { namespaceModule } from './exports';

export interface ResolvedModule {
  readonly path: string;
  /** yuku's model: bindings, references, imports, exports, scopes, the AST. */
  readonly module: Module;
  readonly hasJsx: boolean;
  /** Every place each binding may change: reassignment and mutation. */
  readonly writes: ReadonlyMap<Binding, readonly WriteSite[]>;
  /** The text as the caller gave it, which source maps point into. */
  readonly authored: string;
  /** Where each offset of the analyzed text (`module.source`) was in `authored`. */
  readonly origin: TextOrigin;
}

export interface Resolved {
  readonly analyzer: Analyzer;
  /** In the order the caller gave them. */
  readonly modules: readonly ResolvedModule[];
  /** Host globals the program writes; every other global is not an input. */
  readonly globals: GlobalWrites;
  /** The write sites of a binding in any module. */
  writesOf(binding: Binding): readonly WriteSite[];
  /** Whether code outside this graph can reach this binding through an entry's exports. */
  usedOutside(module: Module, binding: Binding | null): boolean;
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
  return importedBinding(binding);
}

export function resolve(parsed: readonly ParsedModule[], options: CompileModulesOptions): Resolved {
  const paths = parsed.map((module) => module.path);
  const resolveImport = importResolver(paths, options);
  const analyzer = new Analyzer({ resolve: resolveImport });

  const modules = parsed.map((input): ResolvedModule => {
    const settings = { lang: input.lang, sourceType: 'module' } as const;
    const required = withRequireImports(input, parsed, resolveImport);
    const source = required.text;
    let module = analyzer.setFile(input.path, source, settings);
    const ambient = withAmbientImports(module, source);

    if (ambient !== null) {
      module = analyzer.setFile(input.path, ambient, settings);
    }

    const error = module.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error !== undefined) {
      // Parse already checked the authored text, so this is lowered code.
      throw CompileError.at(`after lowering TypeScript: ${error.message}`, input.path, source, error.start);
    }
    // Ambient imports are appended, so they move no offset (`ambient.ts`).
    const origin = composeOrigins(required.origin, input.origin);
    return { path: input.path, module, hasJsx: input.hasJsx, writes: findWrites(module), authored: input.authored, origin };
  });

  analyzer.link();

  const byModule = new Map(modules.map((entry) => [entry.module, entry]));
  const globals = findGlobalWrites(modules.map((entry) => entry.module));
  const writesOf = (binding: Binding) => byModule.get(binding.module)?.writes.get(binding) ?? [];
  return { analyzer, modules, globals, writesOf, usedOutside: outsideUses(modules, options.entries) };
}

/** `import(name)` with a specifier only known at run time, which the analyzer does not record. */
export function hasComputedImport(module: Module): boolean {
  return module.findAll('ImportExpression').some((node) => !is.Literal(node.source));
}

/** Every module an `import()` can reach. A specifier worked out at run time could name any of them. */
export function dynamicallyImported(modules: readonly ResolvedModule[]): ReadonlySet<Module> {
  if (modules.some(({ module }) => hasComputedImport(module))) {
    return new Set(modules.map(({ module }) => module));
  }

  const byPath = new Map(modules.map((entry) => [entry.path, entry.module]));
  const reached = new Set<Module>();

  for (const { module } of modules) {
    for (const imported of module.imports) {
      const target = imported.resolvedModule === null ? undefined : byPath.get(imported.resolvedModule.path);
      if (imported.kind === 'dynamic' && !imported.typeOnly && target !== undefined) reached.add(target);
    }
  }

  return reached;
}

/**
 * The modules reached by `import()` that export something that can change. Their namespace
 * can sit in any variable, so reading state through it is a read the compiler cannot name
 * (`wiki/compiler/linking.md`, "A namespace from import()"). A lazy page exporting only its
 * components and constants is not one, and costs nothing.
 */
export function openNamespaces(resolved: Resolved): ReadonlySet<Module> {
  const open = new Set<Module>();

  for (const module of dynamicallyImported(resolved.modules)) {
    const canChange = module.exportedNames().some((name) => {
      const captured = capturedExport(module, name);
      if (captured !== null) return !isConstantDefault(captured);
      const definition = module.resolveExport(name)?.binding;
      return definition != null && !neverChanges(resolved, definition);
    });
    if (canChange) open.add(module);
  }

  return open;
}

/** `export default 42` or `export default () => …`: its value is fixed when the file runs. */
function isConstantDefault(exported: Export): boolean {
  const value = is.ExportDefaultDeclaration(exported.node) ? exported.node.declaration : null;
  return is.Literal(value) || is.Function(value);
}

/**
 * An entry's own exports, and what it forwards from other modules. A module that is
 * not an entry is reached only through imports, which the graph can see by name. A
 * namespace or a dynamic import is not followed by name, so its module counts as an entry.
 */
function outsideUses(
  modules: readonly ResolvedModule[],
  entries: readonly string[] | undefined,
): Resolved['usedOutside'] {
  if (entries === undefined) return () => true;

  const named = new Set(entries);
  const open = new Set(modules.filter((entry) => named.has(entry.path)).map((entry) => entry.module));

  for (const { module } of modules) {
    for (const binding of module.bindings) {
      const namespace = namespaceModule(binding);
      if (namespace !== null) open.add(namespace);
    }
  }
  for (const module of dynamicallyImported(modules)) open.add(module);

  const forwarded = new Set<Binding>();
  for (const module of open) {
    for (const name of module.exportedNames()) {
      const binding = module.resolveExport(name)?.binding;
      if (binding !== null && binding !== undefined) forwarded.add(binding);
    }
  }
  return (module, binding) => open.has(module) || (binding !== null && forwarded.has(binding));
}
