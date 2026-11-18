/**
 * What each module says about routes (`wiki/compiler/routes.md`): its `route="…"` elements, the
 * component calls a route context can reach, and its `route-to` links. Nothing is joined across
 * modules here; `graph.ts` does that.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import type { Module, ResolvedModule } from '../../core/resolve';
import { functionValue, type FunctionNode } from '../../core/resolve/functions';
import { checkPattern } from './patterns';
import { collectPreparations, type RoutedPreparation } from './routed';

export type JsxElement = Extract<Node, { type: 'JSXElement' }>;
export type JsxAttribute = Extract<Node, { type: 'JSXAttribute' }>;

/** One `route="…"` element as written: a template, one instance per route context it renders in. */
export interface RouteTemplate {
  readonly module: Module;
  readonly element: JsxElement;
  readonly attribute: JsxAttribute;
  /** The component whose markup holds it. */
  readonly owner: FunctionNode;
  /** Unique in the program: the module, the owner, the routes around it, its tag and pattern. */
  readonly id: string;
  /** The pattern as written, normalized; relative to the route around it. */
  readonly pattern: string;
  /** The nearest `route` element around it in the same component. */
  readonly ancestor: RouteTemplate | null;
}

/** A call of a component this graph compiles, and the route around it in the caller. */
export interface RouteCall {
  readonly module: Module;
  readonly element: JsxElement;
  /** The calling component; null for markup outside any component. */
  readonly owner: FunctionNode | null;
  /** The nearest `route` element around the call (the call itself when it has `route`). */
  readonly route: RouteTemplate | null;
  readonly callee: FunctionNode;
}

/** A `route-to` attribute, checked against the whole program's routes. */
export interface RouteLink {
  readonly module: Module;
  readonly element: JsxElement;
  readonly attribute: JsxAttribute;
}

export interface ModuleRoutes {
  readonly templates: readonly RouteTemplate[];
  readonly calls: readonly RouteCall[];
  readonly links: readonly RouteLink[];
  readonly preparations: readonly RoutedPreparation[];
  /** The module mounts an application (`mount(…)` from the runtime), so its graph is a whole app. */
  readonly mounts: boolean;
}

/** Whether a module's text can hold route syntax at all, before looking closer. */
export function mayHaveRoutes(source: string): boolean {
  return /\sroute(?:-to)?\s*=|\$routed\b/.test(source);
}

export function collectRoutes(entry: ResolvedModule, components: ReadonlySet<FunctionNode>): ModuleRoutes {
  const module = entry.module;
  const mounts = module.imports.some((imported) => imported.name === 'mount' && imported.specifier.startsWith('@memoized-dom/runtime'));
  const preparations = mayHaveRoutes(module.source) ? collectPreparations(module, components) : [];
  if (!entry.hasJsx) return { templates: [], calls: [], links: [], preparations, mounts };
  return { ...collectMarkup(entry, components), preparations, mounts };
}

function collectMarkup(entry: ResolvedModule, components: ReadonlySet<FunctionNode>): Pick<ModuleRoutes, 'templates' | 'calls' | 'links'> {
  const module = entry.module;
  const templates = new Map<JsxElement, RouteTemplate>();
  const occurrences = new Map<string, number>();
  const calls: RouteCall[] = [];
  const links: RouteLink[] = [];

  // In source order, so a route's ancestors are collected before it.
  for (const element of module.findAll('JSXElement')) {
    const attribute = attributeNamed(element, 'route');
    if (attribute !== undefined) {
      const template = collectTemplate(module, element, attribute, components, templates, occurrences);
      templates.set(element, template);
    }

    const link = attributeNamed(element, 'route-to');
    if (link !== undefined) links.push({ module, element, attribute: link });

    const callee = functionValue(module, element.openingElement.name);
    if (callee !== null && components.has(callee)) {
      calls.push({
        module,
        element,
        owner: ownerOf(module, element, components),
        route: templates.get(element) ?? enclosingTemplate(module, element, templates, components),
        callee,
      });
    }
  }

  return { templates: [...templates.values()], calls, links };
}

