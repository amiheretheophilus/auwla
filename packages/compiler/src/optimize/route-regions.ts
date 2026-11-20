/**
 * A route region, `<X route="/p" />`, is lowered to `{$routeRegion(id) && <X key={$routeRegion(id)} />}`
 * (`features/routes/lower.ts`), which the general path shows as a conditional region: a branch
 * holding a value slot for the component, a branch writing the falsy left side as text, and, with
 * source readiness, a branch for a pending selector. About 65 lines per route.
 *
 * `routeRegion` returns the region's identity, a string, or null (`router/src/internal.ts`). So
 * the falsy branch only ever writes nothing, and the selector never waits. Shown as one value slot
 * instead, the same expression gives null or the component: null renders nothing, and a new key
 * mounts the component afresh, as a new branch did. The slot keeps the conditional's placeholder.
 *
 * Proof conditions: the selection is `left && …` whose left is a call of `routeRegion` imported
 * from the router, and the branch it picks shows one value site, a component element. Anything
 * else keeps the general path.
 */
import { is, walk } from 'yuku-ast';
import type { Binding, Module } from 'yuku-analyzer';
import type { Expression, Node } from 'yuku-parser';
import type { BindingNode } from '../core/graph';
import type { ComponentPlan, ConditionalBranch, ConditionalSite, ModulePlan, Site, TextSite } from '../core/plan/model';
import { intrinsicTag, unwrap } from '../core/plan/jsx';
import { importOf } from '../core/resolve/exports';
import type { Optimization } from '.';

const ROUTER_INTERNAL = '@memoized-dom/router/internal';

/** The inner site's expression for each replaced region, whose inputs the region takes. */
type Merged = Map<Expression, Expression>;

/** A call of the router's `routeRegion`, by binding. */
function routeRegionCall(module: Module, node: Node): boolean {
  const call = unwrap(node as Expression);
  if (!is.CallExpression(call) || !is.Identifier(call.callee)) return false;
  const binding = module.referenceOf(call.callee)?.binding ?? null;
  const imported = binding === null ? undefined : importOf(binding);
  return imported?.specifier === ROUTER_INTERNAL && imported.name === 'routeRegion';
}

/** The value site of a branch that shows one component element and nothing else. */
function componentValue(branch: ConditionalBranch | undefined): TextSite | null {
  if (branch?.template === null || branch === undefined) return null;
  if (branch.template.roots.length !== 1 || branch.sites.length !== 1) return null;
  const site = branch.sites[0]!;
  if (site.kind !== 'text' || site.node !== branch.template.roots[0] || site.spread === true || site.parts !== undefined) {
    return null;
  }
  const element = unwrap(site.expression);
  return is.JSXElement(element) && intrinsicTag(element) === null ? site : null;
}

/** The bindings an expression reads by name. */
function bindingsRead(module: Module, expression: Node): Set<Binding> {
  const read = new Set<Binding>();
  walk(expression, { enter: (node) => {
    if (!is.Identifier(node)) return;
    const binding = module.referenceOf(node)?.binding ?? null;
    if (binding !== null) read.add(binding);
  } });
  return read;
}

function routeRegion(
  module: Module,
  site: ConditionalSite,
  siteInputs: ComponentPlan['siteInputs'],
): { readonly region: TextSite; readonly inner: Expression } | null {
  const selection = site.selection;
  if (selection.kind !== 'logical' || selection.operator !== '&&' || selection.right.kind !== 'branch') return null;
  if (!routeRegionCall(module, selection.left)) return null;

  const inner = componentValue(site.branches[selection.right.index]);
  if (inner === null) return null;

  // The component's props matter only while the region shows it: unmatched, the value is the
  // left side's null, whatever they are. What the region id reads (a route context) always counts.
  const left = bindingsRead(module, selection.left);
  const whileShown = (siteInputs.get(inner.expression) ?? []).filter((input) => !left.has(input.binding));

  return {
    region: {
      kind: 'text', node: site.node, expression: site.expression, reactive: site.reactive, primitive: false,
      ...(whileShown.length === 0 ? {} : { whileShown }),
    },
    inner: inner.expression,
  };
}

/** Replace route regions in a view, and in the branches of its other conditionals. */
function replaceSites(module: Module, sites: readonly Site[], merged: Merged, siteInputs: ComponentPlan['siteInputs']): readonly Site[] {
  let changed = false;
  const next = sites.map((site): Site => {
    if (site.kind !== 'conditional') return site;

    const replaced = routeRegion(module, site, siteInputs);
    if (replaced !== null) {
      changed = true;
      merged.set(site.expression, replaced.inner);
      return replaced.region;
    }

    const branches = site.branches.map((branch): ConditionalBranch => {
      const nested = replaceSites(module, branch.sites, merged, siteInputs);
      return nested === branch.sites ? branch : { ...branch, sites: nested };
    });
    if (branches.every((branch, index) => branch === site.branches[index])) return site;
    changed = true;
    return { ...site, branches };
  });
  return changed ? next : sites;
}

/** The region's site takes what its component's site read, and its collector. */
function withMergedInputs(component: ComponentPlan, merged: Merged): Partial<ComponentPlan> {
  const siteInputs = new Map(component.siteInputs);
  const dynamicSites = new Set(component.dynamicSites);

  for (const [region, inner] of merged) {
    const inputs = new Set<BindingNode>([...siteInputs.get(region) ?? [], ...siteInputs.get(inner) ?? []]);
    siteInputs.set(region, [...inputs]);
    // A route region always reads the router through its collector.
    dynamicSites.add(region);
  }
  return { siteInputs, dynamicSites };
}

export const routeRegions: Optimization = {
  name: 'route-regions',
  match(general: ModulePlan): ModulePlan | null {
    const module = general.module.module;
    let changed = false;
    const components = new Map(general.components);

    for (const [fn, component] of general.components) {
      const merged: Merged = new Map();
      const sites = replaceSites(module, component.sites, merged, component.siteInputs);
      if (sites === component.sites) continue;

      changed = true;
      components.set(fn, { ...component, sites, ...withMergedInputs(component, merged) });
    }

    return changed ? { ...general, components } : null;
  },
};
