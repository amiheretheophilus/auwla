/**
 * Which module bindings something reactive may read (`wiki/compiler/state-and-derived.md`,
 * "Module state nothing reactive reads").
 *
 * A module binding's reader and version exist so a component, an effect or a shared derivation
 * can follow it. Code at a module's top level runs once, when the module loads, so a read there
 * follows nothing: `const app = serve(…); app.ssr(App); export default app` needs no reader for
 * `app`. A read inside any function may run during a component's render (the function may be
 * called from one), so it counts; this is conservative, and keeps every case where a reader can
 * matter:
 *
 * - a reference inside a function, class body or effect, in any module, through imports;
 * - a read by the derivation of a binding that keeps its reader, which refreshes through it;
 * - an `export default` expression that another compiled module imports, which a captured value
 *   reads (`link/captured-plan.ts`);
 * - a binding reachable through a namespace, which `shared-plan.ts` keeps for its observer.
 */
import { is } from 'yuku-ast';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { importedDefinition, type Binding, type Module, type Reference } from '../../core/resolve';

export function reactivelyRead(graph: SemanticGraph, kept: ReadonlySet<Binding>): (node: BindingNode) => boolean {
  const imported = importedModules(graph);
  const read = new Set<Binding>();
  const work: Binding[] = [];
  const mark = (binding: Binding): void => {
    if (read.has(binding)) return;
    read.add(binding);
    work.push(binding);
  };

  for (const binding of kept) mark(binding);
  for (const entry of graph.resolved.modules) {
    for (const reference of entry.module.references) {
      const binding = reference.binding;
      if (binding == null) continue;
      if (inFunction(entry.module, reference) || inImportedDefault(entry.module, reference, imported)) {
        mark(importedDefinition(binding) ?? binding);
      }
    }
  }

  // What a kept binding's derivation reads, it refreshes through.
  for (let index = 0; index < work.length; index++) {
    const node = graph.bindings.get(work[index]!);
    for (const edge of node?.reads ?? []) {
      const target = edge.target.binding;
      if (target != null) mark(importedDefinition(target) ?? target);
    }
  }

  return (node) => read.has(node.binding);
}

/** Whether the reference runs later than its module's top level: in a function or class body. */
function inFunction(module: Module, reference: Reference): boolean {
  for (const ancestor of module.ancestors(reference.node)) {
    if (is.Function(ancestor) || is.ClassBody(ancestor)) return true;
  }
  return false;
}

/** Inside `export default <expression>` of a module some compiled module imports. */
function inImportedDefault(module: Module, reference: Reference, imported: ReadonlySet<Module>): boolean {
  if (!imported.has(module)) return false;
  for (const ancestor of module.ancestors(reference.node)) {
    if (is.ExportDefaultDeclaration(ancestor)) return true;
  }
  return false;
}

/** The modules another compiled module imports from. */
function importedModules(graph: SemanticGraph): ReadonlySet<Module> {
  const modules = new Set<Module>();
  for (const entry of graph.resolved.modules) {
    for (const declaration of entry.module.imports) {
      if (declaration.resolvedModule != null) modules.add(declaration.resolvedModule);
    }
  }
  return modules;
}
