/**
 * The program's routes (`wiki/compiler/routes.md`, "Route contexts"): every route element of
 * every module, joined through the components that render them.
 *
 * A route element inside another joins its pattern, and so does every route a component renders
 * when the component is called inside a route. The route around a call is its **route context**.
 * A component rendered in two contexts has two instances of each of its routes, with different
 * full patterns, so each instance has its own id: the context's id, `>>`, the template's id.
 *
 * Most components render in one context, which is then known here: their routes' ids are
 * constants. Only a component rendered in several contexts learns its context at run time, from
 * the hidden prop `route:context` its callers pass (`lower.ts`).
 */
import { CompileError } from '../../core/diagnostics';
import type { FunctionNode } from '../../core/resolve/functions';
import type { Node } from 'yuku-parser';
import type { Module } from '../../core/resolve';
import { componentName, type ModuleRoutes, type RouteCall, type RouteTemplate } from './collect';
import { checkPattern, isCatchAll, joinPatterns, parameterNames, signatureOf } from './patterns';
import type { RoutedPreparation } from './routed';

/** One route the router matches: a template in one route context. */
export interface RouteInstance {
  readonly id: string;
  /** The template's own pattern, relative to its parent. */
  readonly pattern: string;
  readonly fullPattern: string;
  readonly parentId: string | undefined;
  readonly template: RouteTemplate;
}

export interface RouteGraph {
  readonly templates: readonly RouteTemplate[];
  readonly calls: readonly RouteCall[];
  /** In the order they were reached, parents before children. */
  readonly instances: readonly RouteInstance[];
  /** Components that render routes, directly or through the components they call. */
  readonly routed: ReadonlySet<FunctionNode>;
  /** Each routed component's contexts; `undefined` is "no route around it". */
  readonly contexts: ReadonlyMap<FunctionNode, readonly (string | undefined)[]>;
  /** Components rendered in more than one context, which receive theirs as a prop. */
  readonly dynamic: ReadonlySet<FunctionNode>;
  /** Components whose module installs the route table: those no other component calls. */
  readonly roots: ReadonlySet<FunctionNode>;
  readonly preparations: readonly RoutedPreparation[];
  /** The preparations each instance's route runs before it commits, by instance id. */
  readonly prepares: ReadonlyMap<string, readonly string[]>;
}

/** The id of `templateId` inside `context`. */
export function instanceId(context: string | undefined, templateId: string): string {
  return context === undefined ? templateId : `${context}>>${templateId}`;
}

export function buildRouteGraph(modules: readonly ModuleRoutes[]): RouteGraph {
  const templates = modules.flatMap((entry) => entry.templates);
  const calls = modules.flatMap((entry) => entry.calls);
  const routed = routedComponents(templates, calls);

  const templatesOf = groupBy(templates, (template) => template.owner);
  const callsOf = groupBy(calls.filter((call) => routed.has(call.callee)), (call) => call.owner);
  const called = new Set(calls.filter((call) => call.owner !== null).map((call) => call.callee));
  const roots = new Set([...routed].filter((fn) => !called.has(fn)));

  const instances = new Map<string, RouteInstance>();
  const contexts = new Map<FunctionNode, (string | undefined)[]>();

  /** Instantiate `fn`'s routes in `context`, then the routed components it calls. */
  const expand = (fn: FunctionNode, context: string | undefined, chain: readonly FunctionNode[], at: Located): void => {
    if (chain.includes(fn)) {
      throw located(`a component that renders routes cannot render itself: ${[...chain, fn].map((entry) => nameOf(entry, templatesOf, callsOf)).join(' → ')}`, at);
    }
    const seen = contexts.get(fn) ?? [];
    if (seen.includes(context)) return;
    contexts.set(fn, [...seen, context]);

    for (const template of templatesOf.get(fn) ?? []) {
      const parentId = template.ancestor === null ? context : instanceId(context, template.ancestor.id);
      const parent = parentId === undefined ? undefined : instances.get(parentId);
      instances.set(instanceId(context, template.id), instantiate(template, context, parent));
    }

    for (const call of callsOf.get(fn) ?? []) {
      const inner = call.route === null ? context : instanceId(context, call.route.id);
      expand(call.callee, inner, [...chain, fn], call);
    }
  };

  for (const root of roots) {
    const first = templatesOf.get(root)?.[0] ?? callsOf.get(root)?.[0];
    expand(root, undefined, [], first!);
  }
  // Markup outside any component renders its calls with no route around them.
  for (const call of callsOf.get(null) ?? []) expand(call.callee, call.route?.id, [], call);

  // A cycle no root reaches is never rendered from outside it, and still recursive.
  for (const fn of routed) {
    if (!contexts.has(fn)) {
      const first = templatesOf.get(fn)?.[0] ?? callsOf.get(fn)?.[0];
      expand(fn, undefined, [], first!);
    }
  }

  const ordered = [...instances.values()];
  checkAmbiguity(ordered, instances);
  const dynamic = new Set([...contexts].filter(([, list]) => list.length > 1).map(([fn]) => fn));

  const preparations = modules.flatMap((entry) => entry.preparations);
  const application = templates.length > 0 || modules.some((entry) => entry.mounts);
  const prepares = attachPreparations(ordered, calls, preparations, application);
  return { templates, calls, instances: ordered, routed, contexts, dynamic, roots, preparations, prepares };
}

