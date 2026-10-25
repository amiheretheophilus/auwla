/**
 * Show `items.map((item, index) => <li key={…} …>)` through compiled rows when
 * the call is a text site's whole value (`runtime/src/row-list.ts`), the old
 * compiler's list shape (`wiki/decisions.md`, 2026-10-25).
 *
 * The row list evaluates the element's sites directly for each item instead of
 * calling the callback, and keeps each row's DOM and handlers. That is the same
 * work in the same order only when:
 *
 * - the call is lowered with row reuse (`methods.ts`, `row-reuse.ts`): an arrow
 *   with at most `(item, index)` and no explicit effect, so the runtime proves
 *   the intrinsic `map` before using the list, and the callback runs as written
 *   otherwise;
 * - the arrow's body is one element (no block, no fragment) with one root, so
 *   a row is one node, and its parameters are plain identifiers the row can
 *   assign on each update;
 * - the root's `key`, if any, is its first site, so evaluating the key before
 *   the row keeps the authored order.
 *
 * Nothing here reads the method name; the runtime checks the callee.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { ModulePlan, MutationPlan, RenderValuePlan, RowListPlan, Site } from '../core/plan/model';
import type { Optimization } from '.';

function rowList(site: Site, values: ReadonlyMap<Node, RenderValuePlan>, calls: ReadonlyMap<Node, MutationPlan>): RowListPlan | null {
  if (site.kind !== 'text' || site.primitive || site.spread === true) return null;
  const call = site.expression;
  if (!is.CallExpression(call) || calls.get(call)?.method?.rowReuse === undefined) return null;
  const callback = call.arguments[0];
  if (callback === undefined || !is.ArrowFunctionExpression(callback) || is.BlockStatement(callback.body)) return null;
  if (!callback.params.every((param) => is.Identifier(param))) return null;
  let body: Node = callback.body;
  while (is.ParenthesizedExpression(body)) body = body.expression;
  const row = is.JSXElement(body) ? values.get(body) : undefined;
  if (row === undefined || row.template.roots.length !== 1) return null;
  if (row.template.nodes[row.template.roots[0]!]!.kind !== 'element') return null;
  if (row.keyIndex !== null && row.keyIndex !== 0) return null;
  return { call, callback, row };
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
    const plan = (site: Site) => rowList(site, values, calls);
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
