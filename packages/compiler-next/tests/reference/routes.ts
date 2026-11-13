/**
 * The reference's own lowering of routes (`wiki/compiler/routes.md`). It shares no code with
 * compiler-next's (`src/features/routes/`), so a mistake in either shows as a difference in the
 * comparison cases. Matching a path against patterns is the router's job, not the compiler's, so
 * the reference runtime asks the router's public matcher (`runtime.ts`, `$routeIdentity`).
 *
 * What a route means, as plain JavaScript:
 *
 * - `<X route="/p">` shows while its instance is on the matched chain, keyed by the path it
 *   matched, so a new path makes it anew: `{$routeIdentity(id) && <X key={$routeIdentity(id)} />}`.
 * - Its instance is its template inside the route context of the component instance being
 *   rendered. Unlike compiler-next, which knows most contexts at compile time and passes the rest
 *   as a prop, the reference carries every context on the element that calls a component
 *   (`$routeCall`), and reads it back while that component renders (`$routeContext`).
 * - `route-to` becomes `href`, through the router's `buildRoutePath` for the object form.
 */
import { b, findAll, is } from 'yuku-ast';
import { generate } from 'yuku-codegen';
import { parse } from 'yuku-parser';
import type { Expression, Node } from 'yuku-parser';

type JsxElement = Extract<Node, { type: 'JSXElement' }>;
type JsxAttribute = Extract<Node, { type: 'JSXAttribute' }>;
type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;
type Resolve = (specifier: string, importer: string) => string | false | null;

interface Parsed {
  readonly path: string;
  readonly source: string;
  readonly program: Extract<Node, { type: 'Program' }>;
  readonly parents: Map<Node, Node>;
  /** Top-level components by local name. */
  readonly components: Map<string, FunctionNode>;
  /** Local name → the module and export it imports. */
  readonly imports: Map<string, { path: string; name: string }>;
  /** Export name → a local name, or another module's export. */
  readonly exports: Map<string, { local: string } | { path: string; name: string }>;
}

interface Template {
  readonly module: Parsed;
  readonly element: JsxElement;
  readonly owner: FunctionNode;
  readonly id: string;
  readonly pattern: string;
  readonly parent: Template | null;
}

interface Call {
  readonly module: Parsed;
  readonly element: JsxElement;
  readonly owner: FunctionNode | null;
  readonly route: Template | null;
  readonly callee: FunctionNode;
}

