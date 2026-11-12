/**
 * Routes, lowered to ordinary JSX before analysis (`wiki/compiler/routes.md`). After this, every
 * later stage sees a conditional, a key and an attribute, so a route region gets the same
 * tracking, adoption and delivery as any conditional:
 *
 *     <main>                                    <main>
 *       <Home route="/" />                         {$routeRegion("…/Home:%2F") && <Home key={$routeRegion("…/Home:%2F")} />}
 *       <a route-to="/about">About</a>             <a href="/about">About</a>
 *     </main>                                   </main>
 *
 * - `routeRegion(id)` (`router/src/route-reads.ts`) is the region's identity while its route
 *   matches, and null otherwise. compiler-next runs a call it cannot see into inside a tracked
 *   computation, and the router reports the read there, so the region follows navigation with no
 *   special case here. Keying the content by the identity remounts it on a new path, so
 *   `/story/1` → `/story/2` starts `Story` afresh, while a layout above stays mounted.
 * - `route-to` becomes `href`, built by `buildRoutePath` when it has params, a query or a hash.
 *   The router's click handler makes a click on it navigate in place.
 * - The module of each root component (one no other component calls) installs the route table
 *   at its top, before anything in it can render.
 * - A component rendered in several route contexts (`graph.ts`) reads its context from the
 *   hidden prop `route:context`, which callers pass and elements never take as an attribute
 *   (`runtime/src/dom-props.ts`).
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import type { Module } from '../../core/resolve';
import type { FunctionNode } from '../../core/resolve/functions';
import { applyEdits, type Edit } from '../../core/parse/text-edits';
import { attributeNamed, staticString, type JsxAttribute, type JsxElement, type RouteLink, type RouteTemplate } from './collect';
import { instanceId, type RouteGraph, type RouteInstance } from './graph';
import { checkPattern, parameterNames } from './patterns';

const INTERNAL = '@memoized-dom/router/internal';

/** The hidden prop that carries a route context into a component rendered in several. */
const CONTEXT_PROP = 'route:context';

/** Each module's text with its routes lowered; a module with nothing to lower is left out. */
export function lowerRouteModules(graph: RouteGraph, links: readonly RouteLink[], modules: readonly Module[]): Map<Module, string> {
  const known = new Map(graph.instances.map((instance) => [instance.fullPattern, instance]));
  const lowered = new Map<Module, string>();

  for (const module of modules) {
    const lowering = new ModuleLowering(module, graph, known);
    const text = lowering.run(links.filter((link) => link.module === module));
    if (text !== null) lowered.set(module, text);
  }

  return lowered;
}

class ModuleLowering {
  readonly #edits: Edit[] = [];
  /** Router imports this module needs: exported name → local name. */
  readonly #imports = new Map<string, string>();
  /** The local name holding each dynamic component's route context. */
  readonly #contextReads = new Map<FunctionNode, string>();

  constructor(
    private readonly module: Module,
    private readonly graph: RouteGraph,
    private readonly known: ReadonlyMap<string, RouteInstance>,
  ) {}

