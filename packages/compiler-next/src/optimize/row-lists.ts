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
 *   with at most `(item, index)` and no explicit effect;
 * - the arrow's body is one JSX element and its parameters are plain
 *   identifiers the row can assign on each update;
 * - the root's `key`, if any, is its first attribute, so evaluating it before
 *   the row keeps the authored order.
 *
 * The element is a host element with one root, or a call of a leaf component
 * (`leafComponent`): one whose instance does nothing but show its props, so its
 * template can be compiled once more as a row that receives the props object.
 *
 * The list replaces the callback, so its stored JSX is not emitted at all.
 */
import type { Binding, Module } from 'yuku-analyzer';
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../core/graph';
import { qualifies } from './keyed-comparisons';
import type { ComponentPlan, ModulePlan, MutationPlan, RenderValuePlan, RowListPlan, Site } from '../core/plan/model';
import type { FunctionNode } from '../core/resolve/functions';
import { cleanJsxText, unwrap } from '../core/plan/jsx';
import { destructuredProps, isComponentCall } from '../features/components/plan';
import { attributeValue } from '../features/components/dom';
import { hasDynamicScope } from './closed-lists';
import type { Optimization } from '.';

type Element = Extract<Node, { type: 'JSXElement' }>;
type RowProp = Extract<RowListPlan['row'], { kind: 'component' }>['props'][number];

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
    return { call, callback, key: value.keyIndex === null ? null : value.sites[0]!.expression, routes: [], row: { kind: 'element', value } };
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
    call, callback, key: keys[0]?.value ?? null, routes: [],
    row: { kind: 'component', component: fn, props: named.filter((attribute) => attribute.name !== 'key') },
  };
}

/**
 * A module-level component declaration, never reassigned, whose instance only
 * shows its props: no setup statements, local state, derivations, writes,
 * takeovers or refs, no edits except of its props inside its handlers, at most
 * one parameter, either a plain `props` or a plain destructuring of it
 * (`destructuredProps`), and one element root. Compiled again at module level,
 * its names resolve as written.
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
  if (fn.async || fn.generator || fn.params.length > 1) return null;
  const param = fn.params[0];
  if (param !== undefined && !is.Identifier(param) && destructuredProps(param) === null) return null;
  // Edits of its props made by its handlers (`props.select(id)` passes `props`
  // as `this`) stay observed in the row; they re-render the list
  // (`core/emit/row-list.ts`). Nothing may edit them while the row renders.
  const inHandler = (operation: Node) => [...module.ancestors(operation)]
    .some((ancestor) => ancestor !== fn && is.Function(ancestor) && ancestor.start >= fn.start && ancestor.end <= fn.end);
  const handlerEdits = plan.mutations.every((mutation) => inHandler(mutation.operation)
    && mutation.targets.every((target) => target.binding.kind === 'Prop' && plan.state.includes(target.binding)));
  const idle = plan.setup.length === 0 && plan.deferred.size === 0 && plan.memos.length === 0
    && plan.writes.length === 0 && plan.replayWrites.length === 0 && handlerEdits
    && plan.replayMutations.length === 0 && plan.takeovers.length === 0 && plan.readonlyBindings.length === 0
    && plan.mutationRoots.length === 0 && plan.state.every((state) => state.kind === 'Prop');
  if (!idle || plan.template.roots.length !== 1) return null;
  if (plan.template.nodes[plan.template.roots[0]!]!.kind !== 'element') return null;
  if (plan.sites.some((site) => (site.kind === 'attribute' || site.kind === 'property') && site.name === 'ref')) return null;
  return fn;
}

/** The same member chain on the callback's first parameter (`row.id` and `row.id`). */
function sameChain(module: Module, left: Node, right: Node, param: Binding): boolean {
  if (is.Identifier(left) && is.Identifier(right)) {
    return module.referenceOf(left)?.binding === param && module.referenceOf(right)?.binding === param;
  }
  if (!is.MemberExpression(left) || !is.MemberExpression(right) || left.computed || right.computed
    || left.optional || right.optional || !is.Identifier(left.property) || !is.Identifier(right.property)
    || left.property.name !== right.property.name) return false;
  return sameChain(module, left.object, right.object, param);
}

