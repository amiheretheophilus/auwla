/**
 * Reads inside an event handler need no tracking. A tracked read tells the running
 * computation what it depends on, and a handler runs from an event, with no
 * computation around it. So `items.length` in `onClick` is the plain variable, not
 * `trackRead(() => version, items, key)`.
 *
 * Covered: a function literal given to an intrinsic element's event site, a function
 * every reference of which is such a site, and the callbacks a known method runs
 * synchronously inside them (`items.filter((row) => row.id === id)`).
 *
 * Any other nested function stays tracked: it may be stored and called later from
 * rendering code. So does everything in a module with source readiness, whose reads
 * carry more than tracking.
 */
import { is } from 'yuku-ast';
import type { Module } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';
import type { ModulePlan, Site } from '../core/plan';
import { unwrap } from '../core/plan/jsx';
import { functionValue } from '../core/resolve/functions';
import { methodFact } from './method-facts';
import type { Optimization } from '.';

function eventValues(plan: ModulePlan): ReadonlySet<Node> {
  const values = new Set<Node>();
  const visit = (sites: readonly Site[]): void => {
    for (const site of sites) {
      if (site.kind === 'event') values.add(unwrap(site.expression));
      if (site.kind === 'conditional') for (const branch of site.branches) visit(branch.sites);
    }
  };
  for (const component of plan.components.values()) visit(component.sites);
  for (const value of plan.values) visit(value.sites);
  return values;
}

/** The functions that only ever run as listeners. */
function handlerFunctions(module: Module, events: ReadonlySet<Node>): ReadonlySet<Node> {
  const handlers = new Set<Node>();
  for (const value of events) {
    if (is.Function(value)) {
      handlers.add(value);
      continue;
    }
    if (!is.Identifier(value)) continue;

    const binding = module.referenceOf(value)?.binding ?? null;
    const fn = binding === null ? null : functionValue(module, value);
    if (binding === null || fn === null) continue;

    const onlyListeners = binding.references.every((reference) => {
      return reference.node === binding.declarations[0] || reference.inTypePosition
        || (!reference.isWrite && events.has(reference.node));
    });
    if (onlyListeners) handlers.add(fn);
  }
  return handlers;
}

/** A callback a known method runs before returning. */
function runsSynchronously(module: Module, fn: Node): boolean {
  const parent = module.parentOf(fn);
  if (!is.CallExpression(parent) || !parent.arguments.includes(fn as never)) return false;
  const callee = parent.callee;
  return is.MemberExpression(callee) && !callee.computed && is.Identifier(callee.property)
    && methodFact(callee.property.name) !== undefined;
}

function insideHandler(module: Module, node: Node, handlers: ReadonlySet<Node>): boolean {
  for (const ancestor of module.ancestors(node)) {
    if (!is.Function(ancestor)) continue;
    if (handlers.has(ancestor)) return true;
    if (!runsSynchronously(module, ancestor)) return false;
  }
  return false;
}

export const handlerReads: Optimization = {
  name: 'handler-reads',
  match(general) {
    if (general.sourceFlow !== undefined) return null;

    const module = general.module.module;
    const handlers = handlerFunctions(module, eventValues(general));
    if (handlers.size === 0) return null;

    const reads = new Set<Node>();
    for (const reference of module.references) {
      if (reference.binding !== null && !reference.isWrite && !reference.inTypePosition
        && insideHandler(module, reference.node, handlers)) {
        reads.add(reference.node);
      }
    }
    if (reads.size === 0) return null;

    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const trackedReads = component.trackedReads.filter((read) => !reads.has(read.node));
      if (trackedReads.length !== component.trackedReads.length) {
        components.set(fn, { ...component, trackedReads });
      }
    }
    return { ...general, components, handlerReads: reads };
  },
};