export function lowerReferenceRoutes(sources: Readonly<Record<string, string>>, resolve: Resolve): Record<string, string> {
  const usesRoutes = (source: string) => /\sroute(?:-to)?\s*=|\$routed\b/.test(source) || source.includes('@memoized-dom/router');
  if (!Object.values(sources).some(usesRoutes)) return { ...sources };

  const modules = Object.entries(sources).map(([path, source]) => parseModule(path, source, resolve));
  const byPath = new Map(modules.map((module) => [module.path, module]));
  const componentOf = (module: Parsed, local: string, seen = new Set<string>()): FunctionNode | null => {
    const own = module.components.get(local);
    if (own !== undefined) return own;
    const imported = module.imports.get(local);
    return imported === undefined ? null : exportedComponent(imported.path, imported.name, seen);
  };
  const exportedComponent = (path: string, name: string, seen: Set<string>): FunctionNode | null => {
    const key = `${path}#${name}`;
    const module = byPath.get(path);
    if (module === undefined || seen.has(key)) return null;
    seen.add(key);
    const exported = module.exports.get(name);
    if (exported === undefined) return null;
    return 'local' in exported ? componentOf(module, exported.local, seen) : exportedComponent(exported.path, exported.name, seen);
  };

  // Templates and calls, module by module.
  const templates: Template[] = [];
  const calls: Call[] = [];
  let next = 0;
  for (const module of modules) {
    const own = new Map<JsxElement, Template>();
    for (const element of findAll(module.program, 'JSXElement')) {
      const owner = ownerOf(module, element);
      const route = attribute(element, 'route');
      if (route !== undefined) {
        if (owner === null) throw new Error('reference: a route must be inside a component');
        const template: Template = {
          module, element, owner, id: `r${next++}`, pattern: normalize(stringValue(route)), parent: routeAround(module, element, owner, own),
        };
        own.set(element, template);
        templates.push(template);
      }
      const name = element.openingElement.name;
      const callee = is.JSXIdentifier(name) && /^[A-Z]/.test(name.name) ? componentOf(module, name.name) : null;
      if (callee !== null) {
        calls.push({ module, element, owner, route: own.get(element) ?? (owner === null ? null : routeAround(module, element, owner, own)), callee });
      }
    }
  }

  // Components that render routes, through any number of calls.
  const routed = new Set(templates.map((template) => template.owner));
  for (let grew = true; grew;) {
    grew = false;
    for (const call of calls) {
      if (call.owner !== null && routed.has(call.callee) && !routed.has(call.owner)) {
        routed.add(call.owner);
        grew = true;
      }
    }
  }

  // Every instance, from the components nothing calls.
  const instances = new Map<string, { pattern: string; fullPattern: string; parent: string | undefined; depth: number }>();
  const join = (context: string | undefined, id: string) => context === undefined ? id : `${context}>>${id}`;
  const visit = (fn: FunctionNode, context: string | undefined, depth: number): void => {
    if (depth > 50) throw new Error('reference: a component that renders routes renders itself');
    for (const template of templates.filter((entry) => entry.owner === fn)) {
      const parentId = template.parent === null ? context : join(context, template.parent.id);
      const parent = parentId === undefined ? undefined : instances.get(parentId);
      const fullPattern = parent === undefined ? template.pattern
        : template.pattern === '/' ? parent.fullPattern
        : parent.fullPattern === '/' ? template.pattern
        : parent.fullPattern + template.pattern;
      instances.set(join(context, template.id), {
        pattern: template.pattern, fullPattern, parent: parentId, depth: parent === undefined ? 0 : parent.depth + 1,
      });
    }
    for (const call of calls.filter((entry) => entry.owner === fn && routed.has(entry.callee))) {
      visit(call.callee, call.route === null ? context : join(context, call.route.id), depth + 1);
    }
  };
  const called = new Set(calls.filter((call) => call.owner !== null).map((call) => call.callee));
  for (const fn of routed) {
    if (!called.has(fn)) visit(fn, undefined, 0);
  }

  // `$routed` preparations: each becomes a registration of its callback and a read of its value,
  // and a route runs those of the component it shows (the one its element calls, or the one that
  // writes the element). The router runs them before the route commits.
  const preparations = new Map<FunctionNode, string[]>();
  const registrations = new Map<Parsed, string[]>();
  let nextPreparation = 0;
  for (const module of modules) {
    for (const call of findAll(module.program, 'CallExpression')) {
      if (!is.Identifier(call.callee) || call.callee.name !== '$routed') continue;
      const owner = ownerOf(module, call);
      const callback = call.arguments[0];
      if (owner === null || callback === undefined) throw new Error('reference: $routed belongs in a component, with a callback');
      const id = `p${nextPreparation++}`;
      preparations.set(owner, [...preparations.get(owner) ?? [], id]);
      registrations.set(module, [...registrations.get(module) ?? [], `$registerRouted(${JSON.stringify(id)}, ${module.source.slice(callback.start, callback.end)});`]);
      wrap(module, call, () => expression(`$routedValue(${JSON.stringify(id)})`));
    }
  }
  const shownBy = (id: string): FunctionNode => {
    const template = templates.find((entry) => id === entry.id || id.endsWith(`>>${entry.id}`))!;
    return calls.find((call) => call.element === template.element)?.callee ?? template.owner;
  };
  const table = [...instances].map(([id, instance]) => ({ id, ...instance, preparations: preparations.get(shownBy(id)) ?? [] }));

  // Rewrite. A template becomes a conditional first, so a routed call on it wraps its element
  // inside that conditional.
  const instanceOf = (template: Template) => `$routeJoin($routeContext(), ${JSON.stringify(template.id)})`;
  for (const template of templates) {
    const read = `$routeIdentity(${instanceOf(template)})`;
    const attributes = template.element.openingElement.attributes;
    attributes.splice(attributes.indexOf(attribute(template.element, 'route')!), 1);
    attributes.push(b.JSXAttribute({
      name: b.JSXIdentifier({ name: 'key' }),
      value: b.JSXExpressionContainer({ expression: expression(read) }),
    }) as (typeof attributes)[number]);
    wrap(template.module, template.element, (inner) => b.LogicalExpression({ operator: '&&', left: expression(read), right: inner }));
  }
  for (const call of calls) {
    if (!routed.has(call.callee)) continue;
    const context = call.route === null ? '$routeContext()' : instanceOf(call.route);
    wrap(call.module, call.element, (inner) => b.CallExpression({
      callee: b.Identifier({ name: '$routeCall' }), arguments: [expression(context), inner], optional: false,
    }));
  }
  for (const module of modules) {
    for (const element of findAll(module.program, 'JSXElement')) {
      const link = attribute(element, 'route-to');
      if (link !== undefined) lowerLink(element, link);
    }
  }

  for (const module of modules) followRouteReads(module);

  // Preparations register first; a module that installs the routes then prepares the first one,
  // as a browser does before it mounts.
  const installed = `\n$installRoutes(${JSON.stringify(table)});\nawait $prepareRoutes();\n`;
  return Object.fromEntries(modules.map((module) => {
    const lowered = generate(module.program).code + `\n${(registrations.get(module) ?? []).join('\n')}`;
    const touched = templates.some((template) => template.module === module) || calls.some((call) => call.module === module);
    return [module.path, touched ? lowered + installed : lowered];
  }));
}

