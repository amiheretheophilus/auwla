/** DOM emission from the render plan, with feature-owned state and write emission. */
import { b, findAll, is } from 'yuku-ast';
import type { Node, Statement } from 'yuku-parser';
import type { CompileModulesOptions } from '../../options';
import { DEFAULT_RUNTIME_PATH } from '../../options';
import type { ComponentPlan, ModulePlan, Site } from '../plan';
import { copy, finishCopy } from './copy';
import { Names } from './names';
import { expression, statement, stringLiteral } from './quote';
import { emitNodes } from './template';
import { emitLocalState } from '../../features/state/dom';
import { emitConstWrites, emitWrites } from '../../features/handlers/dom';
import { emitSites } from './sites';
import { emitMemos } from '../../features/derived/dom';
import { emitTakeovers } from '../../features/derived/takeover';
import { emitRecovery } from './recovery';
import { emitMutations } from '../../features/handlers/mutations';
import { emitShared } from './shared';
import { emitAwaitBoundaries } from './await';
import { emitRenderValue } from './render-value';
import { RowComponents } from './row-list';
import { emitComponentCall } from '../../features/components/dom';
import { emitProps } from '../../features/props/dom';
import { functionValue } from '../resolve/functions';
import { emitRefs } from '../../features/refs/dom';
import { emitEffectGroups, emitLifecycleCalls } from '../../features/effects/dom';
import { emitSources } from '../../features/sources/dom';

