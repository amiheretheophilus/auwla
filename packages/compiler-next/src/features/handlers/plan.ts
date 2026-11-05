/** Group actual assignment operations by the analyzer bindings they write. */
import type { Binding } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { runnerOf, type ResolvedModule } from '../../core/resolve';
import type { MutationPlan, WritePlan } from '../../core/plan/model';
import { unwrap } from '../../core/plan/jsx';
import { containsJsx } from '../../core/plan/template';
import { variableDeclaration } from '../../core/graph/inputs';
import { frameworkPackage, isValueImport } from '../../core/resolve/exports';
import { callOnlyReads } from '../../optimize/effects';
import { methodFact } from '../../optimize/method-facts';

export function planReadonlyBindings(bindings: readonly BindingNode[]): readonly BindingNode[] {
  return bindings.filter((target) => {
    const declarator = variableDeclaration(target.binding);
    if (declarator === null) return false;
    const declaration = target.binding.module.parentOf(declarator);
    return is.VariableDeclaration(declaration) && declaration.kind === 'const';
  });
}

export function planWrites(bindings: readonly BindingNode[]): readonly WritePlan[] {
  const operations = new Map<Node, Set<BindingNode>>();
  for (const binding of bindings) {
    for (const { site } of binding.writes) {
      if (site.kind !== 'assign' && site.kind !== 'update') continue;
      const node = site.node;
      if (!is.AssignmentExpression(node) && !is.UpdateExpression(node)
        && !is.ForOfStatement(node) && !is.ForInStatement(node)) continue;
      const targets = operations.get(node) ?? new Set<BindingNode>();
      targets.add(binding);
      operations.set(node, targets);
    }
  }
  return [...operations].map(([operation, targets]) => ({ operation, targets: [...targets] }));
}

export function planMutations(bindings: readonly BindingNode[]): readonly MutationPlan[] {
  const operations = new Map<Node, { kind: 'store' | 'delete' | 'call'; targets: { binding: BindingNode; member: Node }[] }>();
  for (const binding of bindings) {
    const module = binding.binding.module;
    for (const { site } of binding.writes) {
      if (site.kind === 'assign' || site.kind === 'update') continue;
      let member: Node = site.reference.node;
      for (const parent of module.ancestors(member)) {
        if (parent === site.node) break;
        if (is.MemberExpression(parent)) member = parent;
      }
      const kind = site.kind === 'call' || site.kind === 'argument' ? 'call' : site.kind === 'delete' ? 'delete' : 'store';
      const entry = operations.get(site.node) ?? { kind, targets: [] };
      if (!entry.targets.some((target) => target.binding === binding)) entry.targets.push({ binding, member });
      operations.set(site.node, entry);
    }
  }
  return [...operations].map(([operation, entry]) => ({ operation, ...entry }));
}

/** A new value, which nothing else holds while it is only read, stored into or returned. */
function isFreshLocal(binding: Binding): boolean {
  const module = binding.module;
  const name = binding.declarations[0];
  const declarator = name === undefined ? null : module.parentOf(name);
  if (!is.VariableDeclarator(declarator) || declarator.init === null) return false;

  const init = unwrap(declarator.init);
  const allocates = is.ArrayExpression(init) || is.ObjectExpression(init) || is.NewExpression(init)
    || (is.CallExpression(init) && is.MemberExpression(init.callee) && !init.callee.computed
      && is.Identifier(init.callee.property) && methodFact(init.callee.property.name)?.kind === 'copy');
  if (!allocates) return false;

  return binding.references.every((reference) => {
    if (reference.inTypePosition) return true;
    const parent = module.parentOf(reference.node);
    return is.ReturnStatement(parent) || (is.MemberExpression(parent) && parent.object === reference.node);
  });
}

/**
 * `const row = rows[0]; row.label = 'b'`, or a row's own `item.done = true`. These
 * names are not state, but what they hold can be: such an edit reports through the
 * alias index, which finds the state holding the object, as an imported value's does.
 *
 * Not included: a value the function just allocated, which nothing else holds yet;
 * a plain function's parameter, whose caller observes the call; and a handler's own
 * parameter, the event.
 */
function aliasBindings(graph: SemanticGraph, entry: ResolvedModule, tracked: ReadonlySet<BindingNode>): readonly BindingNode[] {
  const module = entry.module;
  const aliases: BindingNode[] = [];

  for (const binding of module.bindings) {
    const node = graph.bindings.get(binding);
    if (node === undefined || tracked.has(node) || node.writes.length === 0 || node.kind === 'Prop') continue;
    if (isValueImport(binding) || isFreshLocal(binding)) continue;

    const name = binding.declarations[0];
    const parent = name === undefined ? null : module.parentOf(name);
    if (is.VariableDeclarator(parent) || (is.Function(parent) && containsJsx(parent))) aliases.push(node);
  }
  return aliases;
}