/**
 * Each read of the router's `route` becomes `$followedRoute()`, which records the route as an
 * input of what is computing (`runtime.ts`), as the router reports it to compiled code.
 */
function followRouteReads(module: Parsed): void {
  const locals = new Set<string>();
  for (const statement of module.program.body) {
    if (!is.ImportDeclaration(statement) || statement.source.value !== '@memoized-dom/router') continue;
    for (const specifier of statement.specifiers) {
      if (!is.ImportSpecifier(specifier)) continue;
      const imported = is.Identifier(specifier.imported) ? specifier.imported.name : String(specifier.imported.value);
      if (imported === 'route') locals.add(specifier.local.name);
    }
  }
  if (locals.size === 0) return;

  for (const identifier of findAll(module.program, 'Identifier')) {
    if (!locals.has(identifier.name)) continue;
    const parent = module.parents.get(identifier);
    if (parent === undefined || is.ImportSpecifier(parent)) continue;
    if (is.MemberExpression(parent) && parent.property === identifier && !parent.computed) continue;
    if (is.Property(parent) && parent.key === identifier && !parent.computed && !parent.shorthand) continue;
    wrap(module, identifier, () => expression('$followedRoute()'));
  }
}

/** `route-to="/p"` → `href="/p"`; `route-to={{ path, params, query, hash }}` → `href={$routeHref(…)}`. */
function lowerLink(element: JsxElement, link: JsxAttribute): void {
  const attributes = element.openingElement.attributes;
  let value: Node;
  const written = link.value;
  if (written !== null && is.Literal(written)) {
    value = b.Literal({ value: normalize(String(written.value)), raw: JSON.stringify(normalize(String(written.value))) });
  } else if (written !== null && is.JSXExpressionContainer(written) && is.ObjectExpression(written.expression)) {
    const field = (name: string): Expression => {
      for (const property of (written.expression as Extract<Node, { type: 'ObjectExpression' }>).properties) {
        if (!is.Property(property)) continue;
        const key = is.Identifier(property.key) ? property.key.name : is.Literal(property.key) ? String(property.key.value) : '';
        if (key === name) return property.value as Expression;
      }
      return expression('void 0');
    };
    value = b.JSXExpressionContainer({
      expression: b.CallExpression({
        callee: b.Identifier({ name: '$routeHref' }),
        arguments: [field('path'), field('params'), field('query'), field('hash')],
        optional: false,
      }),
    });
  } else {
    throw new Error('reference: route-to is a string or an object literal');
  }
  attributes.splice(attributes.indexOf(link), 1, b.JSXAttribute({
    name: b.JSXIdentifier({ name: 'href' }), value: value as JsxAttribute['value'],
  }) as (typeof attributes)[number]);
}

/** Replace `node` with `make(node)`, in braces where it is a JSX child. */
function wrap(module: Parsed, node: Node, make: (inner: Expression) => Expression): void {
  const parent = module.parents.get(node)!;
  const made = make(node as Expression);
  const replacement = is.JSXElement(parent) || is.JSXFragment(parent) ? b.JSXExpressionContainer({ expression: made }) as Node : made as Node;
  replaceChild(parent, node, replacement);
  module.parents.set(replacement, parent);
  module.parents.set(made, replacement === made ? parent : replacement);
  module.parents.set(node, made);
}

