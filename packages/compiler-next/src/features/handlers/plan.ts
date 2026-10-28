/** Group actual assignment operations by the analyzer bindings they write. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import type { ResolvedModule } from '../../core/resolve';
import type { MutationPlan, WritePlan } from '../../core/plan/model';
import { variableDeclaration } from '../../core/graph/inputs';
import { frameworkPackage } from '../../core/resolve/exports';

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

/** Imports are immutable bindings, but their values can still be mutated. */
export function planImportedMutations(
  graph: SemanticGraph,
  entry: ResolvedModule,
  owners: ReadonlySet<Node | null>,
): ReadonlyMap<Node | null, readonly MutationPlan[]> {
  const bindings = entry.module.imports.flatMap((imported) => {
    const binding = imported.local === null ? undefined : graph.bindings.get(imported.local);
    return imported.typeOnly || binding === undefined ? [] : [binding];
  });
  const grouped = new Map<Node | null, MutationPlan[]>();

  for (const mutation of planMutations(bindings)) {
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