/**
 * Substitute a leaf's prop with the authored row prop it holds: `props.item` read
 * through the object, or `item` destructured from it.
 */
function componentKey(module: Module, node: Node, key: Node, rows: RowListPlan, param: Binding): boolean {
  if (rows.row.kind !== 'component') return false;
  const { component, props: rowProps } = rows.row;
  const parameter = component.params[0];
  if (parameter === undefined) return false;

  const propNamed = (name: string) => rowProps.find((prop) => prop.name === name);
  const propsObject = is.Identifier(parameter)
    ? module.bindings.find((candidate) => candidate.declarations[0] === parameter)
    : undefined;
  const fields = destructuredProps(parameter);

  const holdsKey = (prop: RowProp | undefined, right: Node): boolean => {
    return prop !== undefined && sameChain(module, prop.value, right, param);
  };

  const match = (left: Node, right: Node): boolean => {
    if (is.Identifier(left)) {
      const declared = module.referenceOf(left)?.binding?.declarations[0];
      const field = fields?.find((candidate) => candidate.local === declared);
      return field !== undefined && holdsKey(propNamed(field.key), right);
    }
    if (!is.MemberExpression(left) || left.computed || left.optional || !is.Identifier(left.property)) return false;
    if (propsObject !== undefined && is.Identifier(left.object) && module.referenceOf(left.object)?.binding === propsObject) {
      return holdsKey(propNamed(left.property.name), right);
    }
    return is.MemberExpression(right) && !right.computed && !right.optional && is.Identifier(right.property)
      && left.property.name === right.property.name && match(left.object, right.object);
  };
  return match(node, key);
}

/**
 * Route `selected === row.id` by key (`RowListPlan.routes`): the comparison
 * qualifies as keyed (`keyed-comparisons.ts`: `===`/`!==`, a tracked binding
 * read first, an effect-free right side), it is part of the row, and its right
 * side is the key expression itself. Where the binding is the component's own
 * state and every read of it in the site is routed, the site no longer takes
 * it as an input: the list refreshes the affected rows instead.
 */
function withRoutes(
  rows: RowListPlan, site: Site, general: ModulePlan, component: ComponentPlan,
  inputs: Map<Node, readonly BindingNode[]>, routed: Map<Node, BindingNode>,
): RowListPlan {
  const module = general.module.module;
  const param = rows.callback.params[0];
  if (rows.key === null || param === undefined) return rows;
  const parameter = module.bindings.find((binding) => binding.declarations[0] === param);
  if (parameter === undefined) return rows;
  const row = rows.row;
  const regions: Node[] = row.kind === 'element'
    ? row.value.sites.filter((_, index) => index !== row.value.keyIndex).map((entry) => entry.expression)
    : row.props.map((prop) => prop.value);
  const reads: { node: Node; binding: BindingNode }[] = [];
  const collect = (regions: readonly Node[], fn: FunctionNode, owner: ComponentPlan) => {
    // A handler's later read does not participate in rendering this row.
    const within = (node: Node) => regions.some((region) => node.start >= region.start && node.end <= region.end)
      && [...module.ancestors(node)].find((ancestor) => is.Function(ancestor)) === fn;
    for (const read of general.sharedReads.values()) {
      if (read.binding.binding.module !== module) continue;
      for (const reference of read.binding.binding.references) {
        if (!reference.isWrite && !reference.inTypePosition && within(reference.node)) reads.push({ node: reference.node, binding: read.binding });
      }
    }
    for (const read of owner.trackedReads) if (within(read.node)) reads.push(read);
  };
  collect(regions, rows.callback, component);
  if (row.kind === 'component') {
    const leaf = general.components.get(row.component)!;
    collect(leaf.sites.map((site) => site.expression), row.component, leaf);
  }
  const routes: RowListPlan['routes'][number][] = [];
  for (const { node, binding } of reads) {
    const comparison = qualifies(module, node, binding.binding);
    if (comparison === null || !is.BinaryExpression(comparison)
      || (!sameChain(module, comparison.right, rows.key, parameter)
        && !componentKey(module, comparison.right, rows.key, rows, parameter))) continue;
    routes.push({ node: comparison, binding });
    routed.set(comparison, binding);
  }
  for (const binding of new Set(routes.map((route) => route.binding))) {
    const uses = binding.binding.references.filter((reference) => !reference.isWrite
      && reference.node.start >= site.expression.start && reference.node.end <= site.expression.end);
    const current = inputs.get(site.expression);
    if (current !== undefined && uses.every((reference) => routes.some((route) => route.node.left === reference.node))) {
      inputs.set(site.expression, current.filter((input) => input !== binding));
    }
  }
  return routes.length === 0 ? rows : { ...rows, routes };
}