  run(links: readonly RouteLink[]): string | null {
    const templates = this.graph.templates.filter((template) => template.module === this.module);
    const calls = this.graph.calls.filter((call) => call.module === this.module && this.graph.dynamic.has(call.callee));
    const roots = [...this.graph.roots].filter((fn) => templates.some((template) => template.owner === fn)
      || this.graph.calls.some((call) => call.module === this.module && call.owner === fn));

    if (templates.length === 0 && calls.length === 0 && links.length === 0 && roots.length === 0) return null;

    if (roots.length > 0) this.#installTable();
    for (const fn of this.graph.dynamic) {
      if (this.#ownedHere(fn)) this.#readContext(fn);
    }
    // In source order, so an element's closing text lands before a following sibling's opening.
    for (const template of templates) this.#region(template);
    for (const call of calls) this.#passContext(call.element, call.route, call.owner);
    for (const link of links) this.#link(link);

    if (this.#imports.size > 0) {
      // Imports are hoisted, so the end of the module keeps every authored offset in place.
      const imports = [...this.#imports].map(([name, local]) => `${name} as ${local}`).join(', ');
      const end = this.module.source.length;
      this.#edits.push({ start: end, end, text: `\nimport { ${imports} } from '${INTERNAL}';\n` });
    }
    return applyEdits(this.module.source, this.#edits);
  }

  /** `<X route="/p" …>` → `{$routeRegion(id) && <X key={$routeRegion(id)} …>}`. */
  #region(template: RouteTemplate): void {
    const read = `${this.#import('routeRegion')}(${this.#instance(template)})`;
    this.#edits.push({ start: template.attribute.start, end: template.attribute.end, text: `key={${read}}` });

    const parent = this.module.parentOf(template.element);
    const inJsx = is.JSXElement(parent) || is.JSXFragment(parent);
    this.#edits.push({ start: template.element.start, end: template.element.start, text: `${inJsx ? '{' : '('}${read} && ` });
    this.#edits.push({ start: template.element.end, end: template.element.end, text: inJsx ? '}' : ')' });
  }

  /** The expression of a template's instance id inside its component's context. */
  #instance(template: RouteTemplate): string {
    const read = this.#contextReads.get(template.owner);
    if (read !== undefined) {
      return `(${read} === void 0 ? "" : ${read} + ">>") + ${JSON.stringify(template.id)}`;
    }
    const [context] = this.graph.contexts.get(template.owner) ?? [undefined];
    return JSON.stringify(instanceId(context, template.id));
  }

  /** Pass a call of a dynamic component the route around it, last so it wins over a spread. */
  #passContext(element: JsxElement, route: RouteTemplate | null, owner: FunctionNode | null): void {
    let context: string | undefined;
    if (route !== null) {
      context = this.#instance(route);
    } else if (owner !== null && this.#contextReads.has(owner)) {
      context = this.#contextReads.get(owner);
    } else if (owner !== null) {
      const [only] = this.graph.contexts.get(owner) ?? [undefined];
      context = only === undefined ? undefined : JSON.stringify(only);
    }
    if (context === undefined) return;

    const opening = element.openingElement;
    const at = opening.selfClosing ? this.module.source.lastIndexOf('/', opening.end - 1) : opening.end - 1;
    this.#edits.push({ start: at, end: at, text: ` ${CONTEXT_PROP}={${context}} ` });
  }

  /** Give a dynamic component a name for its `route:context` prop. */
  #readContext(fn: FunctionNode): void {
    const param = fn.params[0];
    if (param !== undefined && is.Identifier(param)) {
      this.#contextReads.set(fn, `${param.name}[${JSON.stringify(CONTEXT_PROP)}]`);
      return;
    }

    const local = this.#freshName('$routeContext');
    const entry = `${JSON.stringify(CONTEXT_PROP)}: ${local}`;
    this.#contextReads.set(fn, local);
    const pattern = param === undefined ? null
      : is.ObjectPattern(param) ? param
      : is.AssignmentPattern(param) && is.ObjectPattern(param.left) ? param.left
      : undefined;

