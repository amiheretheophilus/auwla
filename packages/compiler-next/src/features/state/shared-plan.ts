/** Shared native bindings belong to a module or a particular factory invocation. */
import { b, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { variableDeclaration } from '../../core/graph/inputs';
import { importedDefinition, isParameter, namespaceModule, openNamespaces, runnerOf } from '../../core/resolve';
import type { SharedReadPlan } from '../../core/plan/model';
import { storageOwner } from '../../core/plan/storage';
import type { PlainFunctionValues } from '../../core/plan/plain-functions';
import { primitiveConstants } from './primitive-constants';
import { reactivelyRead } from './reactive-reads';

export function planSharedReads(
  graph: SemanticGraph,
  components: ReadonlySet<Node>,
  plain: PlainFunctionValues,
): ReadonlyMap<BindingNode, SharedReadPlan> {
  const reads = new Map<BindingNode, SharedReadPlan>();
  const namespaceBindings = new Set<BindingNode['binding']>();
  const namespaces = new Set(openNamespaces(graph.resolved));
  const holdsPrimitive = primitiveConstants(graph);

  for (const entry of graph.resolved.modules) {
    for (const binding of entry.module.bindings) {
      const namespace = namespaceModule(binding);
      if (namespace !== null) namespaces.add(namespace);
    }
  }

  for (const namespace of namespaces) {
    for (const name of namespace.exportedNames()) {
      const definition = namespace.resolveExport(name)?.binding;
      if (definition != null) {
        namespaceBindings.add(definition);
      }
    }
  }

  // Read only at modules' top levels, which run once, a binding needs no one to follow it.
  const followed = reactivelyRead(graph, namespaceBindings);

  for (const entry of graph.resolved.modules) {
    // A reader is exported, so its name also avoids every name the module exports, including
    // those `export * from` forwards: a local export would hide the forwarded one.
    const taken = new Set([
      ...entry.module.bindings.map((binding) => binding.name),
      ...entry.module.references.map((reference) => reference.name),
      ...entry.module.exportedNames(),
    ]);
    for (const binding of graph.bindings.values()) {
      if (binding.binding.module !== entry.module || importedDefinition(binding.binding) !== null) continue;
      if (plain.settled(binding)) continue;
      // A primitive nothing replaces cannot change, so nothing needs to follow it.
      if (holdsPrimitive(binding)) continue;
      if (!followed(binding)) continue;
      const owner = storageOwner(binding);
      if (owner !== null && (components.has(owner) || (!is.BlockStatement(owner) && (!is.Function(owner) || !is.BlockStatement(owner.body))))) continue;
      const declarator = variableDeclaration(binding.binding);
      if (declarator?.init !== null && declarator?.init !== undefined && components.has(declarator.init)) continue;
      const parent = entry.module.parentOf(binding.binding.declarations[0]!);
      // A parameter has no declaration of its own, and is state only once a later call
      // changes it: `function make(start) { return { set(v) { start = v; }, get: () => start }; }`.
      const laterParameter = isParameter(binding.binding) && owner !== null
        && binding.writes.some(({ site }) => site.runner !== binding.owner.runner);
      // A function with data on it, edited after it was set up (`run.calls++` in a handler).
      const editedFunction = is.FunctionDeclaration(parent) && binding.writes.some(({ site }) => site.runner !== binding.owner.runner);
      if (declarator === null && !is.Class(parent) && !laterParameter && !editedFunction) continue;
      if (owner !== null && !is.BlockStatement(owner) && !binding.binding.references.some((reference) => runnerOf(entry.module, reference.node) !== owner)) continue;
      // The same for a block in an ordinary function (`if (…) { const t = data[1]; … }`
      // in a handler): read only by the run that declared it, it is plain
      // JavaScript. A component's blocks keep versions; their locals feed markup.
      if (owner !== null && is.BlockStatement(owner)) {
        const runner = runnerOf(entry.module, owner);
        const sameRun = binding.binding.references.every((reference) => runnerOf(entry.module, reference.node) === runner);
        if (runner !== null && !components.has(runner) && sameRun) continue;
      }
      if (declarator !== null) {
        const declaration = entry.module.parentOf(declarator);
        let block = declaration === null ? null : entry.module.parentOf(declaration);
        if (is.ExportNamedDeclaration(block)) block = entry.module.parentOf(block);
        if (owner === null ? !is.Program(block) : block !== (is.BlockStatement(owner) ? owner : owner.body)) continue;
      }
      const base = `_read_${binding.binding.name}`;
      let name = base;
      for (let index = 2; taken.has(name); index++) name = `${base}${index}`;
      taken.add(name);

      let observer: string | undefined;
      if (owner === null && namespaceBindings.has(binding.binding)) {
        const base = `_observe_${binding.binding.name}`;
        observer = base;
        for (let index = 2; taken.has(observer); index++) {
          observer = `${base}${index}`;
        }
        taken.add(observer);
      }

      reads.set(binding, { binding, name, path: entry.path, observer });
    }
  }
  return reads;
}

export function sharedSetup(body: readonly Node[], planned: ReadonlySet<Node>): Statement[] {
  const setup: Statement[] = [];
  for (const node of body) {
    if (!is.ExportNamedDeclaration(node) || !is.VariableDeclaration(node.declaration)
      || !node.declaration.declarations.some((declaration) => planned.has(declaration))) {
      setup.push(node as Statement);
      continue;
    }
    setup.push(node.declaration);
    // Keep native live exports when memo storage is lowered from const to let.
    const names: Extract<Node, { type: 'Identifier' }>[] = [];
    const visit = (pattern: Node): void => {
      if (is.Identifier(pattern)) names.push(pattern);
      else if (is.ObjectPattern(pattern)) {
        for (const property of pattern.properties) visit(is.Property(property) ? property.value : property.argument);
      } else if (is.ArrayPattern(pattern)) {
        for (const element of pattern.elements) if (element !== null) visit(element);
      }
      else if (is.AssignmentPattern(pattern)) visit(pattern.left);
      else if (is.RestElement(pattern)) visit(pattern.argument);
    };
    for (const declaration of node.declaration.declarations) visit(declaration.id);
    setup.push(b.ExportNamedDeclaration({
      declaration: null, source: null, attributes: [], exportKind: 'value',
      specifiers: names.map((name) => b.ExportSpecifier({ local: name, exported: name, exportKind: 'value' })),
    }) as unknown as Statement);
  }
  return setup;
}
