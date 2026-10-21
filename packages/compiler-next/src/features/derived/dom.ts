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
  plan: Pick<ComponentPlan, 'setup' | 'memos'>, versions: ReadonlyMap<BindingNode, string>, names: Names,
  mountReplacements: ReadonlyMap<Node, Node>, replayReplacements: ReadonlyMap<Node, Node>,
  takeovers: TakeoverEmit,
  runtime: string,
  trackKeys: ReadonlyMap<BindingNode, string>,
  notify?: { readonly batch: string; readonly entity: string },
) {
  const setup: Statement[] = [];
  const snapshots: Statement[] = [];
  const checks: Statement[] = [];
  const finish: Statement[] = [];
  const steps = new Map<Node, { group: MemoGroupPlan; body: Statement[] }>();
  const dirty = new Map<MemoGroupPlan, string>();
  const tracking = new Map<MemoGroupPlan, string>();
  const observed = new Map<BindingNode, string>();
  const possibleFlags = new Map<Node, string>();
  const observationBefore = new Map<Node, Statement[]>();
  const observationAfter = new Map<Node, Statement[]>();
  for (const group of plan.memos) {
    for (const [step, targets] of group.possibleOutputs) {
      const used = names.fresh('_builderUsed');
      possibleFlags.set(step, used);
      setup.push(statement('let $$used = false;', { used }));
      const callbacks = targets.map((target) => {
        let enabled = observed.get(target);
        const intrinsic = group.computations.some((memo) => memo.targets.includes(target) && memo.intrinsic);
        if (enabled === undefined && !intrinsic) {
          enabled = names.fresh('_derives');
          observed.set(target, enabled);
          setup.push(statement('let $$enabled = false;', { enabled }));
        }
        return expression(enabled === undefined ? '() => { $$used = true; }' : '() => { $$used = true; $$enabled = true; }', { used, ...(enabled === undefined ? {} : { enabled }) });
      });
      const observation = names.fresh('_builderObservation');
      observationBefore.set(step, [statement('const $$observation = $$runtime.observeMutation($$reads, $$callbacks);', {
        observation, runtime,
        reads: b.ArrayExpression({ elements: targets.map((target) => expression('() => $$binding', { binding: target.binding.name })) }),
        callbacks: b.ArrayExpression({ elements: callbacks }),
      })]);
      observationAfter.set(step, [statement('$$observation.finish();', { observation })]);
    }
  }

  const active = (targets: readonly BindingNode[]): Expression => {
    return targets.reduce<Expression>((left, target) => {
      const flag = takeovers.flags.get(target);
      const enabled = observed.get(target);
      let right = flag === undefined ? expression('true') : expression('!$$flag', { flag });
      if (enabled !== undefined) right = expression('$$right && $$enabled', { right, enabled });
      return b.LogicalExpression({ operator: '||', left, right });
    }, expression('false'));
  };

  for (const group of plan.memos) {
    const changed = names.fresh('_recompute');
    dirty.set(group, changed);
    const conditions = [];
    if (group.dynamic) {
      const computation = names.fresh('_computation');
      tracking.set(group, computation);
      conditions.push(expression('$$computation.changed()', { computation }));
    }
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
        const enabled = observed.get(target);
        if (taken === undefined && enabled === undefined) continue;
        const seen = names.fresh('_fromTaken');
        const version = versions.get(target)!;
        snapshots.push(statement('let $$seen = $$version;', { seen, version }));
        // A later override is now an external input for active siblings of a
        // shared builder, even though it was originally an internal output.
        const external = taken === undefined ? expression('false') : expression('$$taken', { taken });
        const held = enabled === undefined ? external : expression('$$external || !$$enabled', { external, enabled });
        conditions.push(expression('($$held) && $$seen !== $$version', { held, seen, version }));
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
    const computation = tracking.get(group);
    if (computation === undefined) continue;
    for (const upstreamGroup of plan.memos) {
      if (upstreamGroup === group) continue;
      for (const memo of upstreamGroup.computations) {
        for (const target of memo.targets) {
          const key = trackKeys.get(target);
          if (key === undefined) continue;
          propagation.push(statement(`if (!$$changed && $$upstream && $$active && $$computation.dependsOn($$key)) {
            $$changed = true; $$propagate = true;
          }`, {
            changed: dirty.get(group)!, upstream: dirty.get(upstreamGroup)!,
            active: active([target]), computation, key, propagate,
          }));
        }
      }
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
  // Capture opaque dependencies across every source-ordered step of a group.
  // Each step enters the same collector; snapshots settle after the final step.
  const collectors = new Map<Node, { computation: string; first: boolean; last: boolean }[]>();
  for (const group of plan.memos) {
    const computation = tracking.get(group);
    if (computation === undefined) continue;
    for (const [index, step] of group.steps.entries()) {
      const list = collectors.get(step) ?? [];
      list.push({ computation, first: index === 0, last: index === group.steps.length - 1 });
      collectors.set(step, list);
    }
  }
  // Collectors are declared before any initializer uses them.
  for (const computation of tracking.values()) {
    setup.push(statement(notify === undefined
      ? 'const $$computation = $$runtime.createComputation();'
      : 'const $$computation = $$runtime.createComputation($$batch.mark, $$entity);', {
      computation, runtime, ...notify,
    }));
  }
  const before = (root: Node) => (collectors.get(root) ?? [])
    .map(({ computation, first }) => statement(`$$computation.begin(${first});`, { computation }));
  const after = (root: Node) => (collectors.get(root) ?? [])
    .map(({ computation, last }) => statement(`$$computation.end(${last});`, { computation }));
  for (const original of plan.setup) {
    if (!is.VariableDeclaration(original)) {
      setup.push(...before(original), ...(observationBefore.get(original) ?? []), copy(original, mountReplacements), ...(observationAfter.get(original) ?? []), ...after(original));
      continue;
    }
    // Splitting a declaration preserves evaluation order and the enclosing
    // lexical scope, including TDZs and defaults referring to earlier names.
    for (const declarator of original.declarations) {
      const declaration = copy(original, mountReplacements);
      declaration.declarations = [copy(declarator, mountReplacements)];
      if (planned.has(declarator) && declaration.kind === 'const') declaration.kind = 'let';
      setup.push(...before(declarator), declaration, ...after(declarator));
    }
  }
  const replay = [...steps].sort(([left], [right]) => left.start - right.start).map(([original, step]) => {
    const outputs = step.group.outputs.get(original)!;
    const possible = step.group.possibleOutputs.get(original) ?? [];
    const definite = outputs.filter((target) => !possible.includes(target));
    const eligible = possibleFlags.has(original)
      ? expression('$$definite || ($$used && $$possible)', {
        definite: active(definite), used: possibleFlags.get(original)!, possible: active(possible),
      }) : active(outputs);
    return b.IfStatement({
      test: expression('$$changed && $$active', {
        changed: dirty.get(step.group)!, active: eligible,
      }),
      consequent: b.BlockStatement({ body: [...before(original), ...step.body, ...after(original)] }), alternate: null,
    });
  });
  return { setup, snapshots, update: [...checks, ...replay, ...finish] };
}
