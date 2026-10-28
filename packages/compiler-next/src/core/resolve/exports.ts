/** Value exports on the analyzer's linked graph, preserving native binding identity. */
import { is } from 'yuku-ast';
import { BindingFlags } from 'yuku-analyzer';
import type { Binding, Export, Import, Module } from 'yuku-analyzer';

type ValueExport =
  | { readonly kind: 'binding'; readonly binding: Binding; readonly identity: Binding }
  | { readonly kind: 'namespace'; readonly module: Module; readonly identity: Module }
  | { readonly kind: 'expression'; readonly exported: Export; readonly identity: Export }
  | { readonly kind: 'external'; readonly exported: Export; readonly identity: Export };

// A conflict must survive forwarding and caching. Treating it as a missing
// export would let a later star edge incorrectly select one of its bindings.
const ambiguous = Symbol('ambiguous export');
type ExportResult = ValueExport | typeof ambiguous | null;

const imports = new WeakMap<Module, ReadonlyMap<Binding, Import>>();
const exports = new WeakMap<Module, Map<string, ExportResult>>();
const metadata = new WeakMap<Module, {
  readonly direct: ReadonlyMap<string, Export>;
  readonly stars: readonly Export[];
}>();

function exportsOf(module: Module) {
  let indexed = metadata.get(module);
  if (indexed === undefined) {
    const direct = new Map<string, Export>();
    const stars: Export[] = [];

    for (const entry of module.exports) {
      if (entry.typeOnly) {
        continue;
      }
      if (entry.name !== null) {
        direct.set(entry.name, entry);
      } else if (entry.kind === 'star') {
        stars.push(entry);
      }
    }

    indexed = { direct, stars };
    metadata.set(module, indexed);
  }
  return indexed;
}

/** The import declaring `binding`, if it is one. */
export function importOf(binding: Binding): Import | undefined {
  let indexed = imports.get(binding.module);

  if (indexed === undefined) {
    indexed = new Map(binding.module.imports.flatMap((entry) => {
      return entry.local === null ? [] : [[entry.local, entry] as const];
    }));
    imports.set(binding.module, indexed);
  }

  return indexed.get(binding);
}

/** The `@memoized-dom/*` package a value import names, when this build does not compile it. */
export function frameworkPackage(binding: Binding): string | null {
  const entry = importOf(binding);
  const framework = entry !== undefined && !entry.typeOnly && entry.resolvedModule === null
    && entry.specifier.startsWith('@memoized-dom/');
  return framework ? entry.specifier : null;
}

export function isValueImport(binding: Binding): boolean {
  const entry = importOf(binding);
  return entry !== undefined && !entry.typeOnly;
}

/** A linked live binding; a default expression captures a separate native value. */
export function importedBinding(binding: Binding): Binding | null {
  const entry = importOf(binding);
  if (entry === undefined || entry.typeOnly || entry.resolvedModule === null || entry.name === null) {
    return null;
  }

  const target = valueExport(entry.resolvedModule, entry.name);
  return target?.kind === 'binding' ? target.binding : null;
}

/** A native namespace, including a namespace forwarded by a named export. */
export function namespaceModule(binding: Binding): Module | null {
  const entry = importOf(binding);
  if (entry?.resolvedModule == null || entry.typeOnly) {
    return null;
  }
  if (entry.isNamespace) {
    return entry.resolvedModule;
  }

  const target = entry.name === null ? null : valueExport(entry.resolvedModule, entry.name);
  return target?.kind === 'namespace' ? target.module : null;
}

/** Runtime names only: erased types and ambiguous star exports are not properties. */
export function valueExportNames(module: Module): readonly string[] {
  return module.exportedNames().filter((name) => valueExport(module, name) !== null);
}

/** Public explicit exports; native star edges must remain native, including unknown packages. */
export function explicitValueExportNames(module: Module): readonly string[] {
  return [...exportsOf(module).direct].flatMap(([name, entry]) => {
    const binding = entry.local ?? module.resolveExport(name)?.binding;
    return binding != null && !valueBinding(binding) ? [] : [name];
  });
}

