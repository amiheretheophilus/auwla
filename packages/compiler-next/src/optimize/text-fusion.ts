/**
 * Adjacent static text and `{expression}` children share one text node, so
 * `<li>{id}: {label}</li>` clones one node and writes one string instead of three
 * nodes and two writes. The old compiler did this too (`../decisions.md`,
 * 2026-10-26): how text is split into nodes is not a semantic guarantee, while its
 * content and evaluation order are.
 *
 * A part must only read: no call that could do anything else, no JSX, and no call
 * that builds a list, which would nearly always be an object. Evaluating such
 * parts together, then writing, shows what evaluating and writing each in turn
 * shows.
 *
 * A part can still turn out to be an object at runtime (`{tags}, {name}`). The site
 * then expands into one value slot per part (`fuseText`), so it renders the same.
 *
 * Not done for stored JSX, whose captures are single values per site, or with source
 * readiness, whose parts can each present their own pending value.
 */
import type { Module } from 'yuku-analyzer';
import { is, walk } from 'yuku-ast';
import type { Expression } from 'yuku-parser';
import type { BindingNode } from '../core/graph';
import type { ComponentPlan, ConditionalBranch, ModulePlan, Site, Template, TextSite } from '../core/plan/model';
import { containsJsx } from '../core/plan/template';
import { effectFree } from './effects';
import { methodFact } from './method-facts';
import type { Optimization } from '.';

function onlyReads(module: Module, expression: Expression): boolean {
  if (containsJsx(expression) || !effectFree(module, expression)) return false;

  let scalar = true;
  walk(expression, {
    enter: (node, ctx) => {
      // A function is created, not called; `map` and friends build lists.
      if (is.Function(node)) {
        scalar = false;
        ctx.stop();
        return;
      }
      if (is.CallExpression(node) && is.MemberExpression(node.callee) && !node.callee.computed
        && is.Identifier(node.callee.property) && methodFact(node.callee.property.name)?.kind === 'copy') {
        scalar = false;
        ctx.stop();
      }
    },
  });
  return scalar;
}

function fusible(module: Module, site: Site): site is TextSite {
  return site.kind === 'text' && site.spread !== true && site.listStrategy !== 'rows' && site.parts === undefined
    && onlyReads(module, site.expression);
}

interface View {
  readonly template: Template;
  readonly sites: readonly Site[];
}

/** Later parts' inputs, which the fused site now has too. */
type Merged = Map<Expression, readonly Expression[]>;

function fuseView(module: Module, view: View, merged: Merged): View {
  const siteOf = new Map(view.sites.flatMap((site): [number, TextSite][] => site.kind === 'text' ? [[site.node, site]] : []));
  const nodes = [...view.template.nodes];
  const replaced = new Map<Site, Site>();
  const dropped = new Set<Site>();

  const isPart = (index: number): boolean => {
    const node = nodes[index]!;
    if (node.kind === 'text') return true;
    if (node.kind !== 'placeholder') return false;
    const site = siteOf.get(index);
    return site !== undefined && fusible(module, site);
  };

  nodes.forEach((node, index) => {
    if (node.kind !== 'element') return;

    const children: number[] = [];
    let cursor = 0;
    while (cursor < node.children.length) {
      let end = cursor;
      while (end < node.children.length && isPart(node.children[end]!)) end++;

      const run = node.children.slice(cursor, end);
      const dynamic = run.filter((child) => nodes[child]!.kind === 'placeholder');

      if (run.length < 2 || dynamic.length === 0) {
        children.push(...run);
        if (end < node.children.length) children.push(node.children[end]!);
        cursor = end + 1;
        continue;
      }

      const sites = dynamic.map((child) => siteOf.get(child)!);
      const parts = run.map((child) => {
        const part = nodes[child]!;
        return part.kind === 'text' ? part.text : siteOf.get(child)!.expression;
      });
      const first = sites[0]!;
      replaced.set(first, {
        ...first,
        parts,
        primitive: sites.every((site) => site.primitive),
        guardDisposal: sites.some((site) => site.guardDisposal === true),
        reactive: sites.some((site) => site.reactive),
      });
      for (const site of sites.slice(1)) dropped.add(site);
      merged.set(first.expression, sites.slice(1).map((site) => site.expression));

      children.push(first.node);
      if (end < node.children.length) children.push(node.children[end]!);
      cursor = end + 1;
    }

    if (children.length !== node.children.length) {
      nodes[index] = { ...node, children };
    }
  });

  if (replaced.size === 0) return view;

  const sites = view.sites.flatMap((site) => {
    if (dropped.has(site)) return [];
    return [replaced.get(site) ?? site];
  });
  return { template: { ...view.template, nodes }, sites };
}

/** Fuse a component's or branch's view, and the views nested in its sites. */
function fuseSites(module: Module, view: View, merged: Merged): View {
  const fused = fuseView(module, view, merged);

  let changed = fused !== view;
  const sites = fused.sites.map((site): Site => {
    if (site.kind === 'conditional') {
      const branches = site.branches.map((branch): ConditionalBranch => {
        if (branch.template === null) return branch;
        const nested = fuseSites(module, { template: branch.template, sites: branch.sites }, merged);
        return nested.template === branch.template && nested.sites === branch.sites ? branch : { ...branch, ...nested };
      });
      if (branches.every((branch, index) => branch === site.branches[index])) return site;
      changed = true;
      return { ...site, branches };
    }

    if (site.kind === 'text' && site.rows?.row.kind === 'element') {
      const value = site.rows.row.value;
      // A row's key site is planned first, so its index survives fusion.
      const nested = fuseSites(module, { template: value.template, sites: value.sites }, merged);
      if (nested.sites === value.sites) return site;
      changed = true;
      return { ...site, rows: { ...site.rows, row: { kind: 'element', value: { ...value, ...nested } } } };
    }

    return site;
  });

  return changed ? { template: fused.template, sites } : view;
}

/** A fused site takes every input and hidden read its parts had. */
function withMergedInputs(component: ComponentPlan, merged: Merged): Partial<ComponentPlan> {
  const siteInputs = new Map(component.siteInputs);
  const dynamicSites = new Set(component.dynamicSites);

  for (const [first, others] of merged) {
    const inputs = new Set<BindingNode>(siteInputs.get(first) ?? []);
    for (const other of others) {
      for (const input of siteInputs.get(other) ?? []) inputs.add(input);
      if (dynamicSites.has(other)) dynamicSites.add(first);
    }
    siteInputs.set(first, [...inputs]);
  }
  return { siteInputs, dynamicSites };
}

export const textFusion: Optimization = {
  name: 'text-fusion',
  match(general: ModulePlan): ModulePlan | null {
    if (general.sourceFlow !== undefined) return null;

    const module = general.module.module;
    let changed = false;
    const components = new Map(general.components);

    for (const [fn, component] of general.components) {
      const merged: Merged = new Map();
      const view = fuseSites(module, { template: component.template, sites: component.sites }, merged);
      if (view.template === component.template && view.sites === component.sites) continue;

      changed = true;
      components.set(fn, { ...component, ...view, ...withMergedInputs(component, merged) });
    }

    return changed ? { ...general, components } : null;
  },
};