/** Preserve module syntax and exports, replacing planned functions on a fresh tree. */
export function emitDom(plan: ModulePlan, options: CompileModulesOptions): Node {
  const module = plan.module.module;
  const hasRenderWork = plan.components.size > 0 || plan.sharedOwners.length > 0
    || plan.values.length > 0 || plan.calls.length > 0 || plan.componentReferences.size > 0 || plan.effects.calls.length > 0;
  if (!hasRenderWork) {
    const hasBoundaries = findAll(module.ast, ['TryStatement', 'AwaitExpression']).length > 0;
    if (!hasBoundaries) {
      return copy(module.ast);
    }
  }

  const names = new Names(module);
  const runtime = names.fresh('_MD');
  const data = names.fresh('_data');
  const runtimePath = JSON.stringify(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
  const hoisted: Statement[] = [statement(`import * as $$runtime from ${runtimePath};`, { runtime })];
  if ([...plan.components.values()].some((component) => component.sources !== undefined)) {
    hoisted.push(statement('import * as $$data from "@memoized-dom/data/internal";', { data }));
  }
  const shared = emitShared(plan, names, runtime, emitLifecycleCalls(plan, names, runtime));
  const replacements = shared.replacements;
  for (const reference of module.references) {
    if (reference.isWrite || reference.inTypePosition) {
      continue;
    }
    if (!plan.componentReferences.has(reference.node)) {
      continue;
    }
    const parent = module.parentOf(reference.node);
    if (is.JSXOpeningElement(parent) || is.JSXClosingElement(parent) || is.JSXMemberExpression(parent)
      || is.ExportSpecifier(parent) || is.ExportDefaultDeclaration(parent)) {
      continue;
    }
    const discarded = is.CallExpression(parent) && parent.callee === reference.node
      && is.ExpressionStatement(module.parentOf(parent));
    replacements.set(reference.node, expression(discarded
      ? '$$runtime.componentSetup($$component)'
      : '$$runtime.componentValue($$component)', {
      runtime, component: reference.node,
    }));
  }
  for (const call of plan.calls) {
    // Module-level components and function expressions are registered where
    // they are defined (below). Only a declaration nested in a function is
    // registered where its tag is evaluated, which is hoisted in its scope.
    const tag = call.openingElement.name;
    const fn = plan.componentReferences.has(tag) ? functionValue(module, tag) : null;
    const nested = fn !== null && is.FunctionDeclaration(fn) && [...module.ancestors(fn)].some((ancestor) => {
      return ancestor !== fn && is.Function(ancestor);
    });
    replacements.set(call, emitComponentCall(call, runtime, nested));
  }
  hoisted.push(...shared.imports);
  for (const value of plan.values) {
    const emitted = emitRenderValue(value, names, runtime);
    hoisted.push(emitted.declaration);
    replacements.set(value.node, emitted.replacement);
  }

  const rowComponents = new RowComponents(plan, names, runtime, replacements);
  // A parent setup can contain a component declaration. Compose the nested
  // function first, before finishCopy seals the parent's emitted tree.
  const components = [...plan.components.values()].sort((left, right) => right.fn.start - left.fn.start);
  for (const component of components) {
    const markup = component.template.markup === null ? null : names.fresh('_markup');
    if (markup !== null) {
      hoisted.push(statement('const $$markup = $$html;', {
        markup,
        html: stringLiteral(component.template.markup!),
      }));
    }
    let emitted = emitComponent(component, names, runtime, markup, replacements, rowComponents, plan.refs, plan.effects.groups,
      plan.effects.calls.some((call) => call.owner === component.fn), data);
    const enclosingFunction = [...module.ancestors(component.fn)].find((ancestor) => {
      return ancestor !== component.fn && is.Function(ancestor);
    });
    const rootId = `${plan.module.path}#${component.fn.id?.name ?? component.fn.start}`;
    if (!is.FunctionDeclaration(component.fn)) {
      emitted = enclosingFunction === undefined
        ? expression('$$runtime.defineComponent($$component, $$root)', {
          runtime, component: emitted, root: stringLiteral(rootId),
        })
        : expression('$$runtime.defineComponent($$component)', { runtime, component: emitted });
    } else if (enclosingFunction === undefined && component.fn.id !== null) {
      hoisted.push(statement('$$runtime.defineComponent($$component, $$root);', {
        runtime, component: component.fn.id.name, root: stringLiteral(rootId),
      }));
    }
    const insideComponent = [...module.ancestors(component.fn)].some((ancestor) => {
      return ancestor !== component.fn && plan.components.has(ancestor);
    });
    // Nested components still need their enclosing instance's lexical read
    // and write rewrites. Seal only after that enclosing composition is done.
    replacements.set(component.fn, insideComponent ? emitted : finishCopy(emitted));
  }

  hoisted.push(...rowComponents.declarations, ...names.hoisted);
  const output = copy(module.ast, replacements);
  const sharedBody = shared.moduleBody();
  if (sharedBody !== null) {
    const directives = sharedBody.filter((node) => is.ExpressionStatement(node) && typeof node.directive === 'string');
    output.body = [...directives, ...sharedBody.filter((node) => !directives.includes(node))] as typeof output.body;
  }
  // A module's directive prologue must remain before generated declarations.
  let insertion = 0;
  for (const entry of output.body) {
    if (!is.ExpressionStatement(entry) || typeof entry.directive !== 'string') {
      break;
    }
    insertion++;
  }
  output.body.splice(insertion, 0, ...hoisted);
  return emitAwaitBoundaries(emitRecovery(output, names, runtime), runtime);
}

function emitComponent(
  plan: ComponentPlan,
  names: Names,
  runtime: string,
  markup: string | null,
  external: ReadonlyMap<Node, Node>,
  rowComponents: RowComponents,
  refs: ModulePlan['refs'],
  effectGroups: ModulePlan['effects']['groups'],
  ownsLifecycle: boolean,
  data: string,
): Node {
  const document = names.fresh('_document');
  const id = names.of(plan.fn, '_id');
  const parent = names.fresh('_parent');
  const state = emitLocalState(plan.state, names);
  // Value slots can own nested DOM even when the component has no local state.
  // Their listeners and disposal still need the component's batch and entity.
  const ownsRegions = plan.sites.some((site) => {
    return site.kind === 'conditional' || (site.kind === 'text' && !site.primitive);
  });
  const ownsRefs = (sites: readonly Site[]): boolean => sites.some((site) => {
    return site.kind === 'ref' || (site.kind === 'conditional' && site.branches.some((branch) => ownsRefs(branch.sites)));
  });
  const groups = effectGroups.filter((group) => group.owner === plan.fn);
  const needsBatch = plan.state.length > 0
    || plan.dynamicSites.size > 0
    || ownsRegions
    || groups.length > 0
    || ownsLifecycle
    || ownsRefs(plan.sites)
    || plan.sources !== undefined;
  const batch = needsBatch ? names.fresh('_writes') : null;
  const update = names.fresh('_update');
  const entity = names.fresh('_entity');
  const scope = names.fresh('_scope');
  const setupFrame = names.fresh('_setupFrame');
  const updateFrame = names.fresh('_updateFrame');
  const namespace = names.fresh('_namespace');
  const setupOnly = names.fresh('_setupOnly');
  const props = emitProps(plan, state.versions, names, runtime, batch, external);
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
  // `x === e` with a tracked `x`: the reader depends only on the comparison.
  // `x` is read first, then `e`, as written (`optimize/keyed-comparisons.ts`).
  for (const [node, binding] of plan.keyedComparisons ?? []) {
    if (!is.BinaryExpression(node)) continue;
    const equals = expression('$$runtime.trackEquals($$binding, $$other, () => $$binding, () => $$version, $$key)', {
      runtime, binding: binding.binding.name, other: node.right, version: state.versions.get(binding)!,
      key: trackKeys.get(binding)!,
    });
    readonly.set(node, node.operator === '!==' ? expression('!$$equals', { equals }) : equals);
  }
  const handled = new Set(plan.takeovers);
  const sources = emitSources(plan.sources, {
    versions: state.versions,
    takeoverFlags: takeovers.flags,
    names,
    data,
    runtime,
    owner: id,
    batch: batch!,
    scope,
    replacements: readonly,
  });
  const mutations = emitMutations(plan.mutations, state.versions, names, runtime, batch, sources.replacements, sources.mutations);
  const writes = batch === null
    ? { replacements: mutations.replacements, declarations: [] }
    : emitWrites(plan.writes, state.versions, names, batch, mutations.replacements, handled);
  // Only writes executed by replay itself are silent. A function created by a
  // replayed initializer may run later and must keep its ordinary write commits.
  const refReplacements = emitRefs(refs.filter((ref) => plan.state.includes(ref.binding)), runtime, writes.replacements);
  const effects = emitEffectGroups(groups, scope, id, names, runtime, refReplacements, plan.deferred, plan.setup);
  const replayBase = new Map(effects.replacements);
  for (const write of plan.replayWrites) replayBase.delete(write.operation);
  for (const write of plan.replayMutations) {
    replayBase.delete(write.operation);
    for (const target of write.targets) replayBase.delete(target.member);
  }
  const replayMutations = emitMutations(plan.replayMutations, state.versions, names, runtime, null, replayBase, sources.mutations);
  const replay = emitWrites(plan.replayWrites, state.versions, names, null, replayMutations.replacements, handled);
  // One flag per setup segment after a return: whether control reached it.
  const reached = [...new Set(plan.deferred.values())].map(() => names.fresh('_reached'));
  const memos = emitMemos(plan, state.versions, names, effects.replacements, replay.replacements, takeovers, runtime, trackKeys,
    batch === null ? undefined : { batch, entity }, { statements: plan.deferred, flags: reached }, sources.mutations.values);
  const once = (statements: readonly Statement[]): Statement[] => {
    const flag = reached[plan.deferred.get(statements[0]!)!]!;
    return [...effects.reach(statements), b.IfStatement({
      test: expression('!$$flag', { flag }),
      consequent: b.BlockStatement({
        body: [statement('$$flag = true;', { flag }), ...statements.flatMap((entry) => memos.deferred.get(entry) ?? [])],
      }),
      alternate: null,
    })];
  };
  const body: Statement[] = [
    ...reached.map((flag) => statement('let $$flag = false;', { flag })),
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
    // Setup already owns collectors and can mount children. Register its
    // inactive entity first so a failed mount can dispose that entire subtree.
    // The batch becomes active only after every render site is initialized.
    body.push(statement('$$runtime.registerEntity($$entity);', { runtime, entity }));
  }
  body.push(
    statement('const $$scope = $$runtime.createBuildScope();', { scope, runtime }),
    ...sources.declarations,
    ...effects.declarations,
    statement(batch === null
      ? 'const $$setupFrame = $$scope.enter();'
      : `const $$setupFrame = $$scope.enter(() => {
        if ($$runtime.getEntity($$id) === $$entity) {
          $$runtime.unregisterSubtree($$id);
        }
      });`, { setupFrame, scope, runtime, id, entity }),
    ...props.setup,
    ...memos.setup,
    ...memos.snapshots,
    ...props.receive,
    b.IfStatement({
      test: b.Identifier({ name: setupOnly }),
      consequent: b.BlockStatement({ body: [
        statement('$$scope.leave($$setupFrame);', { scope, setupFrame }),
        b.ReturnStatement({ argument: null }),
      ] }),
      alternate: null,
    }),
    ...(batch === null ? [] : [statement('$$batch.beginMount();', { batch })]),
    statement('const $$document = $$runtime.getActiveEnvironment().document;', { document, runtime }),
  );
  // Placeholders keep neighbouring values as distinct text nodes after parsing.
  const slots = emitNodes(plan.template, plan.sites, { names, runtime, document, markup, namespace });
  body.push(...slots.statements);

  const sites = emitSites(plan, {
    names, runtime, batch, entity, id, document, versions: state.versions, replacements: effects.replacements,
    ref: slots.ref, once, namespace, rowComponents,
    select: (site, value) => site.expression === plan.fn.body ? effects.select(value) : value,
  });
  body.push(...sites.mount);
  // A callback can read this instance while another component collects its
  // dependencies. Publish local versions after the owner's update settles so
  // those consumers receive the same notifications as shared-state readers.
  const publications = [...trackKeys].map(([binding, key]) => ({
    key,
    version: state.versions.get(binding)!,
    seen: names.fresh('_publishedVersion'),
  }));
  for (const { version, seen } of publications) {
    body.push(statement('let $$seen = $$version;', { seen, version }));
  }
  const publish: Statement[] = [];
  for (const { version, seen, key } of publications) {
    publish.push(statement(`if ($$seen !== $$version) {
      $$seen = $$version;
      $$runtime.publishVersions([$$key]);
    }`, { seen, version, runtime, key }));
  }
  if (sites.dispose.length > 0) {
    const cleanup = statement('$$runtime.cleanup($$id, () => {});', { runtime, id });
    if (cleanup.type === 'ExpressionStatement' && cleanup.expression.type === 'CallExpression') {
      const callback = cleanup.expression.arguments[1]!;
      if (callback.type === 'ArrowFunctionExpression' && callback.body.type === 'BlockStatement') callback.body.body = [...sites.dispose];
    }
    body.push(cleanup);
  }
  if (batch !== null) {
    // `direct`: the notifier this component's edits through the binding call,
    // so such an edit need not walk the root to find it (`runtime/src/mutation.ts`).
    const roots = plan.mutationRoots.map((binding) => {
      const direct = mutations.notifiers.get(binding);
      return expression(direct === undefined
        ? '({ read: () => $$binding, notify: () => { $$version++; if (!$$scope.building()) $$batch.mark(); } })'
        : '({ read: () => $$binding, notify: () => { $$version++; if (!$$scope.building()) $$batch.mark(); }, direct: $$direct })', {
        binding: sources.mutations.values.get(binding) ?? expression('$$binding', { binding: binding.binding.name }),
        version: state.versions.get(binding)!, batch, scope, ...(direct === undefined ? {} : { direct }),
      });
    });
    if (roots.length > 0) {
      body.push(statement('$$runtime.watchMutationRoots($$entity, $$roots);', {
        runtime, entity, roots: b.ArrayExpression({ elements: roots }),
      }));
    }
    body.push(b.FunctionDeclaration({
      id: b.Identifier({ name: update }), params: [],
      body: b.BlockStatement({ body: [
        statement('const $$updateFrame = $$scope.enter();', { updateFrame, scope }),
        ...memos.update, ...sites.update, ...publish,
        // A root binding reassigned since its last walk marked this component;
        // re-index it now rather than checking every root on every store.
        ...(roots.length === 0 ? [] : [statement('$$runtime.checkMutationRoots($$entity);', { runtime, entity })]),
        statement('$$scope.leave($$updateFrame);', { scope, updateFrame }),
      ] }), async: false, generator: false, expression: false,
    }));
    body.push(statement('$$batch.activate();', { batch }));
  }

  body.push(statement('$$scope.leave($$setupFrame);', { scope, setupFrame }));

  const roots = plan.template.roots.map(slots.root);
  if (roots.length === 1) {
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: roots[0]! }) }));
  } else {
    const fragment = names.fresh('_fragment');
    body.push(statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document }));
    for (const root of roots) body.push(statement('$$fragment.appendChild($$root);', { fragment, root }));
    body.push(b.ReturnStatement({ argument: b.Identifier({ name: fragment }) }));
  }

  const fn = copy(plan.fn);
  fn.params = [id, parent, props.parameter, namespace, setupOnly].map((name) => b.Identifier({ name }));
  fn.body = b.BlockStatement({ body });
  if (fn.type === 'ArrowFunctionExpression') fn.expression = false;
  return fn;
}