/**
 * A route runs the preparations of the component it shows: the component a route element calls
 * (`<Story route="…" />`), or for an element (`<main route="…">`) the component that writes it.
 * In an application, a preparation no route runs is an error, since nothing would ever run it; a
 * component compiled on its own, with no routes and no mount, may still declare one.
 */
function attachPreparations(
  instances: readonly RouteInstance[],
  calls: readonly RouteCall[],
  preparations: readonly RoutedPreparation[],
  application: boolean,
): Map<string, readonly string[]> {
  const byComponent = groupBy(preparations, (preparation) => preparation.component);
  const attached = new Set<FunctionNode>();
  const prepares = new Map<string, readonly string[]>();

  for (const instance of instances) {
    const callee = calls.find((call) => call.element === instance.template.element)?.callee;
    const shown = callee ?? instance.template.owner;
    const own = byComponent.get(shown);
    if (own === undefined) continue;
    attached.add(shown);
    prepares.set(instance.id, own.map((preparation) => preparation.id));
  }

  if (application) {
    for (const [component, own] of byComponent) {
      if (attached.has(component)) continue;
      const orphan = own[0]!;
      const name = componentName(orphan.module, component);
      throw CompileError.at(
        `memo-dom: $routed in component '${name}' is never prepared because the component is not attached to a route; `
          + `declare its route region with the route attribute (for example <${name} route="/path" />) or remove the preparation`,
        orphan.module.path, orphan.module.source, orphan.call.start,
      );
    }
  }
  return prepares;
}

/** A template in one context: its full pattern, checked against the routes around it. */
function instantiate(template: RouteTemplate, context: string | undefined, parent: RouteInstance | undefined): RouteInstance {
  const id = instanceId(context, template.id);
  if (parent === undefined) {
    return { id, pattern: template.pattern, fullPattern: template.pattern, parentId: undefined, template };
  }

  if (isCatchAll(parent.fullPattern)) {
    throw located(`catch-all route '${parent.fullPattern}' cannot have child routes`, template.attribute, template.module);
  }
  const inherited = new Set(parameterNames(parent.fullPattern));
  const joined = joinPatterns(parent.fullPattern, template.pattern);
  for (const name of parameterNames(template.pattern)) {
    if (inherited.has(name)) {
      throw located(`route '${joined}' shadows active parameter '${name}' (duplicate route parameter '${name}')`, template.attribute, template.module);
    }
  }
  const checked = checkPattern(joined);
  if ('error' in checked) throw located(checked.error, template.attribute, template.module);
  return { id, pattern: template.pattern, fullPattern: checked.pattern, parentId: parent.id, template };
}

/**
 * Two routes the router could not tell apart (`/a/:x` and `/a/:y`, or `/` twice) are an error,
 * unless one contains the other: `route="/"` inside a parent is the parent's own path.
 */
function checkAmbiguity(instances: readonly RouteInstance[], byId: ReadonlyMap<string, RouteInstance>): void {
  const contains = (outer: RouteInstance, inner: RouteInstance): boolean => {
    for (let id = inner.parentId; id !== undefined; id = byId.get(id)?.parentId) {
      if (id === outer.id) return true;
    }
    return false;
  };

  const bySignature = new Map<string, RouteInstance[]>();
  for (const instance of instances) {
    const signature = signatureOf(instance.fullPattern);
    const others = bySignature.get(signature) ?? [];
    for (const other of others) {
      if (!contains(other, instance) && !contains(instance, other)) {
        throw located(
          `ambiguous routes '${other.fullPattern}' and '${instance.fullPattern}' share '${signature}'`,
          instance.template.attribute,
          instance.template.module,
        );
      }
    }
    bySignature.set(signature, [...others, instance]);
  }
}

/** Components with route templates, and every component that calls one of those. */
function routedComponents(templates: readonly RouteTemplate[], calls: readonly RouteCall[]): Set<FunctionNode> {
  const routed = new Set(templates.map((template) => template.owner));
  for (let changed = true; changed;) {
    changed = false;
    for (const call of calls) {
      if (call.owner !== null && routed.has(call.callee) && !routed.has(call.owner)) {
        routed.add(call.owner);
        changed = true;
      }
    }
  }
  return routed;
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...groups.get(key) ?? [], item]);
  }
  return groups;
}

/** Something with a place in a module, for a message. */
type Located = RouteTemplate | RouteCall;

function located(message: string, at: Located | Node, module?: Module): CompileError {
  if ('element' in at && 'module' in at) {
    return CompileError.at(message, at.module.path, at.module.source, at.element.start);
  }
  return CompileError.at(message, module!.path, module!.source, (at as Node).start);
}

function nameOf(
  fn: FunctionNode,
  templatesOf: ReadonlyMap<FunctionNode, readonly RouteTemplate[]>,
  callsOf: ReadonlyMap<FunctionNode | null, readonly RouteCall[]>,
): string {
  const module = templatesOf.get(fn)?.[0]?.module ?? callsOf.get(fn)?.[0]?.module;
  return module === undefined ? 'a component' : componentName(module, fn);
}
