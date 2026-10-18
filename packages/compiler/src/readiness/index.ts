/**
 * Readiness: code that depends on a loading source waits for it.
 *
 * Each payload read of a source belongs to the innermost sink around it, and
 * the sink decides how it waits:
 *
 *   derivation    value is undefined until its sources commit
 *   chained call  an idle source until its inputs commit
 *   state seed    applied once its sources commit
 *   effect        first runs once its sources commit, and on each commit
 *   render site   scalar: empty while pending; structural: pending/error
 *                 presentation; control flow: each read self-gates
 *   anything else a throwing read, valid only once committed
 *
 * Reads of a derivation inside a sink are inlined, so the sink observes its
 * sources' status directly. Every decision is taken on the untouched tree;
 * edits are applied once at the end.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  cloneNode,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
} from '../ast';
import { astBindingAt, nodeHasJsx, refreshAstAnalysis, type TransparentStateSeed } from '../context';
import { type DomContext as Ctx } from '../dom/context';
import { mdd } from '../dom/identifiers';
import { annotateTransparentSources, asyncReadFact, excludeTransparentSubscriptions } from '../planning/async-reads';
import { automaticSiteExpression } from '../dom/data-sites';
import { initialReadPlacement } from '../dom/initial-dom';
import { trackDependencies } from './tracks';
import type { RenderGatedExpression } from '../dom/data-subscriptions';
import { matchMapCall } from '../lists';
import type { TransparentDerivation } from '../analysis/transparent-reads';
import { dependencies, readFacts, type ReadFacts } from './facts';
import { Lowering, RENDER, THROW } from './lower';
import { lowerHelperPayloadReads, normalizeSourceReturns } from './normalize';

export function lowerSourceReads(ctx: Ctx): void {
  const refresh = (): void => {
    const root = ctx.astAnalysis?.rootScope.block;
    if (root !== undefined) refreshAstAnalysis(ctx, root);
  };
  // Facts are read from a fresh index of the normalized tree.
  lowerHelperPayloadReads(ctx);
  refresh();
  if (normalizeSourceReturns(ctx)) refresh();
  const edits = new Map<BaseNode, BaseNode>();
  const after: Array<() => void> = [];
  for (const [component, componentPath] of ctx.compPaths) {
    const facts = readFacts(ctx, component, componentPath.node);
    if (facts !== null) planComponent(ctx, facts, edits, after);
  }
  for (const [target, replacement] of edits) overwriteNode(target, replacement);
  for (const annotate of after) annotate();
  refresh();
}

function planComponent(ctx: Ctx, facts: ReadFacts, edits: Map<BaseNode, BaseNode>, after: Array<() => void>): void {
  const { component } = facts;
  const lower = new Lowering(ctx, facts);
  const componentNode = facts.node as unknown as BaseNode;
  const events = new Set([...facts.sources.values()].filter(source => source.event).map(source => source.name));
  const claimed = new Set<BaseNode>();
  const claim = (target: BaseNode, replacement: BaseNode): void => {
    claimed.add(target);
    edits.set(target, replacement);
  };
  ctx.usesTransparentData = true;

  const bindings = new Map<string, AstBinding>([...facts.sources].map(([name, source]) => [name, source.binding]));
  const derived = new Map<string, TransparentDerivation>();
  for (const derivation of facts.derivations) {
    if (derivation.authored.replay !== undefined) continue;
    for (const name of derivation.names) {
      const binding = astBindingAt(ctx, componentNode, name);
      if (binding !== undefined) derived.set(name, {
        binding, sources: derivation.sources, expression: derivation.init,
        ...(derivation.requestStateOnly ? { requestStateOnly: true } : {}),
      });
    }
  }
  const stateDependencies = (root: BaseNode): string[] =>
    trackDependencies(ctx, root, facts.tracks, bindings, derived);
  const containsDerivedRef = (root: BaseNode): boolean => {
    let found = false;
    walkAst(root, { enter(current) {
      if (found) return false;
      if (facts.derivedRefs.has(current)) found = true;
    } });
    return found;
  };
  /**
   * Throwing reads and inlined derivations as leaf edits: every other authored
   * node keeps its identity, which earlier passes' plans are keyed by.
   */
  const lowerLeaves = (root: BaseNode): void => {
    claimed.add(root);
    walkAst(root, { enter(current) {
      if (asyncReadFact(current) !== undefined) return false;
      if (facts.derivedRefs.has(current) || facts.occurrences.get(current)?.holder === 'none') {
        edits.set(current, lower.copy(current, THROW));
        return false;
      }
    } });
  };

  // Derivations: `const title = shout(article.title)` is undefined until
  // `article` commits; a request built from it does not start until then.
  for (const derivation of facts.derivations) {
    const { authored, init } = derivation;
    const initNode = init as unknown as BaseNode;
    if (derivation.requestStateOnly) {
      lowerLeaves(initNode);
      authored.source = lower.copy(init, THROW);
      continue;
    }
    const gate = lower.gate('deriveResolvedValues', derivation.sources, init);
    if (authored.replay !== undefined) {
      // `$fetch('/api/comments/' + article.slug)`: until `article` commits the
      // binding holds an idle source; each commit replays the owner, whose
      // replay rebinds the request.
      const idle = astFactory.logicalExpression('??', gate,
        astFactory.callExpression(mdd(ctx, 'createBodylessSource'), [astFactory.nullLiteral()]));
      claim(initNode, idle as unknown as BaseNode);
      authored.replay = { ...authored.replay, gate: cloneNode(gate, true) };
      authored.source = cloneNode(idle, true);
      const followed = derivation.sources.filter(source => !events.has(source));
      if (followed.length > 0) {
        const owner = ctx.transparentOwnerSources.get(component) ?? new Set<string>();
        for (const source of followed) owner.add(source);
        ctx.transparentOwnerSources.set(component, owner);
      }
      continue;
    }
    claim(initNode, gate as unknown as BaseNode);
    authored.source = cloneNode(gate, true);
  }

  // `let tab = me === null ? 'global' : 'feed'` is state seeded from a loading
  // value: it starts once `me` commits, then is ordinary state.
  const seeds: TransparentStateSeed[] = [];
  for (const declarator of facts.seeds) {
    const init = declarator.init as t.Expression;
    const initNode = init as unknown as BaseNode;
    const sources = dependencies(facts, initNode);
    // An event-created source is absent until its event; nothing to wait for.
    if (sources.length === 0 || sources.some(source => events.has(source))) {
      if (containsDerivedRef(initNode)) lowerLeaves(initNode);
      continue;
    }
    const gate = lower.gate('deriveResolvedValues', sources, init);
    claim(initNode, gate as unknown as BaseNode);
    seeds.push({ binding: (declarator.id as t.Identifier).name, sources, expression: cloneNode(gate, true) });
  }
  if (seeds.length > 0) ctx.transparentStateSeeds.set(component, seeds);

  // An effect reading a loading value first runs once it commits.
  for (const site of ctx.effects.get(component) ?? []) {
    const callback = site.callback;
    if (!astFactory.isArrowFunctionExpression(callback) && !astFactory.isFunctionExpression(callback)) continue;
    const sources = dependencies(facts, callback as unknown as BaseNode);
    if (sources.length === 0) continue;
    claimed.add(callback as unknown as BaseNode);
    const mounted = sources.filter(source => !events.has(source));
    if (mounted.length > 0) site.transparentSources = mounted;
    const run = lower.resolvedCallback(sources, callback.body);
    const gated = astFactory.arrowFunctionExpression([], astFactory.callExpression(
      mdd(ctx, 'runResolvedValuesEffect'), [astFactory.arrayExpression(sources.map(source => astFactory.identifier(source))), run]));
    ctx.compilerOwnedCallbacks.add(gated);
    site.callback = gated;
  }

  const presentation = ctx.presentationOwners.has(component);
  const transported = ctx.transparentSourceProps.get(component);

  /**
   * Authored control flow: the selector evaluates now; each payload read
   * self-gates. Edited in place, so the branches' JSX and lists stay authored.
   */
  const renderGate = (raw: t.Expression): void => {
    const rawNode = raw as unknown as BaseNode;
    claimed.add(rawNode);
    const scalars = new Set<BaseNode>();
    walkAst(rawNode, { enter(current) {
      if (astFactory.isFunction(current as unknown as t.Node)) return false;
      // JSX maps belong to structural list lowering; their receiver reads
      // self-gate below instead of hiding the list behind a scalar gate.
      if (astFactory.isCallExpression(current as unknown as t.Node) &&
        matchMapCall(current as unknown as t.CallExpression) && nodeHasJsx(current as unknown as t.Node)) return false;
      if (facts.skippedContainers.has(current)) return false;
      if (!astFactory.isExpression(current as unknown as t.Node) || nodeHasJsx(current as unknown as t.Node)) return;
      if (dependencies(facts, current).length > 0) scalars.add(current);
      return false;
    } });
    // Lazy control flow: only the selected arm consumes its payload, and a
    // selector waits for its own inputs, not both arms.
    const gateScalar = (expression: t.Expression): t.Expression => {
      if (astFactory.isConditionalExpression(expression)) {
        const selector = dependencies(facts, expression.test as unknown as BaseNode);
        const built = astFactory.conditionalExpression(expression.test,
          gateScalar(expression.consequent), gateScalar(expression.alternate));
        return selector.length === 0 ? lower.copy(built, RENDER) : lower.gate('readResolvedValuesForRender', selector, built);
      }
      if (astFactory.isLogicalExpression(expression)) {
        const selector = dependencies(facts, expression.left as unknown as BaseNode);
        const built = astFactory.logicalExpression(expression.operator, expression.left, gateScalar(expression.right));
        return selector.length === 0 ? lower.copy(built, RENDER) : lower.gate('readResolvedValuesForRender', selector, built);
      }
      const sources = dependencies(facts, expression as unknown as BaseNode);
      return sources.length === 0 ? lower.copy(expression, RENDER) : lower.gate('readResolvedValuesForRender', sources, expression);
    };
    walkAst(rawNode, { enter(current) {
      if (asyncReadFact(current) !== undefined) return false;
      if (scalars.has(current)) {
        edits.set(current, gateScalar(current as unknown as t.Expression) as unknown as BaseNode);
        return false;
      }
      if (facts.derivedRefs.has(current) || facts.occurrences.get(current)?.holder === 'none') {
        edits.set(current, lower.copy(current, RENDER));
        return false;
      }
    } });
  };

  /** A render site reading sources: waits for them, or descends into its parts. */
  const renderSite = (raw: t.Expression, spread: boolean, attribute: boolean): 'descend' | 'done' => {
    const rawNode = raw as unknown as BaseNode;
    if ((raw as t.Expression & { __memoDomTransparentGroup?: boolean }).__memoDomTransparentGroup === true) {
      // A group already owns this subtree's render policy; its content runs
      // only once committed.
      lowerLeaves(rawNode);
      return 'done';
    }
    const selector = astFactory.isConditionalExpression(raw) ? raw.test
      : astFactory.isLogicalExpression(raw) ? raw.left : null;
    if (selector !== null && nodeHasJsx(raw) &&
        dependencies(facts, selector as unknown as BaseNode).length === 0 &&
        stateDependencies(selector as unknown as BaseNode).length === 0) {
      // A local selector picks the branch before its payload sinks run:
      // descend into those sinks. Event holders rebind through the owner's
      // event slot; never subscribe a region to their initial null value.
      excludeTransparentSubscriptions(raw, [...events]);
      return 'descend';
    }
    const sources = dependencies(facts, rawNode);
    const states = stateDependencies(rawNode);
    if (sources.length === 0) {
      if (states.length > 0) {
        // Request-state-only derivations recompute in the subscribed render
        // entity; the component's initial value would go stale there.
        walkAst(rawNode, { enter(current) {
          if (facts.derivedRefs.has(current)) {
            edits.set(current, lower.copy(current, THROW));
            return false;
          }
        } });
        after.push(() => {
          annotateTransparentSources(raw, states);
          excludeTransparentSubscriptions(raw, states.filter(source => events.has(source)));
        });
      }
      return 'descend';
    }
    const all = [...new Set([...sources, ...states])].sort();
    const eventSources = all.filter(source => events.has(source));
    const placement = initialReadPlacement(ctx, component, rawNode);
    if (!placement.scalar && !spread && !attribute &&
        (nodeHasJsx(raw) || presentation || sources.some(source => transported?.has(source) === true))) {
      if (placement.structural || states.length > 0 || eventSources.length > 0) {
        renderGate(raw);
        after.push(() => {
          (raw as RenderGatedExpression).__memoDomRenderGated = true;
          annotateTransparentSources(raw, all);
          excludeTransparentSubscriptions(raw, eventSources);
        });
        return 'done';
      }
      claim(rawNode, automaticSiteExpression(ctx, component, lower.copy(raw, THROW), sources) as unknown as BaseNode);
      return 'done';
    }
    const built = lower.gate('readResolvedValuesForRender', sources, raw);
    annotateTransparentSources(built, all);
    excludeTransparentSubscriptions(built, eventSources);
    claim(rawNode, built as unknown as BaseNode);
    return 'done';
  };

  // A component bound to planned initial content renders with its request
  // data resolved; its authored element placement stays as planned.
  const initiallyBound = ctx.initialDomRoot?.component === component || ctx.initialDomComponents[component] !== undefined;
  const isComponentReturn = (parent: BaseNode): boolean => {
    if (parent.type !== 'ReturnStatement') return false;
    let current = facts.parents.get(parent) ?? null;
    while (current !== null && !astFactory.isFunction(current as unknown as t.Node)) current = facts.parents.get(current) ?? null;
    return current === componentNode;
  };
  /** `<TagList tags={article.tags} />`: an element whose attributes read a source is a read site. */
  const readsInAttributes = (element: t.JSXElement): boolean => element.openingElement.attributes.some(attribute => {
    if (!astFactory.isJSXAttribute(attribute) || !astFactory.isJSXExpressionContainer(attribute.value)) return false;
    const value = attribute.value as unknown as BaseNode;
    if (facts.skippedContainers.has(value)) return false;
    const expression = childNode(value, 'expression');
    return expression !== null && astFactory.isExpression(expression as unknown as t.Node) &&
      dependencies(facts, expression).length > 0;
  });

  walkAst(componentNode, {
    enter(current, parent) {
      if (claimed.has(current)) return false;
      if (current.type === 'JSXElement' && parent !== null && !initiallyBound) {
        const element = current as unknown as t.JSXElement;
        const placed = parent.type === 'JSXElement' || parent.type === 'JSXFragment' || isComponentReturn(parent);
        if (placed && astFactory.isJSXIdentifier(element.openingElement.name) && readsInAttributes(element)) {
          renderSite(element as unknown as t.Expression, false, false);
          // The element object stays (call policies are keyed by it); a new
          // container in its parent's slot makes it an expression site.
          after.unshift(() => {
            const site = astFactory.jsxExpressionContainer(element);
            if (parent.type === 'ReturnStatement') {
              (parent as unknown as t.ReturnStatement).argument = astFactory.jsxFragment(
                astFactory.jsxOpeningFragment(), astFactory.jsxClosingFragment(), [site]);
              return;
            }
            const children = (parent as unknown as { children: t.JSXElement['children'] }).children;
            const index = children.indexOf(element);
            if (index !== -1) children[index] = site;
          });
          return false;
        }
      }
      const spread = current.type === 'JSXSpreadAttribute';
      if (current.type !== 'JSXExpressionContainer' && !spread) return;
      if (facts.skippedContainers.has(current)) return false;
      const raw = childNode(current, spread ? 'argument' : 'expression');
      if (raw === null || !astFactory.isExpression(raw as unknown as t.Node)) return false;
      return renderSite(raw as unknown as t.Expression, spread, parent?.type === 'JSXAttribute') === 'descend' ? undefined : false;
    },
  });

  // Everything else reads a committed value or throws to the nearest boundary.
  walkAst(componentNode, {
    enter(current) {
      if (claimed.has(current) || asyncReadFact(current) !== undefined) return false;
      if (facts.occurrences.get(current)?.holder === 'none' && !edits.has(current)) {
        edits.set(current, lower.copy(current, THROW));
      }
    },
  });
}
