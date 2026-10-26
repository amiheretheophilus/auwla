/** Lifecycle calls are recognized by binding; native control flow owns activation. */
import { findAll, is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import type { SemanticGraph } from '../../core/graph';
import type { InputQueries } from '../../core/graph/inputs';
import type { LifecycleCallPlan, EffectGroupPlan } from '../../core/plan/model';
import { runnerOf, type Binding, type Module, type ResolvedModule } from '../../core/resolve';
import { functionValue, type FunctionNode } from '../../core/resolve/functions';

export function lifecycleKind(module: Module, node: Node): '$effect' | '$cleanup' | null {
  if (!is.CallExpression(node) || !is.Identifier(node.callee)) return null;
  if (node.callee.name !== '$effect' && node.callee.name !== '$cleanup') return null;
  return module.referenceOf(node.callee)?.binding == null ? node.callee.name : null;
}

export function planEffects(graph: SemanticGraph, queries: InputQueries, entry: ResolvedModule, components: ReadonlySet<Node>) {
  const module = entry.module;
  const calls: LifecycleCallPlan[] = [];
  for (const call of module.findAll('CallExpression')) {
    const kind = lifecycleKind(module, call);
    if (kind === null) continue;
    const owner = [...module.ancestors(call)].find((ancestor) => components.has(ancestor)) as FunctionNode | undefined;
    const callback = call.arguments[0];
    const inputs: Expression[] = [];
    // Literal callbacks share the registration's lexical scope. Other callable
    // values report executed captures through the ordinary escaping-function path.
    if (kind === '$effect' && callback !== undefined && is.Function(callback) && callback.body !== null) {
      const seen = new Set<Binding>();
      for (const read of queries.inputsOf(module, callback.body).reads) {
        const binding = read.binding ?? read.reference.binding;
        if (binding === null || seen.has(binding) || !graph.bindings.has(binding)) continue;
        if (runnerOf(module, read.reference.node) !== callback) continue;
        if (binding.declarations.some((name) => name.start >= callback.start && name.end <= callback.end)) continue;
        seen.add(binding);
        inputs.push(read.reference.node as Expression);
      }
    }
    calls.push({ call, kind, owner: owner ?? null, inputs });
  }

  const summaries = new Map(graph.functions.map((summary) => [summary.fn, summary]));
  const containsEffect = (fn: FunctionNode, visited: Set<Node>): boolean => {
    if (visited.has(fn)) return false;
    visited.add(fn);
    const summary = summaries.get(fn);
    if (summary === undefined) return false;
    return summary.calls.some((call) => {
      if (lifecycleKind(summary.module, call) === '$effect') return true;
      const callee = functionValue(summary.module, call.callee);
      return callee !== null && !components.has(callee) && containsEffect(callee, visited);
    });
  };
  const groups: EffectGroupPlan[] = [];
  const planned = new Set<Node>();
  const moduleFunctions = new Set(module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']));
  for (const owner of [null, ...components]) {
    if (owner !== null && (!is.Function(owner) || !is.BlockStatement(owner.body))) continue;
    if (owner !== null && !moduleFunctions.has(owner as FunctionNode)) continue;
    const body = owner === null ? module.ast.body : (owner.body as Extract<Node, { type: 'BlockStatement' }>).body;
    const returns = (node: Node) => findAll(node, 'ReturnStatement').some((returned) => runnerOf(module, returned) === owner);
    for (const statement of body) {
      const declaration = is.ExportNamedDeclaration(statement) ? statement.declaration : statement;
      const roots = is.VariableDeclaration(declaration)
        ? declaration.declarations.flatMap((declarator) => declarator.init === null ? [] : [declarator.init])
        : [statement];
      for (const root of roots) {
        const registrations = findAll(root, 'CallExpression').filter((call) => {
          if (runnerOf(module, call) !== owner) return false;
          if (lifecycleKind(module, call) === '$effect') return true;
          const callee = functionValue(module, call.callee);
          return callee !== null && !components.has(callee) && containsEffect(callee, new Set());
        });
        if (registrations.length === 0) continue;
        // A component return must stay in its selector, not be moved into a
        // watch callback. Only wrap the registration's non-returning substatement.
        const activationRoots = returns(root) ? registrations.map((call) => {
          let selected: Node = call;
          for (const ancestor of module.ancestors(call)) {
            if (ancestor === root || is.Function(ancestor) || returns(ancestor)) break;
            if (is.Statement(ancestor)) selected = ancestor;
          }
          return selected;
        }) : [root];
        for (const activation of activationRoots) {
          if (planned.has(activation)) continue;
          planned.add(activation);
          const reads = queries.inputsOf(module, activation).reads.flatMap((read) => {
            const binding = read.binding ?? read.reference.binding;
            const target = binding === null ? undefined : graph.bindings.get(binding);
            return target === undefined ? [] : [{ node: read.reference.node, binding: target }];
          });
          groups.push({ owner: owner as FunctionNode | null, root: activation, reads });
        }
      }
    }
  }
  return { calls, groups };
}
