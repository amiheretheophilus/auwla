/** Version-checked native computations, replayed in their authored order. */
import { b, is, walk } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { ComponentPlan, MemoGroupPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement } from '../../core/emit/quote';
import type { TakeoverEmit } from './takeover';

export function emitMemos(
  plan: ComponentPlan, versions: ReadonlyMap<BindingNode, string>, names: Names,
  mountReplacements: ReadonlyMap<Node, Node>, replayReplacements: ReadonlyMap<Node, Node>,
  takeovers: TakeoverEmit,
) {
  const setup: Statement[] = [];
  const snapshots: Statement[] = [];
  const checks: Statement[] = [];
  const finish: Statement[] = [];
  const steps = new Map<Node, { group: MemoGroupPlan; body: Statement[] }>();
  const dirty = new Map<MemoGroupPlan, string>();

  const active = (targets: readonly BindingNode[]): Expression => {
    const flags = targets.map((target) => takeovers.flags.get(target));
    if (flags.some((flag) => flag === undefined)) return expression('true');
    return flags.reduce<Expression>((left, flag) => {
      return b.LogicalExpression({ operator: '||', left, right: expression('!$$flag', { flag: flag! }) });
    }, expression('false'));
  };

  for (const group of plan.memos) {
    const changed = names.fresh('_recompute');
    dirty.set(group, changed);
    const conditions = [];
    for (const input of group.inputs) {
      const version = versions.get(input);
      if (version === undefined) continue;
      const seen = names.fresh('_from');
      snapshots.push(statement('let $$seen = $$version;', { seen, version }));
      conditions.push(expression('$$seen !== $$version', { seen, version }));
      finish.push(statement('$$seen = $$version;', { seen, version }));
    }
    for (const memo of group.computations) {
      for (const target of memo.targets) {
        const taken = takeovers.flags.get(target);
        if (taken === undefined) continue;
        const seen = names.fresh('_fromTaken');
        const version = versions.get(target)!;
        snapshots.push(statement('let $$seen = $$version;', { seen, version }));
        // A later override is now an external input for active siblings of a
        // shared builder, even though it was originally an internal output.
        conditions.push(expression('$$taken && $$seen !== $$version', { taken, seen, version }));
        finish.push(statement('$$seen = $$version;', { seen, version }));
      }
    }
    const condition = conditions.reduce((left, right) => b.LogicalExpression({ operator: '||', left, right }), expression('false'));
    checks.push(statement('let $$changed = $$condition;', { changed, condition }));
    for (const memo of group.computations) {
      const replacements = new Map(replayReplacements);
      for (const target of memo.targets) {
        const receiver = takeovers.targets.get(target);
        if (receiver === undefined) continue;
        for (const declaration of target.binding.declarations) replacements.set(declaration, receiver);
      }
      const declarator = copy(memo.declarator, replacements);
      walk(declarator.id, { Property(node) { if (node.shorthand) node.shorthand = false; } });
      const value = declarator.init ?? expression('void 0');
      const assign = statement('($$target = $$value);', { target: declarator.id, value });
      const body = [assign];
      for (const target of memo.targets) {
        if (takeovers.targets.has(target)) continue;
        body.push(statement('$$version++;', { version: versions.get(target)! }));
      }
      steps.set(memo.declarator, { group, body });
    }
    for (const builder of group.steps) {
      if (is.VariableDeclarator(builder)) continue;
      steps.set(builder, { group, body: [copy(builder, replayReplacements) as Statement] });
    }
  }

  // Settle pending recomputations before replay starts. This handles a loop
  // accumulator declared before its input, and cyclic builder groups, without
  // expanding transitive source reads into every memo. A taken binding cuts its
  // upstream edge: downstream calls then run only when its held value changes.
  const propagate = names.fresh('_propagate');
  const propagation: Statement[] = [];
  for (const group of plan.memos) {
    for (const dependency of group.upstream) {
      const changed = dirty.get(group)!;
      const upstream = dirty.get(plan.memos[dependency.group]!)!;
      propagation.push(statement(`if (!$$changed && $$upstream && $$active) {
        $$changed = true;
        $$propagate = true;
      }`, { changed, upstream, active: active([dependency.binding]), propagate }));
    }
  }
  if (propagation.length > 0) {
    checks.push(statement('let $$propagate = true;', { propagate }));
    checks.push(b.WhileStatement({
      test: b.Identifier({ name: propagate }),
      body: b.BlockStatement({ body: [statement('$$propagate = false;', { propagate }), ...propagation] }),
    }));
  }

  const planned = new Set(plan.memos.flatMap((group) => group.computations.map((memo) => memo.declarator)));
  for (const original of plan.setup) {
    if (!is.VariableDeclaration(original)) {
      setup.push(copy(original, mountReplacements));
      continue;
    }
    // Splitting a declaration preserves evaluation order and the enclosing
    // lexical scope, including TDZs and defaults referring to earlier names.
    for (const declarator of original.declarations) {
      const declaration = copy(original, mountReplacements);
      declaration.declarations = [copy(declarator, mountReplacements)];
      if (planned.has(declarator) && declaration.kind === 'const') declaration.kind = 'let';
      setup.push(declaration);
    }
  }
  const replay = [...steps].sort(([left], [right]) => left.start - right.start).map(([original, step]) => {
    return b.IfStatement({
      test: expression('$$changed && $$active', {
        changed: dirty.get(step.group)!, active: active(step.group.outputs.get(original)!),
      }),
      consequent: b.BlockStatement({ body: step.body }), alternate: null,
    });
  });
  return { setup, snapshots, update: [...checks, ...replay, ...finish] };
}