/**
 * Whether the only uses of this leaf are rows, each compiled from its own factory. Nothing
 * can then call the component itself, so it is not emitted. An export, a read of its
 * name, a tag anywhere else, or a module that can reach names dynamically keeps it.
 */
function shownOnlyAsRows(module: Module, fn: FunctionNode, rowElements: ReadonlySet<Node>): boolean {
  if (!is.FunctionDeclaration(fn) || fn.id === null || hasDynamicScope(module)) return false;
  // `export function Row` is not a reference of its name.
  if (module.parentOf(fn)?.type !== 'Program') return false;

  const binding = module.bindings.find((candidate) => candidate.declarations[0] === fn.id);
  if (binding === undefined) return false;

  return binding.references.every((reference) => {
    if (reference.inTypePosition) return true;
    const tag = module.parentOf(reference.node);
    if (!is.JSXOpeningElement(tag) && !is.JSXClosingElement(tag)) return false;
    const element = module.parentOf(tag);
    return element !== null && rowElements.has(element);
  });
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

/** The stored JSX of every element row in these sites. */
function collectRows(sites: readonly Site[], shown: Set<Node>): void {
  for (const site of sites) {
    if (site.kind === 'conditional') {
      for (const branch of site.branches) collectRows(branch.sites, shown);
    } else if (site.kind === 'text' && site.rows?.row.kind === 'element') {
      shown.add(site.rows.row.value.node);
    }
  }
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
    const routed = new Map<Node, BindingNode>();
    const leaves = new Set<FunctionNode>();
    const rowElements = new Set<Node>();
    // Only a component's own sites: the row is declared where its callback is
    // evaluated, in the component's scope. Rows inside stored JSX stay general.
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const inputs = new Map(component.siteInputs);
      const plan = (site: Site) => {
        const rows = rowList(site, general, values, calls);
        if (rows === null) return null;
        if (rows.row.kind === 'component') {
          leaves.add(rows.row.component);
          rowElements.add(unwrap(rows.callback.body));
        }
        return withRoutes(rows, site, general, component, inputs, routed);
      };
      const sites = rowSites(component.sites, plan, found);
      if (sites !== component.sites) components.set(fn, { ...component, sites, siteInputs: inputs });
    }
    if (found.size === 0) return null;

    // The row list replaced these callbacks: nothing evaluates their JSX as a
    // stored value any more, so its render program must not be emitted.
    const shown = new Set<Node>();
    for (const component of components.values()) {
      collectRows(component.sites, shown);
    }
    const remaining = general.values.filter((value) => !shown.has(value.node));

    for (const [fn, component] of components) {
      const mutations = markCalls(component.mutations, found);
      if (mutations !== component.mutations) components.set(fn, { ...component, mutations });
    }
    const sharedOwners = general.sharedOwners.map((owner) => {
      const mutations = markCalls(owner.mutations, found);
      return mutations === owner.mutations ? owner : { ...owner, mutations };
    });
    const module = general.module.module;
    const rowOnly = new Set([...leaves].filter((fn) => shownOnlyAsRows(module, fn, rowElements)));
    return {
      ...general,
      values: remaining,
      components,
      sharedOwners,
      ...(routed.size > 0 ? { routedComparisons: routed } : {}),
      ...(rowOnly.size > 0 ? { rowOnly } : {}),
    };
  },
};
