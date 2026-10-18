/** Coordinates transparent-source read lowering for every component. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  cloneNode as cloneEstreeNode,
  extractPatternIdentifiers,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../ast';
import {
  astBindingAt,
  memberKey,
  nodeHasJsx,
  refreshAstAnalysis,
  type TransparentStateSeed,
} from '../context';
import { type DomContext as Ctx } from './context';
import { mdd } from './identifiers';
import {annotateAsyncRead, annotateTransparentSources, asyncReadFact, excludeTransparentSubscriptions} from '../planning/async-reads';
import { initialReadPlacement } from './initial-dom';
import { wrapAutomaticSite } from './data-sites';
import { lowerModuleRefReadsEstree } from './module-read-lowering';
import {
  isActionRefreshTarget,
  isBoundTo,
  isDirectSourceComponentProp,
  isEventOrRefContainer,
  isEventSourceHolderReference,
  isGroupDataContainer,
  isPassthroughArgument,
  isWithinDirectSourceComponentProp,
  isWithinGroupData,
  sourceBindings,
  sourceDependencies,
  stateSeedDeclarators,
  type TransparentDerivation,
} from '../analysis/transparent-reads';
import { analyzeComponentReturns, returnPlanAsConditional } from '../components/return-plan';
import { summarizeHelper } from '../helper-summaries';
import { isGeneratedDataCall } from './data-read-recognition';
import {
  gateSourceEffects,
  isInsideRenderGate,
  replaceDerivedReads,
  replaceSourceReadsWithRenderGates,
  resolvedRenderExpression,
  trackDependencies,
} from './read-transforms';
import type { RenderGatedExpression } from './data-subscriptions';

export function rewriteTransparentDataReads(ctx: Ctx): void {
  const refresh = (): void => {
    const root = ctx.astAnalysis?.rootScope.block;
    if (root !== undefined) refreshAstAnalysis(ctx, root);
  };
  // Helpers that mix request-state and payload access keep the holder at their
  // call boundary. Materialize only the proven payload reads inside the helper
  // body so `$track(source)` and `source.length` can coexist without changing
  // the authored function signature.
  for (const [name, helperPath] of ctx.helpers) {
    const summary = summarizeHelper(ctx, name);
    if (summary.parameterPayloadReads.length === 0) continue;
    const helper = helperPath.node;
    const helperNode = helper as unknown as BaseNode;
    const replacements: Array<{
      expression: BaseNode;
      binding: string;
      site: string;
    }> = [];
    for (const effect of summary.parameterPayloadReads) {
      const parameter = helper.params[effect.index];
      if (!astFactory.isIdentifier(parameter)) continue;
      const parameterBinding = astBindingAt(
        ctx,
        helperNode,
        parameter.name,
      );
      if (parameterBinding === undefined) continue;
      const expected = [parameter.name, ...effect.path].join('.');
      walkAst(helperNode, {
        enter(current) {
          let matches = false;
          if (effect.path.length === 0 && current.type === 'Identifier') {
            matches = (current as unknown as AstIdentifier).name === parameter.name &&
              astBindingAt(ctx, current, parameter.name) === parameterBinding &&
              parameterBinding.references.includes(current as unknown as AstIdentifier);
          } else if (effect.path.length > 0 && current.type === 'MemberExpression') {
            matches = memberKey(current as unknown as t.MemberExpression) === expected &&
              astBindingAt(ctx, current, parameter.name) === parameterBinding;
          }
          if (!matches || isPassthroughArgument(ctx, current)) return;
          const parent = ctx.astAnalysis?.parentByNode.get(current) ?? null;
          if (
            (parent?.type === 'AssignmentExpression' &&
              childNode(parent, 'left') === current) ||
            (parent?.type === 'UpdateExpression' &&
              childNode(parent, 'argument') === current) ||
            (parent?.type === 'UnaryExpression' &&
              (parent as unknown as t.UnaryExpression).operator === 'delete')
          ) return;
          const site = current.loc === null || current.loc === undefined
            ? ctx.moduleId
            : `${ctx.moduleId}:${current.loc.start.line}:${current.loc.start.column + 1}`;
          replacements.push({
            expression: current,
            binding: effect.path.length === 0
              ? parameter.name
              : `${parameter.name}.${effect.path.join('.')}`,
            site,
          });
          return false;
        },
      });
    }
    for (const { expression, binding, site } of replacements) {
      overwriteNode(
        expression,
        annotateAsyncRead(astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
          cloneEstreeNode(expression, true) as unknown as t.Expression,
          astFactory.stringLiteral(binding),
          astFactory.stringLiteral(site),
        ]), [binding], 'throw', binding) as unknown as BaseNode,
      );
      ctx.usesTransparentData = true;
    }
  }
  refresh();
  // Module-scope refs join the same derivation machinery as component-local
  const moduleBinding = (
    component: BaseNode,
    name: string,
  ): AstBinding | undefined => {
    if (!ctx.transparentModuleSources.has(name)) return undefined;
    const binding = astBindingAt(ctx, component, name);
    return binding?.kind === 'import' ? binding : undefined;
  };
  const componentSourceBindings = (component: string, componentNode: BaseNode): Map<string, AstBinding> => {
    const bindings = sourceBindings(ctx, componentNode, ctx.transparentSources.get(component) ?? new Set<string>());
    for (const name of ctx.transparentModuleSources.keys()) {
      const binding = moduleBinding(componentNode, name);
      if (binding !== undefined) bindings.set(name, binding);
    }
    return bindings;
  };

  // `if (article.hidden) return <A/>; return <B/>;` chooses from loading data.
  // The chain becomes one returned conditional, a read site that waits for
  // its sources like `{article.hidden ? <A/> : <B/>}` in markup.
  let returnsChanged = false;
  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const bindings = componentSourceBindings(component, componentNode);
    if (bindings.size === 0) continue;
    const returns = analyzeComponentReturns(componentPath, component);
    if (!('pick' in returns)) continue;
    const eventSources = ctx.eventSourceSlots.get(component) ?? new Set<string>();
    const choosesFromSource = [...returns.statements].some(statement =>
      astFactory.isIfStatement(statement) &&
      sourceDependencies(ctx, statement.test as unknown as BaseNode, bindings, new Map(), eventSources).length > 0);
    if (!choosesFromSource) continue;
    const conditional = returnPlanAsConditional(returns);
    if (conditional === null) continue;
    const body = componentPath.node.body;
    body.body = [
      ...body.body.filter(statement => !returns.statements.has(statement)),
      astFactory.returnStatement(astFactory.jsxFragment(astFactory.jsxOpeningFragment(),
        astFactory.jsxClosingFragment(), [astFactory.jsxExpressionContainer(conditional)])),
    ];
    returnsChanged = true;
  }
  if (returnsChanged) refresh();

  // Module-scope sources (RFC §16.4): lower refs to materializing reads
  // first so plain sites are safe immediately; derivation roots, state seeds
  // and effects are skipped by that pass and gated by the passes below.
  for (const [componentName, componentPath] of ctx.compPaths) {
    lowerModuleRefReadsEstree(
      ctx,
      componentName,
      componentPath.node as unknown as BaseNode,
      refresh,
    );
  }
  refresh();

  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const localNames =
      ctx.transparentSources.get(component) ?? new Set<string>();
    // Module-scope source bindings join the component-local holders, so
    // derivation and container passes treat imported refs alike (runtime
    // helpers accept ModuleSourceRef uniformly).
    const bindings = componentSourceBindings(component, componentNode);
    if (localNames.size === 0 && bindings.size === 0) continue;
    const names = localNames;
    const eventSources = ctx.eventSourceSlots.get(component) ?? new Set<string>();
    const tracks = ctx.transparentTrackBindings.get(component) ?? new Map();
    const derived = new Map<string, TransparentDerivation>();
    for (const derivation of ctx.instanceDerivations.get(component) ?? []) {
      // `$track(source)` returns a stable request-state facade whose getters
      // and methods must be usable before the source's first payload commits.
      // Treating that declaration as a payload derivation initializes it to
      // `undefined` and makes controls such as `track.refresh()` crash while
      // the request is pending.
      if (derivation.bindings.some(binding => tracks.has(binding))) continue;
      let sources = derivation.sources.filter((source) => names.has(source));
      // Roots that resolve to imported module-scope sources extend the
      // dependency set even though they are not component-local holders.
      const moduleRoots: string[] = [];
      for (const name of ctx.transparentModuleSources.keys()) {
        if (bindings.has(name) && derivation.sources.includes(name)) {
          moduleRoots.push(name);
        }
      }
      sources = [...new Set([...sources, ...moduleRoots])];
      if (sources.length === 0) continue;
      const declaration = derivation.declaration;
      const target = declaration.declarations.find(
        (candidate) => candidate.init !== null &&
          extractPatternIdentifiers(candidate.id as unknown as BaseNode).some(
            (identifier) => derivation.bindings.includes(identifier.name),
          ),
      );
      const init = target?.init;
      if (init === null || init === undefined || !astFactory.isExpression(init)) continue;
      replaceDerivedReads(
        ctx,
        init as unknown as BaseNode,
        derived,
      );
      refresh();
      const projection = cloneEstreeNode(init, true);
      if (derivation.requestStateOnly === true) {
        derivation.source = cloneEstreeNode(init, true);
        for (const name of derivation.bindings) {
          const binding = astBindingAt(ctx, componentNode, name);
          if (binding !== undefined) {
            derived.set(name, {
              binding,
              sources,
              expression: cloneEstreeNode(projection, true),
              requestStateOnly: true,
            });
          }
        }
        continue;
      }
      if (derivation.replay !== undefined) {
        // `$fetch('/api/comments/' + article.slug)`: the request waits for
        // `article`. Until it commits the binding holds an idle source; each
        // commit replays the owner, whose replay rebinds the request.
        const gate = resolvedRenderExpression(ctx, init, sources, bindings, eventSources, 'deriveResolvedValues');
        overwriteNode(init as unknown as BaseNode, astFactory.logicalExpression('??', gate,
          astFactory.callExpression(mdd(ctx, 'createBodylessSource'), [astFactory.nullLiteral()])) as unknown as BaseNode);
        derivation.replay = { ...derivation.replay, gate: cloneEstreeNode(gate, true) as t.CallExpression };
        derivation.source = cloneEstreeNode(init, true);
        const followed = sources.filter(source => !eventSources.has(source));
        if (followed.length > 0) {
          const owner = ctx.transparentOwnerSources.get(component) ?? new Set<string>();
          for (const source of followed) owner.add(source);
          ctx.transparentOwnerSources.set(component, owner);
        }
        continue;
      }
      const wrapped = resolvedRenderExpression(
        ctx,
        init,
        sources,
        bindings,
        eventSources,
        'deriveResolvedValues',
      );
      overwriteNode(
        init as unknown as BaseNode,
        wrapped as unknown as BaseNode,
      );
      derivation.source = cloneEstreeNode(wrapped, true);
      for (const name of derivation.bindings) {
        const binding = astBindingAt(ctx, componentNode, name);
        if (binding !== undefined) {
          derived.set(name, {
            binding,
            sources,
            expression: cloneEstreeNode(projection, true),
          });
        }
      }
    }
    refresh();

    // `let tab = me === null ? 'global' : 'feed'` is state seeded from a
    // loading value: it starts once `me` commits, then is ordinary state.
    const seeds: TransparentStateSeed[] = [];
    for (const declarator of stateSeedDeclarators(ctx, component, componentPath.node)) {
      const name = (declarator.id as t.Identifier).name;
      const init = declarator.init as t.Expression;
      if (names.has(name)) continue;
      replaceDerivedReads(ctx, init as unknown as BaseNode, derived);
      refresh();
      const dependencies = sourceDependencies(ctx, init as unknown as BaseNode, bindings, derived, eventSources);
      // An event-created source is absent until its event; nothing to wait for.
      if (dependencies.length === 0 || dependencies.some(source => eventSources.has(source))) continue;
      const wrapped = resolvedRenderExpression(ctx, init, dependencies, bindings, eventSources, 'deriveResolvedValues');
      overwriteNode(init as unknown as BaseNode, wrapped as unknown as BaseNode);
      seeds.push({ binding: name, sources: dependencies, expression: cloneEstreeNode(wrapped, true) });
    }
    if (seeds.length > 0) {
      ctx.transparentStateSeeds.set(component, seeds);
      refresh();
    }

    gateSourceEffects(ctx, component, bindings, derived, eventSources, refresh);
    refresh();

    // `<TagList tags={article.tags} />` and `<a href={'/' + article.slug}>`
    // appear once `article` commits. An element whose props or attributes read
    // a loading source is itself a read site: in an expression container, the
    // walk below gives it an automatic pending/error site, so a child receives
    // real values and a failed request shows the error policy, not a throw. A
    // prop passing the source itself (`user={article}`) stays the child's to
    // handle; content inside a gated element is covered by its gate.
    // A component bound to planned initial content already renders with its
    // request data resolved; its authored placement must stay as planned.
    const initiallyBound = ctx.initialDomRoot?.component === component ||
      ctx.initialDomComponents[component] !== undefined;
    // Inside `{article.ok ? <A/> : <B/>}` the whole conditional is already one
    // site waiting for `article`; its branches render only once it commits.
    const insideSourceGatedBranch = (element: BaseNode): boolean => {
      for (let child = element, current = ctx.astAnalysis?.parentByNode.get(element) ?? null;
        current !== null && current !== componentNode;
        child = current, current = ctx.astAnalysis?.parentByNode.get(current) ?? null) {
        const selector = astFactory.isConditionalExpression(current as unknown as t.Node)
          ? (current as unknown as t.ConditionalExpression).test
          : astFactory.isLogicalExpression(current as unknown as t.Node)
            ? (current as unknown as t.LogicalExpression).left : null;
        if (selector !== null && (selector as unknown as BaseNode) !== child &&
            sourceDependencies(ctx, selector as unknown as BaseNode, bindings, derived, eventSources).length > 0) return true;
      }
      return false;
    };
    // `return <a href={article.slug}>` from the component itself, not from a callback.
    const isComponentReturn = (parent: BaseNode): boolean => {
      if (parent.type !== 'ReturnStatement') return false;
      let current = ctx.astAnalysis?.parentByNode.get(parent) ?? null;
      while (current !== null && !astFactory.isFunction(current as unknown as t.Node)) {
        current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
      }
      return current === componentNode;
    };
    const gatedElements: Array<{ element: BaseNode; parent: BaseNode; lowered: string[] }> = [];
    if (!initiallyBound) walkAst(componentNode, {
      enter(node, parent) {
        if (node.type !== 'JSXElement' || parent === null) return;
        const placed = parent.type === 'JSXElement' || parent.type === 'JSXFragment' || isComponentReturn(parent);
        if (!placed) return;
        const tag = (node as unknown as t.JSXElement).openingElement.name;
        const host = astFactory.isJSXIdentifier(tag) && !/^[A-Z]/.test(tag.name);
        if (!astFactory.isJSXIdentifier(tag)) return;
        let readsSource = false;
        // Module-source reads the module pass already lowered keep their binding name.
        const lowered = new Set<string>();
        for (const attribute of (node as unknown as t.JSXElement).openingElement.attributes) {
          if (!astFactory.isJSXAttribute(attribute) || !astFactory.isJSXExpressionContainer(attribute.value)) continue;
          const value = attribute.value as unknown as BaseNode;
          if (isEventOrRefContainer(ctx, value) || (!host && isDirectSourceComponentProp(ctx, value, bindings))) continue;
          const expression = childNode(value, 'expression');
          if (expression === null || !astFactory.isExpression(expression as unknown as t.Node)) continue;
          if (sourceDependencies(ctx, expression, bindings, derived, eventSources).length > 0) readsSource = true;
          walkAst(expression, { enter(read) {
            const binding = asyncReadFact(read)?.binding;
            if (binding !== undefined && astBindingAt(ctx, node, binding) !== undefined) lowered.add(binding);
          } });
        }
        if ((!readsSource && lowered.size === 0) || insideSourceGatedBranch(node)) return;
        gatedElements.push({ element: node, parent, lowered: readsSource ? [] : [...lowered] });
        return false;
      },
    });
    for (const { element, parent, lowered } of gatedElements) {
      const site = astFactory.jsxExpressionContainer(element as unknown as t.JSXElement);
      if (lowered.length > 0) wrapAutomaticSite(ctx, component, element as unknown as t.Expression, lowered);
      if (parent.type === 'ReturnStatement') {
        (parent as unknown as t.ReturnStatement).argument = astFactory.jsxFragment(
          astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(), [site]);
        continue;
      }
      const children = (parent as unknown as { children: t.JSXElement['children'] }).children;
      const index = children.indexOf(element as unknown as t.JSXElement);
      if (index !== -1) children[index] = site;
    }
    if (gatedElements.length > 0) refresh();

    walkAst(componentNode, {
      enter(container) {
        const spread = container.type === 'JSXSpreadAttribute';
        if (container.type !== 'JSXExpressionContainer' && !spread) return;
        if (
          isEventOrRefContainer(ctx, container) ||
          isGroupDataContainer(ctx, container) ||
          isDirectSourceComponentProp(
            ctx,
            container,
            bindings,
          )
        ) {
          return false;
        }
        const rawExpression = childNode(container, spread ? 'argument' : 'expression');
        if (
          rawExpression === null ||
          !astFactory.isExpression(rawExpression as unknown as t.Node)
        ) return false;
        const expression = rawExpression as unknown as t.Expression;
        if (
          (expression as t.Expression & {
            __memoDomTransparentGroup?: boolean;
          }).__memoDomTransparentGroup === true
        ) {
          // Group already owns render policy for this whole generated subtree.
          // Flatten local derivations so the structural entity can update
          // without replaying the whole component owner.
          replaceDerivedReads(
            ctx,
            rawExpression,
            derived,
          );
          return false;
        }
        const selector = astFactory.isConditionalExpression(expression) ? expression.test
          : astFactory.isLogicalExpression(expression) ? expression.left : null;
        if (selector !== null && nodeHasJsx(expression) && sourceDependencies(
          ctx, selector as unknown as BaseNode, bindings, derived, eventSources,
        ).length === 0 && trackDependencies(
          ctx, selector as unknown as BaseNode, tracks, bindings, derived,
        ).length === 0) {
          // A local selector chooses the active branch before that branch's
          // payload sinks are evaluated. Descend into those sinks instead of
          // collecting sources from inactive JSX behind one eager gate.
          // Event holders rebind dynamically through the owner's event slot;
          // never subscribe a structural region to their initial null value.
          excludeTransparentSubscriptions(expression, [...eventSources]);
          return undefined;
        }
        const dependencies = sourceDependencies(
          ctx,
          rawExpression,
          bindings,
          derived,
          eventSources,
        );
        const stateDependencies = trackDependencies(
          ctx,
          rawExpression,
          tracks,
          bindings,
          derived,
        );
        if (dependencies.length === 0) {
          if (stateDependencies.length > 0) {
            // Request-state-only scalar derivations must be recomputed in the
            // subscribed render entity. Keeping the local binding here would
            // leave child entities reading the component's initial value.
            replaceDerivedReads(ctx, rawExpression, derived);
            refresh();
            annotateTransparentSources(expression, stateDependencies);
            excludeTransparentSubscriptions(
              expression,
              stateDependencies.filter(source => eventSources.has(source)),
            );
          }
          return undefined;
        }
        const allDependencies = [
          ...new Set([...dependencies, ...stateDependencies]),
        ].sort();
        replaceDerivedReads(
          ctx,
          rawExpression,
          derived,
        );
        refresh();
        const eventDependencies = allDependencies.filter(source =>
          eventSources.has(source)
        );
        // Proven scalar sinks and structural regions keep their authored
        // placement. Gate individual reads rather than adding an automatic
        // region that would invent an unplanned DOM extent.
        const {scalar:fixedInitialSink,structural:fixedInitialStructure}=initialReadPlacement(ctx,component,rawExpression);
        if (
          !fixedInitialSink && !spread && ctx.astAnalysis?.parentByNode.get(container)?.type !== 'JSXAttribute' && (
            nodeHasJsx(rawExpression as unknown as t.Node) ||
            ctx.presentationOwners.has(component) ||
            dependencies.some((source) =>
              ctx.transparentSourceProps.get(component)?.has(source) === true
            )
          )
        ) {
          if (
            fixedInitialStructure || stateDependencies.length > 0 ||
            eventDependencies.length > 0
          ) {
            // Authored control flow driven by request state (RFC §5):
            // the selector and state arms evaluate immediately; payload
            // sinks self-gate per site instead of hiding behind an
            // availability ladder.
            replaceSourceReadsWithRenderGates(
              ctx,
              rawExpression,
              bindings,
              eventSources,
            );
            (expression as RenderGatedExpression).__memoDomRenderGated =
              true;
            annotateTransparentSources(expression, allDependencies);
            excludeTransparentSubscriptions(expression, eventDependencies);
            return false;
          }
          wrapAutomaticSite(ctx, component, expression, dependencies);
          return false;
        }
        const resolved = resolvedRenderExpression(
          ctx,
          expression,
          dependencies,
          bindings,
          eventSources,
        );
        annotateTransparentSources(resolved, allDependencies);
        excludeTransparentSubscriptions(resolved, eventDependencies);
        overwriteNode(rawExpression, resolved as unknown as BaseNode);
        return false;
      },
    });
    refresh();

    const imperativeReads: Array<{ identifier: BaseNode; name: string }> = [];
    walkAst(componentNode, {
      enter(sourceIdentifier) {
        if (sourceIdentifier.type !== 'Identifier') return;
        const name = (sourceIdentifier as unknown as AstIdentifier).name;
        const binding = bindings.get(name);
        if (
          binding === undefined ||
          !isBoundTo(ctx, sourceIdentifier, binding)
        ) return;
        if (
          isPassthroughArgument(ctx, sourceIdentifier) ||
          isEventSourceHolderReference(ctx, sourceIdentifier, eventSources) ||
          isActionRefreshTarget(ctx, sourceIdentifier) ||
          isWithinGroupData(ctx, sourceIdentifier) ||
          isWithinDirectSourceComponentProp(
            ctx,
            sourceIdentifier,
            bindings,
          ) ||
          isInsideRenderGate(ctx, sourceIdentifier) ||
          isGeneratedDataCall(ctx, sourceIdentifier)
        ) {
          return;
        }
        imperativeReads.push({ identifier: sourceIdentifier, name });
      },
    });
    for (const { identifier, name } of imperativeReads) {
      const site = identifier.loc === null || identifier.loc === undefined
        ? ctx.moduleId
        : `${ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
      overwriteNode(
        identifier,
        annotateAsyncRead(astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
          astFactory.identifier(name),
          astFactory.stringLiteral(name),
          astFactory.stringLiteral(site),
        ]),[name],'throw',name) as unknown as BaseNode,
      );
    }
    refresh();
  }
}
