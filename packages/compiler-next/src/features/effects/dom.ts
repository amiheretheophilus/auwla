/** Compose lifecycle calls and their activation roots on a fresh syntax tree. */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { EffectGroupPlan, ModulePlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, statement, stringLiteral } from '../../core/emit/quote';

export function emitLifecycleCalls(plan: ModulePlan, names: Names, runtime: string) {
  const replacements = new Map<Node, Node>();
  const moduleOwner = stringLiteral(`mmd:effects:${plan.module.path}`);
  for (const { call, kind, inputs, owner } of plan.effects.calls) {
    const parent = owner === null ? moduleOwner : expression('$$id', { id: names.of(owner, '_id') });
    const args = b.ArrayExpression({ elements: call.arguments });
    replacements.set(call, kind === '$cleanup'
      ? expression('$$runtime.ownedCleanup($$args, $$parent)', { runtime, args, parent })
      : expression('$$runtime.ownedEffect($$site, $$args, () => $$inputs, $$parent)', {
        runtime, site: stringLiteral(`${plan.module.path}:${call.start}`), args, parent,
        inputs: b.ArrayExpression({ elements: [...inputs] }),
      }));
  }
  return replacements;
}

export function emitEffectGroups(
  groups: readonly EffectGroupPlan[], scope: string, owner: string | Node,
  names: Names, runtime: string, initial: ReadonlyMap<Node, Node>,
  deferred: ReadonlyMap<Statement, number> = new Map(),
  setup: readonly Statement[] = [],
) {
  const replacements = new Map(initial);
  const declarations: Statement[] = [];
  const conditional = groups.flatMap((group, index) => {
    const contains = (statement: Statement) => group.root.start >= statement.start && group.root.end <= statement.end;
    return [...deferred.keys()].some(contains) || (setup.length > 0 && !setup.some(contains)) ? [index] : [];
  });
  const effects = names.fresh('_effects');
  const reach = (statements: readonly Statement[]) => conditional.filter((index) => {
    const root = groups[index]!.root;
    return statements.some((statement) => root.start >= statement.start && root.end <= statement.end);
  }).map((index) => statement('$$effects.reach($$index);', {
    effects, index: b.Literal({ value: index, raw: String(index) }),
  }));
  const select = (value: Expression): Expression => conditional.length === 0 ? value
    : expression('$$effects.select(() => $$value)', { effects, value });
  if (groups.length === 0) return { replacements, declarations, reach, select };
  declarations.push(statement('const $$effects = $$runtime.createEffectScope($$owner, $$conditional);', {
    effects, runtime, owner, conditional: b.ArrayExpression({ elements: conditional.map((index) => b.Literal({ value: index, raw: String(index) })) }),
  }));
  for (const [index, group] of groups.entries()) {
    const root = copy(group.root, initial);
    const callback = b.ArrowFunctionExpression({
      id: null, params: [], async: false, generator: false,
      expression: !is.Statement(root),
      body: is.Statement(root) ? b.BlockStatement({ body: [root] }) : root as Expression,
    });
    const call = expression('$$effects.watch($$index, $$callback, $$scope)', {
      effects, callback, scope, index: b.Literal({ value: index, raw: String(index) }),
    });
    replacements.set(group.root, is.Statement(root) ? b.ExpressionStatement({ expression: call, directive: null }) : call);
  }
  return { replacements, declarations, reach, select };
}
