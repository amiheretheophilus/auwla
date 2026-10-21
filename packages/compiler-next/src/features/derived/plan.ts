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
    if (!targets.some((target) => target.kind === 'Derived' || target.kind === 'Opaque' || target.initial?.builders.some((builder) => builder.certainty === 'possible'))) continue;
    const first = targets[0]!;
    const module = first.binding.module;
    const builders = new Set<Statement | VariableDeclarator>();
    const builderTargets = new Map<Node, Set<BindingNode>>();
    const possibleBuilders = new Map<Node, Set<BindingNode>>();
    const addBuilder = (node: Statement | VariableDeclarator, target: BindingNode) => {
      builders.add(node);
      const outputs = builderTargets.get(node) ?? new Set<BindingNode>();
      outputs.add(target);
      builderTargets.set(node, outputs);
    };
    for (const target of targets) {
      for (const builder of target.initial?.builders ?? []) {
        if (builder.certainty !== 'definite') {
          if (!is.VariableDeclaration(builder.statement)) {
            const outputs = possibleBuilders.get(builder.statement) ?? new Set<BindingNode>();
            outputs.add(target);
            possibleBuilders.set(builder.statement, outputs);
          }
          continue;
        }
        if (is.VariableDeclaration(builder.statement)) {
          // A declaration can also build an earlier binding: `const b = a += n`.
          // Share that declarator's step instead of redeclaring b during replay.
          for (const entry of builder.statement.declarations) {
            if (entry.init === null) continue;
            const invoked = queries.inputsOf(module, entry.init).writes;
            const writesTarget = target.writes.some(({ site }) => {
              return (site.node.start >= entry.start && site.node.end <= entry.end) || invoked.includes(site);
            });
            if (writesTarget) addBuilder(entry, target);
          }
        } else {
          addBuilder(builder.statement as Statement, target);
        }
      }
    }
    const inputs = new Set<BindingNode>();
    const roots: Node[] = [declarator.id, ...builders];
    if (declarator.init !== null) roots.unshift(declarator.init);
    const intrinsic = roots.some((root) => queries.inputsOf(module, root).reads.some((read) => {
      const binding = read.binding ?? read.reference.binding;
      const dependency = binding === null ? undefined : graph.bindings.get(binding);
      return dependency !== undefined && !targets.includes(dependency)
        && (dependency.writes.length > 0 || dependency.kind === 'Derived');
    }));
    roots.push(...possibleBuilders.keys());
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
      intrinsic,
      declaration: module.parentOf(declarator) as VariableDeclaration,
      declarator, targets, inputs: [...inputs],
      builders: [...builders].sort((left, right) => left.start - right.start),
      builderTargets: new Map([...builderTargets].map(([node, outputs]) => [node, [...outputs]])),
      possibleBuilders: new Map([...possibleBuilders].map(([node, outputs]) => [node, [...outputs]])),
    };
    const owner = first.owner.runner!;
    const list = owners.get(owner) ?? [];
    list.push(memo);
    owners.set(owner, list);
  }
  return new Map([...owners].map(([owner, memos]) => [owner, groupMemos(memos, queries)]));
}

interface Group {
  computations: MemoPlan[];
  steps: Set<Statement | VariableDeclarator>;
}

/** A shared statement is indivisible: reset its outputs and replay it once. */
function groupMemos(memos: readonly MemoPlan[], queries: InputQueries): MemoGroupPlan[] {
  const groups: Group[] = [];
  for (const memo of memos) {
    const group: Group = { computations: [memo], steps: new Set([memo.declarator, ...memo.builders, ...memo.possibleBuilders.keys()] as (Statement | VariableDeclarator)[]) };
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
    for (const memo of group.computations) {
      for (const input of memo.inputs) {
        if (owners.get(input) !== group) inputs.add(input);
      }
    }
    const upstream = [...inputs].flatMap((binding) => {
      const owner = owners.get(binding);
      return owner === undefined ? [] : [{ group: groups.indexOf(owner), binding }];
    });
    const outputs = new Map<Node, Set<BindingNode>>();
    const possibleOutputs = new Map<Node, Set<BindingNode>>();
    for (const memo of group.computations) {
      for (const step of [memo.declarator, ...memo.builders]) {
        const targets = outputs.get(step) ?? new Set<BindingNode>();
        const written = step === memo.declarator ? memo.targets : memo.builderTargets.get(step)!;
        for (const target of written) targets.add(target);
        outputs.set(step, targets);
      }
      for (const [step, written] of memo.possibleBuilders) {
        const targets = outputs.get(step) ?? new Set<BindingNode>();
        const possible = possibleOutputs.get(step) ?? new Set<BindingNode>();
        for (const target of written) { targets.add(target); possible.add(target); }
        outputs.set(step, targets);
        possibleOutputs.set(step, possible);
      }
    }
    return {
      dynamic: [...group.steps].some((step) => queries.inputsOf(group.computations[0]!.targets[0]!.binding.module, step).opaque),
      computations: group.computations,
      inputs: [...inputs],
      upstream,
      steps: [...group.steps].sort((left, right) => left.start - right.start),
      outputs: new Map([...outputs].map(([step, targets]) => [step, [...targets]])),
      possibleOutputs: new Map([...possibleOutputs].map(([step, targets]) => [step, [...targets]])),
    };
  });
}
