/** Compose shared storage and feature emission before replacing components. */
import { b } from 'yuku-ast';
import type { Statement } from 'yuku-parser';
import type { ModulePlan } from '../plan';
import type { Names } from './names';
import { copy } from './copy';
import { expression } from './quote';
import { emitSharedState, finishSharedOwner } from '../../features/state/shared-dom';
import { emitConstWrites } from '../../features/handlers/dom';
import { emitMutations } from '../../features/handlers/mutations';
import { emitMemos } from '../../features/derived/dom';
import { emitTakeovers } from '../../features/derived/takeover';
import { emitReceiverTargets } from '../../features/handlers/receivers';

export function emitShared(plan: ModulePlan, names: Names, runtime: string) {
  const receivers = emitReceiverTargets(plan.receiverTargets, plan.module.module, names, runtime);
  const state = emitSharedState(plan, names, runtime, receivers);
  let replacements = new Map(state.replacements);
  const takeovers = new Map(state.owners.map((owner) => [owner, emitTakeovers(
    owner.plan.takeovers, owner.versions, names, owner.scope, owner.batch, owner.keys,
  )]));
  for (const owner of state.owners) {
    for (const [node, replacement] of takeovers.get(owner)!.replacements) replacements.set(node, replacement);
    for (const [node, replacement] of emitConstWrites(owner.plan.readonlyBindings, names, runtime)) replacements.set(node, replacement);
    for (const binding of owner.plan.state) {
      if (owner.plan.readonlyBindings.includes(binding) || owner.plan.takeovers.includes(binding)) continue;
      const value = names.fresh('_assigned');
      const receiver = expression(`({
        get value() { return $$binding; },
        set value($$value) { $$binding = $$value; $$version++; if (!$$scope.building()) $$batch.mark($$key); }
      }).value`, {
        binding: binding.binding.name, value, version: owner.versions.get(binding)!, scope: owner.scope, batch: owner.batch, key: owner.keys.get(binding)!,
      });
      for (const { site } of binding.writes) {
        if (site.kind === 'assign' || site.kind === 'update') replacements.set(site.reference.node, receiver);
      }
    }
  }
  const mutationDeclarations = new Map<(typeof state.owners)[number], readonly Statement[]>();
  for (const owner of state.owners) {
    const mutations = emitMutations(owner.plan.mutations, owner.versions, names, runtime, owner.batch, replacements, owner.keys, owner.notifiers);
    replacements = new Map(mutations.replacements);
    mutationDeclarations.set(owner, mutations.declarations);
  }
  const emitOwner = (owner: (typeof state.owners)[number]) => {
    const replayBase = new Map(replacements);
    for (const mutation of owner.plan.replayMutations) {
      replayBase.delete(mutation.operation);
      for (const target of mutation.targets) replayBase.delete(target.member);
    }
    const replay = emitMutations(owner.plan.replayMutations, owner.versions, names, runtime, null, replayBase);
    const memos = emitMemos(owner.plan, owner.versions, names, replacements, replay.replacements,
      takeovers.get(owner)!, runtime, owner.keys, { batch: owner.batch });
    const body = finishSharedOwner(owner, memos.setup, memos.snapshots, memos.update, names);
    return [...owner.declarations, ...takeovers.get(owner)!.declarations,
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
  return {
    replacements, imports: state.imports,
    moduleBody: () => moduleOwner === undefined ? null : emitOwner(moduleOwner),
  };
}