function parseModule(path: string, source: string, resolve: Resolve): Parsed {
  const { program } = parse(source, { lang: 'tsx', sourceType: 'module' });
  const components = new Map<string, FunctionNode>();
  const imports = new Map<string, { path: string; name: string }>();
  const exports = new Map<string, { local: string } | { path: string; name: string }>();
  const target = (specifier: string) => {
    const resolved = resolve(specifier, path);
    return typeof resolved === 'string' ? resolved : null;
  };

  const declare = (statement: Node, exported: boolean, isDefault: boolean) => {
    if (is.FunctionDeclaration(statement)) {
      const name = statement.id?.name ?? 'default';
      if (/^[A-Z]/.test(name) || isDefault) components.set(name, statement);
      if (exported) exports.set(isDefault ? 'default' : name, { local: name });
    }
    if (is.VariableDeclaration(statement)) {
      for (const declarator of statement.declarations) {
        if (!is.Identifier(declarator.id)) continue;
        const init = declarator.init;
        if (init !== null && (is.ArrowFunctionExpression(init) || is.FunctionExpression(init)) && /^[A-Z]/.test(declarator.id.name)) {
          components.set(declarator.id.name, init);
        }
        if (exported) exports.set(declarator.id.name, { local: declarator.id.name });
      }
    }
  };

  for (const statement of program.body) {
    if (is.ImportDeclaration(statement)) {
      const from = target(String(statement.source.value));
      if (from === null) continue;
      for (const specifier of statement.specifiers) {
        if (is.ImportSpecifier(specifier)) {
          const imported = is.Identifier(specifier.imported) ? specifier.imported.name : String(specifier.imported.value);
          imports.set(specifier.local.name, { path: from, name: imported });
        } else if (is.ImportDefaultSpecifier(specifier)) {
          imports.set(specifier.local.name, { path: from, name: 'default' });
        }
      }
    } else if (is.ExportNamedDeclaration(statement)) {
      if (statement.declaration !== null) declare(statement.declaration, true, false);
      const from = statement.source === null ? null : target(String(statement.source.value));
      for (const specifier of statement.specifiers) {
        if (!is.ExportSpecifier(specifier)) continue;
        const local = is.Identifier(specifier.local) ? specifier.local.name : String(specifier.local.value);
        const name = is.Identifier(specifier.exported) ? specifier.exported.name : String(specifier.exported.value);
        exports.set(name, from === null ? { local } : { path: from, name: local });
      }
    } else if (is.ExportDefaultDeclaration(statement)) {
      const declaration = statement.declaration;
      if (is.FunctionDeclaration(declaration)) declare(declaration, true, true);
      else if (is.Identifier(declaration)) exports.set('default', { local: declaration.name });
      else if (is.ArrowFunctionExpression(declaration) || is.FunctionExpression(declaration)) {
        components.set('default', declaration);
        exports.set('default', { local: 'default' });
      }
    } else {
      declare(statement, false, false);
    }
  }

  return { path, source, program, parents: parentsOf(program), components, imports, exports };
}

/** The top-level component whose markup holds `node`. */
function ownerOf(module: Parsed, node: Node): FunctionNode | null {
  const components = new Set(module.components.values());
  for (let current = module.parents.get(node); current !== undefined; current = module.parents.get(current)) {
    if (components.has(current as FunctionNode)) return current as FunctionNode;
  }
  return null;
}

/** The nearest `route` element around `element`, below its component. */
function routeAround(module: Parsed, element: JsxElement, owner: FunctionNode, templates: ReadonlyMap<JsxElement, Template>): Template | null {
  for (let current = module.parents.get(element); current !== undefined && current !== owner; current = module.parents.get(current)) {
    const template = is.JSXElement(current) ? templates.get(current) : undefined;
    if (template !== undefined) return template;
  }
  return null;
}

function attribute(element: JsxElement, name: string): JsxAttribute | undefined {
  return element.openingElement.attributes.find((entry): entry is JsxAttribute => {
    return is.JSXAttribute(entry) && is.JSXIdentifier(entry.name) && entry.name.name === name;
  });
}

function stringValue(attribute: JsxAttribute): string {
  const value = is.JSXExpressionContainer(attribute.value) ? attribute.value.expression : attribute.value;
  if (value !== null && is.Literal(value) && typeof value.value === 'string') return value.value;
  throw new Error('reference: a route is a static string');
}

/** Without a trailing `/`, except the root. */
function normalize(pattern: string): string {
  const trimmed = pattern.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function expression(text: string): Expression {
  const { program } = parse(`(${text});`, { lang: 'tsx', sourceType: 'module' });
  const statement = program.body[0]!;
  if (!is.ExpressionStatement(statement)) throw new Error(`reference: not an expression: ${text}`);
  return is.ParenthesizedExpression(statement.expression) ? statement.expression.expression : statement.expression;
}

function parentsOf(root: Node): Map<Node, Node> {
  const parents = new Map<Node, Node>();
  const visit = (node: Node) => {
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child !== null && typeof child === 'object' && typeof (child as Node).type === 'string') {
          parents.set(child as Node, node);
          visit(child as Node);
        }
      }
    }
  };
  visit(root);
  return parents;
}

function replaceChild(parent: Node, child: Node, replacement: Node): void {
  for (const [key, value] of Object.entries(parent)) {
    if (value === child) {
      (parent as unknown as Record<string, unknown>)[key] = replacement;
      return;
    }
    if (Array.isArray(value)) {
      const index = value.indexOf(child);
      if (index !== -1) {
        value[index] = replacement;
        return;
      }
    }
  }
  throw new Error('reference: a route element lost its parent');
}
