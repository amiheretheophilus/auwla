/**
 * Show `items.map((item, index) => <li key={…} …>)` through compiled rows when
 * the call is a text site's whole value (`runtime/src/row-list.ts`), the old
 * compiler's list shape (`wiki/decisions.md`, 2026-10-25).
 *
 * The row list evaluates the row's sites directly for each item instead of
 * calling the callback, and keeps each row's DOM and handlers. That is the same
 * work in the same order only when:
 *
 * - the call is lowered with row reuse (`methods.ts`, `row-reuse.ts`): an arrow
 *   with at most `(item, index)` and no explicit effect, so the runtime proves
 *   the intrinsic `map` before using the list, and the callback runs as written
 *   otherwise;
 * - the arrow's body is one JSX element and its parameters are plain
 *   identifiers the row can assign on each update;
 * - the root's `key`, if any, is its first attribute, so evaluating it before
 *   the row keeps the authored order.
 *
 * The element is a host element with one root, or a call of a leaf component
 * (`leafComponent`): one whose instance does nothing but show its props, so its
 * template can be compiled once more as a row that receives the props object.
 *
 * Nothing here reads the method name; the runtime checks the callee.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ComponentPlan, ModulePlan, MutationPlan, RenderValuePlan, RowListPlan, Site } from '../core/plan/model';
import type { FunctionNode } from '../core/resolve/functions';
import { cleanJsxText } from '../core/plan/jsx';
import { isComponentCall } from '../features/components/plan';
import { attributeValue } from '../features/components/dom';
import type { Optimization } from '.';

type Element = Extract<Node, { type: 'JSXElement' }>;

function rowList(site: Site, general: ModulePlan, values: ReadonlyMap<Node, RenderValuePlan>, calls: ReadonlyMap<Node, MutationPlan>): RowListPlan | null {
  if (site.kind !== 'text' || site.primitive || site.spread === true) return null;
  const call = site.expression;
  if (!is.CallExpression(call) || calls.get(call)?.method?.rowReuse === undefined) return null;
  const callback = call.arguments[0];
  if (callback === undefined || !is.ArrowFunctionExpression(callback) || is.BlockStatement(callback.body)) return null;
  if (!callback.params.every((param) => is.Identifier(param))) return null;
  let body: Node = callback.body;
  while (is.ParenthesizedExpression(body)) body = body.expression;
  if (!is.JSXElement(body)) return null;
  const value = values.get(body);
  if (value !== undefined) {
    if (value.template.roots.length !== 1) return null;
    if (value.template.nodes[value.template.roots[0]!]!.kind !== 'element') return null;
    if (value.keyIndex !== null && value.keyIndex !== 0) return null;
    return { call, callback, key: value.keyIndex === null ? null : value.sites[0]!.expression, row: { kind: 'element', value } };
  }
  return componentRow(call, callback, body, general);
}

/** `<Row key={…} a={…} />` with plain attributes, no children, for a leaf component. */
function componentRow(
  call: RowListPlan['call'], callback: RowListPlan['callback'], element: Element, general: ModulePlan,
): RowListPlan | null {
  if (!isComponentCall(element) || !is.JSXIdentifier(element.openingElement.name)) return null;
  if (element.children.some((child) => !is.JSXText(child) || cleanJsxText(child.value) !== '')) return null;
  const attributes = element.openingElement.attributes;
  const named: { name: string; value: RowListPlan['key'] & object }[] = [];
  for (const attribute of attributes) {
    if (!is.JSXAttribute(attribute) || !is.JSXIdentifier(attribute.name)) return null;
    const name = attribute.name.name;
    // `suspend` is readiness and `children` is overridden by content: both keep
    // the general component value.
    if (name === 'suspend' || name === 'children') return null;
    named.push({ name, value: attributeValue(attribute.value) });
  }
  const keys = named.filter((attribute) => attribute.name === 'key');
  if (keys.length > 1 || (keys.length === 1 && named[0]!.name !== 'key')) return null;
  const fn = leafComponent(element.openingElement.name, general);
  if (fn === null) return null;
  return {
    call, callback, key: keys[0]?.value ?? null,
    row: { kind: 'component', component: fn, props: named.filter((attribute) => attribute.name !== 'key') },
  };
}

