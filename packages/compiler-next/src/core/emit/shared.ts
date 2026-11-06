/** Compose shared storage and feature emission before replacing components. */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../graph';
import type { ModulePlan } from '../plan';
import { unwrap } from '../plan/jsx';
import type { Names } from './names';
import { copy } from './copy';
import { expression } from './quote';
import { emitSharedState, finishSharedOwner, type SharedOwnerEmit } from '../../features/state/shared-dom';
import { emitConstWrites } from '../../features/handlers/dom';
import { emitMutations } from '../../features/handlers/mutations';
import { emitMemos } from '../../features/derived/dom';
import { emitTakeovers } from '../../features/derived/takeover';
import { emitReceiverTargets } from '../../features/handlers/receivers';
import { emitWrites } from '../../features/handlers/dom';
import { emitRefs } from '../../features/refs/dom';
import { refWrites } from '../../features/refs/plan';
import { emitEffectGroups } from '../../features/effects/dom';
import { statement, stringLiteral } from './quote';
import { sourceBlockedSteps, sourceChanges, sourceReadinessStorage, sourceTakeovers } from '../../features/sources/flow-dom';

/**
 * `x = 1`, `x += 1` and `x++` run natively inside `_write_x(…)`, which keeps their
 * value and reports the write. A destructuring or `for…of` target has no single
 * expression to wrap, so its store goes through an accessor at the target.
 */
function emitSharedWrites(
  binding: BindingNode,
  owner: SharedOwnerEmit,
  names: Names,
  runtime: string,
  replacements: Map<Node, Node>,
  declarations: Map<SharedOwnerEmit, Statement[]>,
): void {
  const name = binding.binding.name;
  const version = owner.versions.get(binding)!;
  const key = owner.keys.get(binding)!;
  const { scope, batch } = owner;
  let helper: string | undefined;

  const helperName = (): string => {
    if (helper !== undefined) return helper;
    if (owner.simple) {
      // Nothing can write during a build: the notifier already does all of it.
      helper = owner.notifiers.get(binding)!;
      return helper;
    }
    helper = names.fresh(`_write_${name}`);
    const value = names.fresh('_value');
    const list = declarations.get(owner) ?? [];
    list.push(statement(`function $$helper($$value) {
      $$version++;
      if ($$scope.building()) $$runtime.noteOwnOutput($$key);
      else $$batch.mark($$key);
      return $$value;
    }`, { helper, value, version, scope, batch, key, runtime }));
    declarations.set(owner, list);
    return helper;
  };

  let assign: string | undefined;
  const assignName = (): string => {
    if (assign !== undefined) return assign;
    assign = names.fresh(`_assign_${name}`);
    // First: this may add its own declaration to the list.
    const helper = helperName();
    const list = declarations.get(owner) ?? [];
    list.push(statement(
      'function $$assign($$before, $$after) { return $$runtime.unchangedWrite($$before, $$after) ? $$after : $$helper($$after); }',
      { assign, before: names.fresh('_before'), after: names.fresh('_after'), helper, runtime },
    ));
    declarations.set(owner, list);
    return assign;
  };

  for (const { site } of binding.writes) {
    if (site.kind !== 'assign' && site.kind !== 'update') continue;

    const operation = site.node;
    // A pattern or loop target needs the accessor below.
    const target = is.AssignmentExpression(operation) ? operation.left
      : is.UpdateExpression(operation) ? operation.argument
        : null;

    if (target !== null && unwrap(target as Expression) === site.reference.node) {
      const written = copy(operation, replacements) as Extract<Node, { type: 'AssignmentExpression' }>;
      if (is.AssignmentExpression(written) && ['&&=', '||=', '??='].includes(written.operator)) {
        // The short circuit decides whether the store and its report happen at all.
        const operator = written.operator.slice(0, -1) as '&&' | '||' | '??';
        const left = copy(written.left) as Expression;
        written.operator = '=';
        replacements.set(operation, b.LogicalExpression({
          operator, left, right: expression('$$helper($$written)', { helper: helperName(), written }),
        }));
      } else if (is.AssignmentExpression(written) && site.timing === 'later') {
        // A write that changes nothing reports nothing (`wiki/decisions.md`, 2026-11-05).
        // In the body, reading the binding first would change what a dead zone does.
        replacements.set(operation, expression('$$assign($$before, $$written)', {
          assign: assignName(), before: b.Identifier({ name }), written,
        }));
      } else {
        replacements.set(operation, expression('$$helper($$written)', { helper: helperName(), written }));
      }
      continue;
    }

    const value = names.fresh('_assigned');
    replacements.set(site.reference.node, expression(`({
      get value() { return $$binding; },
      set value($$value) { $$binding = $$value; $$helper($$value); }
    }).value`, { binding: name, value, helper: helperName() }));
  }
}

