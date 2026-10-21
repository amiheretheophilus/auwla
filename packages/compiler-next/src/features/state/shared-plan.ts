/** Shared native bindings belong to a module or a particular factory invocation. */
import { b, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { variableDeclaration } from '../../core/graph/inputs';
import { importedDefinition, runnerOf } from '../../core/resolve';
import type { SharedReadPlan } from '../../core/plan/model';
import { storageOwner } from '../../core/plan/storage';

export function planSharedReads(graph: SemanticGraph, components: ReadonlySet<Node>): ReadonlyMap<BindingNode, SharedReadPlan> {
  const reads = new Map<BindingNode, SharedReadPlan>();
  for (const entry of graph.resolved.modules) {
    const taken = new Set([...entry.module.bindings.map((binding) => binding.name), ...entry.module.references.map((reference) => reference.name)]);
    for (const binding of graph.bindings.values()) {
      if (binding.binding.module !== entry.module || importedDefinition(binding.binding) !== null) continue;
      const owner = storageOwner(binding);
      if (owner !== null && (components.has(owner) || (!is.BlockStatement(owner) && (!is.Function(owner) || !is.BlockStatement(owner.body))))) continue;
      const declarator = variableDeclaration(binding.binding);
      if (declarator?.init !== null && declarator?.init !== undefined && components.has(declarator.init)) continue;
      const parent = entry.module.parentOf(binding.binding.declarations[0]!);
      if (declarator === null && !is.Class(parent)) continue;
      if (owner !== null && !is.BlockStatement(owner) && !binding.binding.references.some((reference) => runnerOf(entry.module, reference.node) !== owner)) continue;
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
      reads.set(binding, { binding, name, path: entry.path });
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