/**
 * A module-level component declaration, never reassigned, whose instance only
 * shows its props: no setup statements, local state, derivations, writes,
 * edits, takeovers or refs, at most one plain `props` parameter, and one
 * element root. Compiled again at module level, its names resolve as written.
 */
function leafComponent(tag: Extract<Node, { type: 'JSXIdentifier' }>, general: ModulePlan): FunctionNode | null {
  const module = general.module.module;
  const binding = module.referenceOf(tag)?.binding;
  if (binding === null || binding === undefined || binding.references.some((reference) => reference.isWrite)) return null;
  const declaration = binding.declarations[0];
  let found: [FunctionNode, ComponentPlan] | undefined;
  for (const [fn, plan] of general.components) {
    if (is.FunctionDeclaration(fn) && fn.id === declaration) found = [fn, plan];
  }
  if (found === undefined) return null;
  const [fn, plan] = found;
  if ([...module.ancestors(fn)].some((ancestor) => ancestor !== fn && is.Function(ancestor))) return null;
  if (fn.async || fn.generator || fn.params.length > 1 || (fn.params.length === 1 && !is.Identifier(fn.params[0]))) return null;
  const idle = plan.setup.length === 0 && plan.deferred.size === 0 && plan.memos.length === 0
    && plan.writes.length === 0 && plan.replayWrites.length === 0 && plan.mutations.length === 0
    && plan.replayMutations.length === 0 && plan.takeovers.length === 0 && plan.readonlyBindings.length === 0
    && plan.mutationRoots.length === 0 && plan.state.every((state) => state.kind === 'Prop');
  if (!idle || plan.template.roots.length !== 1) return null;
  if (plan.template.nodes[plan.template.roots[0]!]!.kind !== 'element') return null;
  if (plan.sites.some((site) => (site.kind === 'attribute' || site.kind === 'property') && site.name === 'ref')) return null;
  return fn;
}

function rowSites(sites: readonly Site[], plan: (site: Site) => RowListPlan | null, found: Set<Node>): readonly Site[] {
  let changed = false;
  const next = sites.map((site): Site => {
    if (site.kind === 'conditional') {
      const branches = site.branches.map((branch) => {
        const nested = rowSites(branch.sites, plan, found);
        return nested === branch.sites ? branch : { ...branch, sites: nested };
      });
      if (branches.every((branch, index) => branch === site.branches[index])) return site;
      changed = true;
      return { ...site, branches };
    }
    const rows = plan(site);
    if (rows === null || site.kind !== 'text') return site;
    changed = true;
    found.add(rows.call);
    return { ...site, listStrategy: 'rows', rows };
  });
  return changed ? next : sites;
}

function markCalls(plans: readonly MutationPlan[], found: ReadonlySet<Node>): readonly MutationPlan[] {
  let changed = false;
  const next = plans.map((plan) => {
    if (plan.method === undefined || !found.has(plan.operation)) return plan;
    changed = true;
    return { ...plan, method: { ...plan.method, rowList: true } };
  });
  return changed ? next : plans;
}

export const rowLists: Optimization = {
  name: 'row-lists',
  match(general: ModulePlan): ModulePlan | null {
    const values = new Map(general.values.map((value) => [value.node as Node, value]));
    const calls = new Map<Node, MutationPlan>();
    for (const owner of [...general.components.values(), ...general.sharedOwners]) {
      for (const mutation of owner.mutations) calls.set(mutation.operation, mutation);
    }
    const found = new Set<Node>();
    const plan = (site: Site) => rowList(site, general, values, calls);
    // Only a component's own sites: the row is declared where its callback is
    // evaluated, in the component's scope. Rows inside stored JSX stay general.
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const sites = rowSites(component.sites, plan, found);
      if (sites !== component.sites) components.set(fn, { ...component, sites });
    }
    if (found.size === 0) return null;
    for (const [fn, component] of components) {
      const mutations = markCalls(component.mutations, found);
      if (mutations !== component.mutations) components.set(fn, { ...component, mutations });
    }
    const sharedOwners = general.sharedOwners.map((owner) => {
      const mutations = markCalls(owner.mutations, found);
      return mutations === owner.mutations ? owner : { ...owner, mutations };
    });
    return { ...general, components, sharedOwners };
  },
};