export function emitShared(plan: ModulePlan, names: Names, runtime: string, initial: ReadonlyMap<Node, Node> = new Map(), data?: string) {
  const receivers = emitReceiverTargets(plan.receiverTargets, plan.module.module, names, runtime);
  const state = emitSharedState(plan, names, runtime, new Map([...initial, ...receivers]), data);
  const imported = emitMutations(plan.importedMutations ?? [], new Map(), names, runtime, null, state.replacements, {
    importedValues: state.importedValues,
  });
  state.imports.push(...imported.declarations);
  let replacements = new Map(imported.replacements);
  const writeDeclarations = new Map<(typeof state.owners)[number], Statement[]>();
  const takeovers = new Map(state.owners.map((owner) => [owner, emitTakeovers(
    owner.plan.takeovers, owner.versions, names, runtime, owner.scope, owner.batch, owner.keys, sourceTakeovers(plan, names, data),
    data === undefined ? undefined : expression('$$data.noteSourceReplacement', { data }),
  )]));
  for (const owner of state.owners) {
    for (const [node, replacement] of takeovers.get(owner)!.replacements) replacements.set(node, replacement);
    for (const [node, replacement] of emitConstWrites(owner.plan.readonlyBindings, names, runtime)) replacements.set(node, replacement);
    for (const binding of owner.plan.state) {
      if (owner.plan.readonlyBindings.includes(binding) || owner.plan.takeovers.includes(binding)) continue;
      emitSharedWrites(binding, owner, names, runtime, replacements, writeDeclarations);
    }
  }
  const mutationDeclarations = new Map<(typeof state.owners)[number], readonly Statement[]>();
  for (const owner of state.owners) {
    const mutations = emitMutations(owner.plan.mutations, owner.versions, names, runtime, owner.batch, replacements, {
      keys: owner.keys,
      notifiers: owner.notifiers,
      importedValues: state.importedValues,
    });
    replacements = new Map(mutations.replacements);
    const refs = plan.refs.filter((ref) => owner.plan.state.includes(ref.binding));
    const writes = emitWrites(refWrites(refs), owner.versions, names, runtime, owner.batch, replacements);
    replacements = emitRefs(refs, runtime, writes.replacements);
    mutationDeclarations.set(owner, [...(writeDeclarations.get(owner) ?? []), ...mutations.declarations, ...writes.declarations]);
  }
  const emitOwner = (owner: (typeof state.owners)[number]) => {
    const groups = plan.effects.groups.filter((group) => group.owner === owner.plan.fn && owner.plan.block === null);
    const effects = emitEffectGroups(groups, owner.scope, stringLiteral(`mmd:effects:${plan.module.path}`), names, runtime, replacements);
    const replayBase = new Map(effects.replacements);
    for (const mutation of owner.plan.replayMutations) {
      replayBase.delete(mutation.operation);
      for (const target of mutation.targets) replayBase.delete(target.member);
    }
    const replay = emitMutations(owner.plan.replayMutations, owner.versions, names, runtime, null, replayBase, {
      importedValues: state.importedValues,
    });
    const memos = emitMemos(owner.plan, owner.versions, names, effects.replacements, replay.replacements,
      takeovers.get(owner)!, runtime, owner.keys, { batch: owner.batch }, undefined, undefined, sourceBlockedSteps(plan, names),
      sourceChanges(plan, names, data));
    const enterSource = data !== undefined && owner.plan.fn === null && owner.plan.block === null
      ? [statement('$$data.ownSourceFrame($$frame, null);', { data, frame: owner.frame })]
      : [];
    const body = finishSharedOwner(owner, memos.setup, memos.snapshots, memos.update, names, enterSource);
    return [...owner.declarations, ...sourceReadinessStorage(plan, owner.plan.fn, names), ...effects.declarations, ...takeovers.get(owner)!.declarations,
      ...(mutationDeclarations.get(owner) ?? []), ...replay.declarations, ...body];
  };
  for (const owner of [...state.owners].sort((a, b) => (b.plan.block?.start ?? b.plan.fn?.start ?? -1) - (a.plan.block?.start ?? a.plan.fn?.start ?? -1))) {
    if (owner.plan.block !== null) {
      replacements.set(owner.plan.block, b.BlockStatement({ body: emitOwner(owner) }));
      continue;
    }
    if (owner.plan.fn === null) continue;
    const fn = copy(owner.plan.fn);
    fn.params = copy(owner.plan.fn.params, replacements);
    const body = emitOwner(owner);
    const directives = body.filter((node) => node.type === 'ExpressionStatement' && typeof node.directive === 'string');
    fn.body = b.BlockStatement({ body: [...directives, ...body.filter((node) => !directives.includes(node))] });
    replacements.set(owner.plan.fn, fn);
  }
  const moduleOwner = state.owners.find((owner) => owner.plan.fn === null && owner.plan.block === null);
  if (moduleOwner === undefined && plan.effects.calls.some((call) => call.owner === null)) {
    const scope = names.fresh('_moduleScope');
    const groups = plan.effects.groups.filter((group) => group.owner === null);
    const effects = emitEffectGroups(groups, scope, stringLiteral(`mmd:effects:${plan.module.path}`), names, runtime, replacements);
    replacements = new Map(effects.replacements);
    state.imports.push(statement('const $$scope = $$runtime.createBuildScope(true);', { scope, runtime }), ...effects.declarations);
  }
  const owned = new Set([...plan.components.values()].flatMap((component) => component.state));
  for (const owner of state.owners) for (const binding of owner.plan.state) owned.add(binding);
  replacements = emitRefs(plan.refs.filter((ref) => !owned.has(ref.binding)), runtime, replacements, true);
  return {
    replacements, imports: state.imports, importedValues: state.importedValues,
    moduleBody: () => moduleOwner === undefined ? null : emitOwner(moduleOwner),
  };
}