/** The name a chain through a call starts from: `held` in `held.get('a').label`. Null without a call. */
function callChainRoot(module: ResolvedModule['module'], graph: SemanticGraph, object: Node): BindingNode | null {
  let root = unwrap(object);
  let throughCall = false;
  while (is.MemberExpression(root) || is.CallExpression(root)) {
    if (is.CallExpression(root)) {
      throughCall = true;
      root = unwrap(root.callee);
    } else {
      root = unwrap(root.object);
    }
  }
  if (!throughCall || !is.Identifier(root)) return null;
  const binding = module.referenceOf(root)?.binding;
  return binding === null || binding === undefined ? null : graph.bindings.get(binding) ?? null;
}

/**
 * `first().label = 'b'`, `first().count++`, `delete first().label`,
 * `first().tags.push(1)`: an edit with no name to hold what it edits.
 */
function planCallRootedEdits(graph: SemanticGraph, entry: ResolvedModule, owners: ReadonlySet<Node | null>): readonly MutationPlan[] {
  const module = entry.module;
  const plans: MutationPlan[] = [];

  const plan = (operation: Node, target: Node, kind: MutationPlan['kind']): void => {
    if (owners.has(runnerOf(module, operation))) return;
    const member = unwrap(target);
    if (!is.MemberExpression(member)) return;
    const root = callChainRoot(module, graph, member.object);
    if (root !== null) plans.push({ operation, kind, targets: [{ binding: root, member }], chained: kind === 'call' });
  };

  for (const assignment of module.findAll('AssignmentExpression')) plan(assignment, assignment.left, 'store');
  for (const update of module.findAll('UpdateExpression')) plan(update, update.argument, 'store');
  for (const unary of module.findAll('UnaryExpression')) {
    if (unary.operator === 'delete') plan(unary, unary.argument, 'delete');
  }
  for (const call of module.findAll('CallExpression')) {
    // `list.find(…)` is the chain, not an edit: a known read keeps it a plain call.
    if (is.MemberExpression(unwrap(call.callee)) && !callOnlyReads(module, call)) plan(call, call.callee, 'call');
  }
  return plans;
}

/**
 * Imports are immutable bindings, but their values can still be mutated. So can
 * what other names hold, and neither has a version of its own to bump.
 */
export function planImportedMutations(
  graph: SemanticGraph,
  entry: ResolvedModule,
  owners: ReadonlySet<Node | null>,
  /** State a component or module owner already reports through its own version. */
  tracked: ReadonlySet<BindingNode>,
): ReadonlyMap<Node | null, readonly MutationPlan[]> {
  const bindings = entry.module.imports.flatMap((imported) => {
    const binding = imported.local === null ? undefined : graph.bindings.get(imported.local);
    return imported.typeOnly || binding === undefined ? [] : [binding];
  });
  const grouped = new Map<Node | null, MutationPlan[]>();
  const planned = [
    ...planMutations(bindings),
    ...planMutations(aliasBindings(graph, entry, tracked)),
    ...planCallRootedEdits(graph, entry, owners),
  ];

  for (const mutation of planned) {
    // A framework call (`mount('root', App)`) never edits the values it receives.
    if (is.CallExpression(mutation.operation) && frameworkCall(entry, mutation.operation)) {
      continue;
    }

    let owner: Node | null = null;
    for (const ancestor of entry.module.ancestors(mutation.operation)) {
      if (owners.has(ancestor)) {
        owner = ancestor;
        break;
      }
    }
    const plans = grouped.get(owner) ?? [];
    plans.push(mutation);
    grouped.set(owner, plans);
  }
  return grouped;
}

function frameworkCall(entry: ResolvedModule, call: Extract<Node, { type: 'CallExpression' }>): boolean {
  const binding = is.Identifier(call.callee) ? entry.module.referenceOf(call.callee)?.binding ?? null : null;
  return binding !== null && frameworkPackage(binding) !== null;
}

/** One observer per operation, even when it receives both local and imported values. */
export function mergeMutations(
  local: readonly MutationPlan[],
  imported: readonly MutationPlan[],
): readonly MutationPlan[] {
  if (imported.length === 0) {
    return local;
  }
  const operations = new Map(local.map((plan) => [plan.operation, plan]));

  for (const plan of imported) {
    const existing = operations.get(plan.operation);
    if (existing === undefined) {
      operations.set(plan.operation, plan);
      continue;
    }
    const targets = [...existing.targets];
    for (const target of plan.targets) {
      if (!targets.some((candidate) => candidate.binding === target.binding)) {
        targets.push(target);
      }
    }
    operations.set(plan.operation, { ...existing, targets });
  }
  return [...operations.values()];
}
