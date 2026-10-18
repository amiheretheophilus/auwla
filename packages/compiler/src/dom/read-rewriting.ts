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
} from '../context';
import { type DomContext as Ctx } from './context';
import { mdd } from './identifiers';
import {annotateAsyncRead, annotateTransparentSources, excludeTransparentSubscriptions} from '../planning/async-reads';
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
  type TransparentDerivation,
} from '../analysis/transparent-reads';
import { summarizeHelper } from '../helper-summaries';
import { isGeneratedDataCall } from './data-read-recognition';
import {
  gateEventSourceEffects,
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
  // Module-scope sources (RFC §16.4): lower refs to materializing reads
  // first so plain sites are safe immediately; derivation roots themselves
  // are skipped by that pass and owned by the derive pass below.
  for (const [componentName, componentPath] of ctx.compPaths) {
    lowerModuleRefReadsEstree(
      ctx,
      componentName,
      componentPath.node as unknown as BaseNode,
      refresh,
    );
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

  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const localNames =
      ctx.transparentSources.get(component) ?? new Set<string>();
    const bindings = sourceBindings(ctx, componentNode, localNames);
    // Seed module-scope source bindings so derivation and container passes
    // treat imported refs like component-local holders (runtime helpers
    // accept ModuleSourceRef uniformly).
    let hasModuleRefs = false;
    for (const name of ctx.transparentModuleSources.keys()) {
      const binding = moduleBinding(componentNode, name);
      if (binding === undefined) continue;
      bindings.set(name, binding);
      hasModuleRefs = true;
    }
    if (localNames.size === 0 && !hasModuleRefs) continue;
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

    gateEventSourceEffects(ctx, component, bindings, eventSources);
    refresh();

    // `<TagList tags={article.tags} />` mounts once `article` commits. A child
    // component whose props read a loading source is itself a read site: in an
    // expression container, the walk below gives it an automatic pending/error
    // site, so the child receives real values. A prop passing the source itself
    // (`user={article}`) stays the child's to handle.
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
    const gatedComponents: Array<{ element: BaseNode; parent: BaseNode }> = [];
    if (!initiallyBound) walkAst(componentNode, {
      enter(node, parent) {
        if (node.type !== 'JSXElement' || parent === null ||
            (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment')) return;
        const tag = (node as unknown as t.JSXElement).openingElement.name;
        if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
        const readsSource = (node as unknown as t.JSXElement).openingElement.attributes.some(attribute => {
          if (!astFactory.isJSXAttribute(attribute) || !astFactory.isJSXExpressionContainer(attribute.value)) return false;
          const value = attribute.value as unknown as BaseNode;
          if (isEventOrRefContainer(ctx, value) || isDirectSourceComponentProp(ctx, value, bindings)) return false;
          const expression = childNode(value, 'expression');
          return expression !== null && astFactory.isExpression(expression as unknown as t.Node) &&
            sourceDependencies(ctx, expression, bindings, derived, eventSources).length > 0;
        });
        if (readsSource && !insideSourceGatedBranch(node)) gatedComponents.push({ element: node, parent });
      },
    });
    for (const { element, parent } of gatedComponents) {
      const children = (parent as unknown as { children: t.JSXElement['children'] }).children;
      const index = children.indexOf(element as unknown as t.JSXElement);
      if (index !== -1) children[index] = astFactory.jsxExpressionContainer(element as unknown as t.JSXElement);
    }
    if (gatedComponents.length > 0) refresh();

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
