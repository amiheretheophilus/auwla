/** Version-checked native computations, replayed in their authored order. */
import { b, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../../core/graph';
import type { ComponentPlan, MemoGroupPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement } from '../../core/emit/quote';

export function emitMemos(
  plan: ComponentPlan, versions: ReadonlyMap<BindingNode, string>, names: Names,
  mountReplacements: ReadonlyMap<Node, Node>, replayReplacements: ReadonlyMap<Node, Node>,
) {
  const setup: Statement[] = [];
  const snapshots: Statement[] = [];
  const checks: Statement[] = [];
  const finish: Statement[] = [];
  const steps = new Map<Node, { group: MemoGroupPlan; body: Statement[] }>();
  const dirty = new Map<MemoGroupPlan, string>();

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
    const condition = conditions.reduce((left, right) => b.LogicalExpression({ operator: '||', left, right }), expression('false'));
    checks.push(statement('const $$changed = $$condition;', { changed, condition }));
    for (const memo of group.computations) {
      const declarator = copy(memo.declarator, replayReplacements);
      const value = declarator.init ?? expression('void 0');
      const assign = statement('($$target = $$value);', { target: declarator.id, value });
      const body = [assign];
      for (const target of memo.targets) {
        body.push(statement('$$version++;', { version: versions.get(target)! }));
      }
      steps.set(memo.declarator, { group, body });
    }
    for (const builder of group.steps) {
      if (is.VariableDeclarator(builder)) continue;
      steps.set(builder, { group, body: [copy(builder, replayReplacements) as Statement] });
    }
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
  const replay = [...steps].sort(([left], [right]) => left.start - right.start).map(([, step]) => {
    return b.IfStatement({
      test: b.Identifier({ name: dirty.get(step.group)! }),
      consequent: b.BlockStatement({ body: step.body }), alternate: null,
    });
  });
  return { setup, snapshots, update: [...checks, ...replay, ...finish] };
}