/** A captured expression used through a linked import. */
export function capturedImport(binding: Binding): Export | null {
  const entry = importOf(binding);
  return entry?.resolvedModule && entry.name !== null && !entry.typeOnly
    ? capturedExport(entry.resolvedModule, entry.name)
    : null;
}

/** The original expression, including through barrels; declarations keep their native hoisting. */
export function capturedExport(module: Module, name: string): Export | null {
  const target = valueExport(module, name);
  if (target?.kind !== 'expression' || !is.ExportDefaultDeclaration(target.exported.node)) {
    return null;
  }

  const value = target.exported.node.declaration;
  return is.FunctionDeclaration(value) || is.ClassDeclaration(value) ? null : target.exported;
}

function valueExport(module: Module, name: string): ValueExport | null {
  const result = resolveValueExport(module, name);
  return result === ambiguous ? null : result;
}

function resolveValueExport(module: Module, name: string, visited = new Map<Module, Set<string>>()): ExportResult {
  const root = visited.size === 0;
  const cached = exports.get(module)?.get(name);
  if (cached !== undefined) {
    return cached;
  }

  const names = visited.get(module) ?? new Set<string>();
  if (names.has(name)) {
    return null;
  }
  names.add(name);
  visited.set(module, names);

  const indexed = exportsOf(module);
  const direct = indexed.direct.get(name);
  let target: ExportResult = null;

  if (direct !== undefined) {
    target = directExport(direct, visited);
  } else if (name !== 'default') {
    for (const entry of indexed.stars) {
      if (entry.resolvedModule === null) {
        continue;
      }
      const candidate = resolveValueExport(entry.resolvedModule, name, visited);
      if (candidate === null) {
        continue;
      }
      if (candidate === ambiguous || (target !== null && target.identity !== candidate.identity)) {
        target = ambiguous;
        break;
      }
      target = candidate;
    }
  }

  // A partial traversal through a cycle cannot establish an absent export.
  // Keep one visited set for the whole query, as native star resolution does:
  // repeated diamonds must not expand the same dependency exponentially.
  // Cache completed root queries only; the analyzer models are immutable.
  if (root) {
    const indexed = exports.get(module) ?? new Map<string, ExportResult>();
    indexed.set(name, target);
    exports.set(module, indexed);
  }
  return target;
}

function directExport(entry: Export, visited: Map<Module, Set<string>>): ExportResult {
  if (entry.local !== null && !valueBinding(entry.local)) {
    return null;
  }
  if (entry.kind === 'namespace' && entry.resolvedModule !== null) {
    return { kind: 'namespace', module: entry.resolvedModule, identity: entry.resolvedModule };
  }
  if (entry.kind === 'reExport') {
    return entry.resolvedModule !== null && entry.fromName !== null
      ? resolveValueExport(entry.resolvedModule, entry.fromName, visited)
      : { kind: 'external', exported: entry, identity: entry };
  }

  if (is.ExportDefaultDeclaration(entry.node)) {
    const value = entry.node.declaration;
    if (!is.FunctionDeclaration(value) && !is.ClassDeclaration(value)) {
      return { kind: 'expression', exported: entry, identity: entry };
    }
    if (entry.local === null) {
      return { kind: 'expression', exported: entry, identity: entry };
    }
  }

  const binding = entry.local;
  if (binding === null || !valueBinding(binding)) {
    return null;
  }
  const imported = importOf(binding);
  if (imported?.resolvedModule) {
    if (imported.isNamespace) {
      return { kind: 'namespace', module: imported.resolvedModule, identity: imported.resolvedModule };
    }
    return imported.name === null ? null : resolveValueExport(imported.resolvedModule, imported.name, visited);
  }
  return { kind: 'binding', binding, identity: binding };
}

function valueBinding(binding: Binding): boolean {
  return binding.visibleIn('value') && !binding.has(BindingFlags.TypeImport);
}