    if (pattern === undefined) {
      throw this.#error('a component rendered in several route contexts takes its props as a name or an object pattern', param!);
    }
    if (pattern === null) {
      const open = this.module.source.indexOf('(', fn.id?.end ?? fn.start);
      this.#edits.push({ start: open + 1, end: open + 1, text: `{ ${entry} }` });
      return;
    }
    // Before a rest element, which the key then stays out of.
    const rest = pattern.properties.find((property) => is.RestElement(property));
    if (rest !== undefined) {
      this.#edits.push({ start: rest.start, end: rest.start, text: `${entry}, ` });
    } else if (pattern.properties.length > 0) {
      const last = pattern.properties.at(-1)!;
      this.#edits.push({ start: last.end, end: last.end, text: `, ${entry}` });
    } else {
      this.#edits.push({ start: pattern.start + 1, end: pattern.start + 1, text: ` ${entry} ` });
    }
  }

  /** `route-to="/p"` → `href="/p"`; the object form builds the path with its params. */
  #link(link: RouteLink): void {
    const { element, attribute } = link;
    const name = element.openingElement.name;
    const fail = (message: string) => this.#error(message, attribute);

    if (!is.JSXIdentifier(name)) throw fail('route-to currently requires a statically named JSX element');
    if (/^[A-Z]/.test(name.name)) {
      throw fail('route-to currently targets intrinsic elements; put it on the interactive host rendered by this component');
    }
    if (name.name !== 'a') {
      throw fail('route-to requires an anchor; use <a route-to="/path"> for navigation or call navigate() from an action handler');
    }
    if (element.openingElement.attributes.some((entry) => is.JSXSpreadAttribute(entry))) {
      throw fail('route-to cannot be combined with JSX prop spreads because navigation ownership must be static');
    }
    if (attributeNamed(element, 'href') !== undefined) throw fail('an anchor using route-to must not also declare href');

    const target = this.#target(attribute);
    const instance = this.known.get(target.path);
    if (instance === undefined) throw fail(`route-to references undeclared route '${target.path}'`);
    const required = parameterNames(instance.fullPattern);
    if (target.options === null && required.length > 0) {
      throw fail(`route-to '${target.path}' requires params { ${required.join(', ')} }; use the object form`);
    }

    if (target.options === null) {
      this.#edits.push({ start: attribute.start, end: attribute.end, text: `href=${JSON.stringify(target.path)}` });
      return;
    }
    const value = (key: string) => {
      const node = target.options!.get(key);
      return node === undefined ? 'void 0' : this.module.source.slice(node.start, node.end);
    };
    const build = `${this.#import('buildRoutePath')}(${JSON.stringify(target.path)}, ${value('params')}, ${value('query')}, ${value('hash')})`;
    this.#edits.push({ start: attribute.start, end: attribute.end, text: `href={${build}}` });
  }

  /** A link's destination: a static path, and for the object form its `params`, `query` and `hash`. */
  #target(attribute: JsxAttribute): { path: string; options: Map<string, Node> | null } {
    const fail = (message: string) => this.#error(message, attribute);
    const direct = staticString(attribute);
    if (direct !== null) {
      const checked = checkPattern(direct);
      if ('error' in checked) throw fail(checked.error);
      return { path: checked.pattern, options: null };
    }

    const object = is.JSXExpressionContainer(attribute.value) ? attribute.value.expression : null;
    if (object === null || !is.ObjectExpression(object)) {
      throw fail('route-to must be a static route string or a statically shaped destination object');
    }
    const entries = staticEntries(object, fail, 'route-to objects must have statically known keys; object spreads are not supported', 'route-to object keys must be static', (key) => `route-to contains duplicate '${key}' fields`);
    for (const key of entries.keys()) {
      if (!['path', 'params', 'query', 'hash'].includes(key)) throw fail(`route-to does not support '${key}'`);
    }

    const pathNode = entries.get('path');
    if (pathNode === undefined || !is.Literal(pathNode) || typeof pathNode.value !== 'string') {
      throw fail("route-to requires a static string 'path'");
    }
    const checked = checkPattern(pathNode.value);
    if ('error' in checked) throw fail(checked.error);

    const expected = parameterNames(checked.pattern);
    const params = entries.get('params');
    if (expected.length > 0 && params === undefined) {
      throw fail(`route-to '${checked.pattern}' requires params { ${expected.join(', ')} }`);
    }
    if (params !== undefined) {
      if (!is.ObjectExpression(params)) throw fail('route-to params must be an object literal with static keys');
      const names = [...staticEntries(params, fail, 'route-to params do not support object spreads', 'route-to param names must be static', (key) => `route-to params contain duplicate '${key}'`).keys()];
      const missing = expected.filter((name) => !names.includes(name));
      const extra = names.filter((name) => !expected.includes(name));
      if (missing.length > 0 || extra.length > 0) {
        throw fail(`route-to '${checked.pattern}' params mismatch`
          + (missing.length === 0 ? '' : `; missing ${missing.join(', ')}`)
          + (extra.length === 0 ? '' : `; unknown ${extra.join(', ')}`));
      }
    }

    entries.delete('path');
    return { path: checked.pattern, options: entries };
  }

  /** Install the route table at the top of the module, before anything in it renders. */
  #installTable(): void {
    const instances = this.graph.instances;
    const byId = new Map(instances.map((instance) => [instance.id, instance]));
    const chainOf = (instance: RouteInstance): string[] => {
      const chain: string[] = [];
      for (let current: RouteInstance | undefined = instance; current !== undefined; current = current.parentId === undefined ? undefined : byId.get(current.parentId)) {
        chain.unshift(current.id);
      }
      return chain;
    };
    // Shallower first: for equal patterns (`route="/"` inside a parent), the router prefers the
    // deeper entry, which comes later.
    const ordered = instances.map((instance) => ({ instance, chain: chainOf(instance) }))
      .sort((left, right) => left.chain.length - right.chain.length);
    const indexes = new Map(ordered.map(({ instance }, index) => [instance.id, index]));

    const entries = ordered.map(({ instance, chain }) => {
      const own = parameterNames(instance.pattern);
      return `{ id: ${JSON.stringify(instance.id)}, pattern: ${JSON.stringify(instance.pattern)}, fullPattern: ${JSON.stringify(instance.fullPattern)}, `
        + `ownParamNames: ${JSON.stringify(own)}, chain: ${JSON.stringify(chain.map((id) => indexes.get(id)))} }`;
    });

    // One statement and no binding: a module-scope table would be state the compiler follows.
    const text = `${this.#import('installRouteTable')}([${entries.join(', ')}]);\n`;
    this.#edits.push({ start: 0, end: 0, text });
  }

  /** Whether `fn` is declared in this module. */
  #ownedHere(fn: FunctionNode): boolean {
    return this.graph.templates.some((template) => template.owner === fn && template.module === this.module)
      || this.graph.calls.some((call) => call.owner === fn && call.module === this.module);
  }

  /** The local name of a router export, imported once per module. */
  #import(name: string): string {
    let local = this.#imports.get(name);
    if (local === undefined) {
      local = this.#freshName(`$${name}`);
      this.#imports.set(name, local);
    }
    return local;
  }

  #freshName(base: string): string {
    const taken = new Set([...this.#imports.values(), ...this.#contextReads.values()]);
    let name = base;
    for (let suffix = 2; this.module.source.includes(name) || taken.has(name); suffix++) name = `${base}${suffix}`;
    return name;
  }

  #error(message: string, node: Node): CompileError {
    return CompileError.at(message, this.module.path, this.module.source, node.start);
  }
}

/** An object literal's entries by static key; spreads, computed keys and duplicates are errors. */
function staticEntries(
  object: Extract<Node, { type: 'ObjectExpression' }>,
  fail: (message: string) => CompileError,
  spread: string,
  computed: string,
  duplicate: (key: string) => string,
): Map<string, Node> {
  const entries = new Map<string, Node>();
  for (const property of object.properties) {
    if (is.SpreadElement(property)) throw fail(spread);
    if (!is.Property(property)) throw fail(computed);
    const key = !property.computed && is.Identifier(property.key) ? property.key.name
      : is.Literal(property.key) && typeof property.key.value === 'string' ? property.key.value
      : null;
    if (key === null) throw fail(computed);
    if (entries.has(key)) throw fail(duplicate(key));
    entries.set(key, property.value);
  }
  return entries;
}