function collectTemplate(
  module: Module,
  element: JsxElement,
  attribute: JsxAttribute,
  components: ReadonlySet<FunctionNode>,
  templates: ReadonlyMap<JsxElement, RouteTemplate>,
  occurrences: Map<string, number>,
): RouteTemplate {
  const fail = (message: string, node: Node = attribute) => CompileError.at(message, module.path, module.source, node.start);

  const written = staticString(attribute);
  if (written === null) throw fail('route must be a static string beginning with /');
  const checked = checkPattern(written);
  if ('error' in checked) throw fail(checked.error);

  const owner = ownerOf(module, element, components);
  if (owner === null) throw fail('a route belongs inside a component');
  if (attributeNamed(element, 'key') !== undefined) {
    throw fail('a route element is keyed by its route; move key to an element inside it');
  }

  const ancestor = enclosingTemplate(module, element, templates, components);
  const base = ancestor?.id ?? `${module.path}#route:${componentName(module, owner)}`;
  const tag = is.JSXIdentifier(element.openingElement.name) ? element.openingElement.name.name : '$element';
  const key = `${base}/${encodeURIComponent(tag)}:${encodeURIComponent(checked.pattern)}`;
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);

  return {
    module,
    element,
    attribute,
    owner,
    id: occurrence === 0 ? key : `${key}[${occurrence}]`,
    pattern: checked.pattern,
    ancestor,
  };
}

/**
 * The nearest `route` element around `element` inside the same component. Markup in a callback of
 * the component (a `.map` row, a render prop) still belongs to it, so the search stops only at a
 * component.
 */
function enclosingTemplate(
  module: Module,
  element: JsxElement,
  templates: ReadonlyMap<JsxElement, RouteTemplate>,
  components: ReadonlySet<FunctionNode>,
): RouteTemplate | null {
  let first = true;
  for (const ancestor of module.ancestors(element)) {
    // `ancestors` starts with the node itself.
    if (first) {
      first = false;
      continue;
    }
    if (is.Function(ancestor) && components.has(ancestor as FunctionNode)) return null;
    const template = is.JSXElement(ancestor) ? templates.get(ancestor) : undefined;
    if (template !== undefined) return template;
  }
  return null;
}

/** The component whose markup holds `node`: the nearest enclosing component function. */
function ownerOf(module: Module, node: Node, components: ReadonlySet<FunctionNode>): FunctionNode | null {
  for (const ancestor of module.ancestors(node)) {
    if (is.Function(ancestor) && components.has(ancestor as FunctionNode)) return ancestor as FunctionNode;
  }
  return null;
}

/** A component's name, as a route id and a message show it. */
export function componentName(module: Module, fn: FunctionNode): string {
  if (fn.id) return fn.id.name;
  const parent = module.parentOf(fn);
  if (is.VariableDeclarator(parent) && is.Identifier(parent.id)) return parent.id.name;
  if (is.Property(parent) && !parent.computed && is.Identifier(parent.key)) return parent.key.name;
  return 'default';
}

export function attributeNamed(element: JsxElement, name: string): JsxAttribute | undefined {
  const found = element.openingElement.attributes.find((attribute) => {
    return is.JSXAttribute(attribute) && is.JSXIdentifier(attribute.name) && attribute.name.name === name;
  });
  return found !== undefined && is.JSXAttribute(found) ? found : undefined;
}

/** `"…"` or `{"…"}`; null for any other value. */
export function staticString(attribute: JsxAttribute): string | null {
  const value = is.JSXExpressionContainer(attribute.value) ? attribute.value.expression : attribute.value;
  if (value !== null && is.Literal(value) && typeof value.value === 'string') return value.value;
  if (value !== null && is.TemplateLiteral(value) && value.expressions.length === 0) return value.quasis[0]!.value.cooked ?? null;
  return null;
}
