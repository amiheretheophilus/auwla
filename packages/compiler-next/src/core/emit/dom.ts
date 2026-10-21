/** DOM emission from the render plan, with feature-owned state and write emission. */
import { b, findAll, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { CompileModulesOptions } from '../../options';
import { DEFAULT_RUNTIME_PATH } from '../../options';
import type { ComponentPlan, ModulePlan } from '../plan';
import { copy, finishCopy } from './copy';
import { Names } from './names';
import { expression, statement, stringLiteral } from './quote';
import { emitTemplate } from './template';
import { emitLocalState } from '../../features/state/dom';
import { emitConstWrites, emitWrites } from '../../features/handlers/dom';
import { emitSites } from './sites';
import { emitMemos } from '../../features/derived/dom';
import { emitTakeovers } from '../../features/derived/takeover';
import { emitRecovery } from './recovery';
import { emitMutations } from '../../features/handlers/mutations';
import { emitShared } from './shared';
import { emitAwaitBoundaries } from './await';

/** Preserve module syntax and exports, replacing planned functions on a fresh tree. */
export function emitDom(plan: ModulePlan, options: CompileModulesOptions): Node {
  const module = plan.module.module;
  if (plan.components.size === 0 && plan.sharedOwners.length === 0 && findAll(module.ast, ['TryStatement', 'AwaitExpression']).length === 0) return copy(module.ast);

  const names = new Names(module);
  const runtime = names.fresh('_MD');
  const runtimePath = JSON.stringify(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
  const hoisted: Statement[] = [statement(`import * as $$runtime from ${runtimePath};`, { runtime })];
  const shared = emitShared(plan, names, runtime);
  const replacements = shared.replacements;
  hoisted.push(...shared.imports);

  for (const component of plan.components.values()) {
    const markup = component.template.markup === null ? null : names.fresh('_markup');
    if (markup !== null) {
      hoisted.push(statement('const $$markup = $$html;', {
        markup,
        html: stringLiteral(component.template.markup!),
      }));
    }
    replacements.set(component.fn, finishCopy(emitComponent(component, names, runtime, markup, replacements)));
  }

  const output = copy(module.ast, replacements);
  const sharedBody = shared.moduleBody();
  if (sharedBody !== null) {
    const directives = sharedBody.filter((node) => is.ExpressionStatement(node) && typeof node.directive === 'string');
    output.body = [...directives, ...sharedBody.filter((node) => !directives.includes(node))] as typeof output.body;
  }
  // A module's directive prologue must remain before generated declarations.
  let insertion = 0;
  for (const entry of output.body) {
    if (!is.ExpressionStatement(entry) || typeof entry.directive !== 'string') break;
    insertion++;
  }
  output.body.splice(insertion, 0, ...hoisted);
  return emitAwaitBoundaries(emitRecovery(output, names, runtime), runtime);
}

function emitComponent(plan: ComponentPlan, names: Names, runtime: string, markup: string | null,
  external: ReadonlyMap<Node, Node>,
): Node {
  const document = names.fresh('_document');
  const id = names.fresh('_id');
  const parent = names.fresh('_parent');
  const state = emitLocalState(plan.state, names);
  const batch = plan.state.length === 0 && plan.dynamicSites.size === 0 ? null : names.fresh('_writes');
  const update = names.fresh('_update');
  const entity = names.fresh('_entity');
  const scope = names.fresh('_scope');
  const setupFrame = names.fresh('_setupFrame');
  const updateFrame = names.fresh('_updateFrame');
  const takeovers = emitTakeovers(plan.takeovers, state.versions, names, scope, batch!);
  const trackKeys = new Map<import('../graph').BindingNode, string>();
  const readonly = new Map([
    ...external,
    ...takeovers.replacements,
    ...emitConstWrites(plan.readonlyBindings, names, runtime),
  ]);
  for (const read of plan.trackedReads) {
    const key = trackKeys.get(read.binding) ?? names.fresh('_readKey');
    trackKeys.set(read.binding, key);
    readonly.set(read.node, expression('$$runtime.trackRead(() => $$version, $$binding, $$key)', {
      runtime, version: state.versions.get(read.binding)!, binding: read.binding.binding.name, key,
    }));
  }
  const handled = new Set(plan.takeovers);
  const mutations = emitMutations(plan.mutations, state.versions, names, runtime, batch, readonly);
  const writes = batch === null
    ? { replacements: new Map<Node, Node>(), declarations: [] }
    : emitWrites(plan.writes, state.versions, names, batch, mutations.replacements, handled);
  // Only writes executed by replay itself are silent. A function created by a
  // replayed initializer may run later and must keep its ordinary write commits.
  const replayBase = new Map(writes.replacements);
  for (const write of plan.replayWrites) replayBase.delete(write.operation);
  for (const write of plan.replayMutations) {
    replayBase.delete(write.operation);
    for (const target of write.targets) replayBase.delete(target.member);
  }
  const replayMutations = emitMutations(plan.replayMutations, state.versions, names, runtime, null, replayBase);
  const replay = emitWrites(plan.replayWrites, state.versions, names, null, replayMutations.replacements, handled);
  const memos = emitMemos(plan, state.versions, names, writes.replacements, replay.replacements, takeovers, runtime, trackKeys,
    batch === null ? undefined : { batch, entity });
  const body: Statement[] = [
    ...state.declarations,
    ...[...trackKeys.values()].map((key) => statement('const $$key = {};', { key })),
    ...takeovers.declarations,
    ...mutations.declarations,
    ...replayMutations.declarations,
    ...writes.declarations,
    ...replay.declarations,
  ];
  if (batch !== null) {
    body.push(statement('const $$entity = { id: $$id, parent: $$parent, render: $$update };', { entity, id, parent, update }));
    body.push(statement('const $$batch = $$runtime.createWriteBatch($$entity);', { batch, runtime, entity }));
  }
  body.push(
    statement('const $$scope = $$runtime.createBuildScope();', { scope, runtime }),
    statement('const $$setupFrame = $$scope.enter();', { setupFrame, scope }),
    ...memos.setup,
    ...memos.snapshots,
    statement('const $$document = $$runtime.getActiveEnvironment().document;', { document, runtime }),
  );
  const used = new Set(plan.template.roots);
  for (const site of plan.sites) used.add(site.node);
  const template = emitTemplate(plan.template, used, { names, runtime, document, markup });
  body.push(...template.statements);

  // Placeholders keep neighbouring values as distinct text nodes after parsing.
  const texts = new Map<number, string>();
  for (const site of plan.sites) {
    if (site.kind !== 'text') continue;
    const text = names.fresh('_text');
    texts.set(site.node, text);
    body.push(statement('const $$text = $$document.createTextNode("");', { text, document }));
    body.push(statement('$$placeholder.replaceWith($$text);', { placeholder: template.ref(site.node), text }));
  }

  const sites = emitSites(plan, {
    names, runtime, batch, entity, versions: state.versions, replacements: writes.replacements,
    ref: (index) => texts.get(index) ?? template.ref(index),
  });
  body.push(...sites.mount);
  if (batch !== null) {
    const roots = plan.mutationRoots.map((binding) => expression('({ read: () => $$binding, notify: () => { $$version++; if (!$$scope.building()) $$batch.mark(); } })', {
      binding: binding.binding.name, version: state.versions.get(binding)!, batch, scope,
    }));
    body.push(statement('$$runtime.watchMutationRoots($$entity, $$roots);', {
      runtime, entity, roots: b.ArrayExpression({ elements: roots }),
    }));
    body.push(b.FunctionDeclaration({
      id: b.Identifier({ name: update }), params: [],
      body: b.BlockStatement({ body: [
        statement('const $$updateFrame = $$scope.enter();', { updateFrame, scope }),
        ...memos.update, ...sites.update,
        statement('$$scope.leave($$updateFrame);', { scope, updateFrame }),
      ] }), async: false, generator: false, expression: false,
    }));
    body.push(statement('$$runtime.registerEntity($$entity);', { runtime, entity }));
    body.push(statement('$$batch.activate();', { batch }));
  }

  body.push(statement('$$scope.leave($$setupFrame);', { scope, setupFrame }));

  const roots = plan.template.roots.map((index) => texts.get(index) ?? template.ref(index));
  if (roots.length === 1) {
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: roots[0]! }) }));
  } else {
    const fragment = names.fresh('_fragment');
    body.push(statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document }));
    for (const root of roots) body.push(statement('$$fragment.appendChild($$root);', { fragment, root }));
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: fragment }) }));
  }

  const fn = copy(plan.fn);
  fn.params = [b.Identifier({ name: id }), b.Identifier({ name: parent }), ...fn.params];
  fn.body = b.BlockStatement({ body });
  if (fn.type === 'ArrowFunctionExpression') fn.expression = false;
  return fn;
}
