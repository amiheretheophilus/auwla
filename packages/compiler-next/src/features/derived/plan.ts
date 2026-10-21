/** Native declarations and definite body builders, retaining their source order. */
import { is } from 'yuku-ast';
import type { Node, Statement, VariableDeclaration, VariableDeclarator } from 'yuku-parser';
import type { BindingNode, SemanticGraph } from '../../core/graph';
import { variableDeclaration, type InputQueries } from '../../core/graph/inputs';
import type { MemoGroupPlan, MemoPlan } from '../../core/plan/model';

export function planMemos(
  graph: SemanticGraph, queries: InputQueries, components: ReadonlySet<Node>,
): ReadonlyMap<Node, readonly MemoGroupPlan[]> {
  const declarations = new Map<VariableDeclarator, BindingNode[]>();
  for (const node of graph.bindings.values()) {
    const owner = node.owner.runner;
    if (owner === null || !components.has(owner) || !is.Function(owner)) continue;
    const declarator = variableDeclaration(node.binding);
    if (declarator === null) continue;
    const declaration = node.binding.module.parentOf(declarator);
    if (!is.VariableDeclaration(declaration) || node.binding.module.parentOf(declaration) !== owner.body) continue;
    const targets = declarations.get(declarator) ?? [];
    targets.push(node);
    declarations.set(declarator, targets);
  }

  const owners = new Map<Node, MemoPlan[]>();
  for (const [declarator, targets] of declarations) {
    if (!targets.some((target) => target.kind === 'Derived')) continue;
    const first = targets[0]!;
    const module = first.binding.module;
    const builders = new Set<Statement | VariableDeclarator>();
    for (const target of targets) {
      for (const builder of target.initial?.builders ?? []) {
        if (builder.certainty !== 'definite') continue;
        if (is.VariableDeclaration(builder.statement)) {
          // A declaration can also build an earlier binding: `const b = a += n`.
          // Share that declarator's step instead of redeclaring b during replay.
          for (const entry of builder.statement.declarations) {
            if (entry.init === null) continue;
            const invoked = queries.inputsOf(module, entry.init).writes;
            const writesTarget = target.writes.some(({ site }) => {
              return (site.node.start >= entry.start && site.node.end <= entry.end) || invoked.includes(site);
            });
            if (writesTarget) builders.add(entry);
          }
        } else {
          builders.add(builder.statement as Statement);
        }
      }
    }
    const inputs = new Set<BindingNode>();
    const roots: Node[] = [declarator.id, ...builders];
    if (declarator.init !== null) roots.unshift(declarator.init);
    for (const root of roots) {
      for (const read of queries.inputsOf(module, root).reads) {
        const binding = read.binding ?? read.reference.binding;
        const dependency = binding === null ? undefined : graph.bindings.get(binding);
        if (dependency === undefined || targets.includes(dependency)) continue;
        if (dependency.binding.declarations.some((name) => name.start >= root.start && name.end <= root.end)) continue;
        inputs.add(dependency);
      }
    }
    const memo: MemoPlan = {
      declaration: module.parentOf(declarator) as VariableDeclaration,
      declarator, targets, inputs: [...inputs],
      builders: [...builders].sort((left, right) => left.start - right.start),
    };
    const owner = first.owner.runner!;
    const list = owners.get(owner) ?? [];
    list.push(memo);
    owners.set(owner, list);
  }
  return new Map([...owners].map(([owner, memos]) => [owner, groupMemos(memos)]));
}

interface Group {
  computations: MemoPlan[];
  steps: Set<Statement | VariableDeclarator>;
}

/** A shared statement is indivisible: reset its outputs and replay it once. */
function groupMemos(memos: readonly MemoPlan[]): MemoGroupPlan[] {
  const groups: Group[] = [];
  for (const memo of memos) {
    const group: Group = { computations: [memo], steps: new Set([memo.declarator, ...memo.builders]) };
    for (let index = 0; index < groups.length;) {
      const other = groups[index]!;
      if (![...other.steps].some((step) => group.steps.has(step))) {
        index++;
        continue;
      }
      group.computations.push(...other.computations);
      for (const step of other.steps) group.steps.add(step);
      groups.splice(index, 1);
      // The enlarged group may now connect to one previously visited.
      index = 0;
    }
    groups.push(group);
  }
  const owners = new Map<BindingNode, Group>();
  for (const group of groups) {
    for (const memo of group.computations) {
      for (const target of memo.targets) owners.set(target, group);
    }
  }
  return groups.map((group) => {
    const inputs = new Set<BindingNode>();
    const visited = new Set<Group>();
    const collect = (current: Group) => {
      if (visited.has(current)) return;
      visited.add(current);
      for (const memo of current.computations) {
        for (const input of memo.inputs) {
          const owner = owners.get(input);
          if (owner === group) continue;
          inputs.add(input);
          // A builder can read a memo declared after its accumulator. Include
          // that memo's inputs so replay resets the accumulator before either
          // of them runs. Sites still need only the direct output versions.
          if (owner !== undefined) collect(owner);
        }
      }
    };
    collect(group);
    return {
      computations: group.computations,
      inputs: [...inputs],
      steps: [...group.steps].sort((left, right) => left.start - right.start),
    };
  });
}
