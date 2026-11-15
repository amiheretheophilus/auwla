/**
 * Which parts of a page's inputs the browser needs (`wiki/compiler/server.md`, "Server pages").
 *
 * An interactive page's browser program is its whole component (`../decisions.md`, 2026-11-15:
 * adopt now), so it needs every path its components read from each input, text included. Only
 * those cross: with `<Board user={user} />` and `Board` reading `user.name`, the browser gets
 * `user.name`, not `user.password`. A value that reaches code this cannot follow (an unknown call,
 * a spread into an unknown component, a recursive component) crosses whole at that point, and
 * `projectPageInputs` (`packages/server/src/page-inputs.ts`) then refuses what cannot be sent,
 * such as a function or a class instance.
 *
 * It follows the syntax, not the program: values flow through bindings, destructuring, props,
 * member reads, `.map` and other array callbacks, local helpers and imported components. No
 * application code runs. Ported from the old compiler's `packages/compiler/src/page-projection.ts`.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';

type Path = readonly (string | number)[];

/** What a name holds: a path into the inputs, an object of such values, or a function to follow. */
type Value =
  | { readonly path: Path }
  | { readonly fields: Map<string, Value | undefined> }
  | { readonly callable: { readonly module: string; readonly node: Node; readonly environment: Environment } }
  | undefined;
type Environment = Map<string, Value>;

/** The page's modules, parsed, and how their imports resolve among them. */
export interface PageSources {
  program(path: string): readonly Node[] | undefined;
  /** The project path `specifier` names from `importer`, when it is one of the page's modules. */
  resolve(specifier: string, importer: string): string | undefined;
}

const ARRAY_CALLBACKS = new Set(['map', 'filter', 'find', 'findLast', 'some', 'every', 'forEach', 'flatMap']);

/**
 * The paths component `component` of module `root` reads from its inputs, an array of `count`
 * values (`Page0(inputs)`, `pages.ts`). Each path starts with an input's index.
 */
export function pageInputPaths(sources: PageSources, root: string, component: string, count: number): readonly Path[] {
  const paths = new Map<string, Path>();
  /** Functions being followed, so recursion stops. */
  const active = new Set<Node>();

  /** The value is read whole: every path it holds crosses. */
  const consume = (value: Value): void => {
    if (value === undefined) return;
    if ('path' in value) {
      paths.set(JSON.stringify(value.path), value.path);
    } else if ('callable' in value) {
      invoke(value.callable.module, value.callable.node, [], value.callable.environment);
    } else {
      for (const field of value.fields.values()) consume(field);
    }
  };

  const member = (value: Value, key: string | number): Value => {
    if (value === undefined) return undefined;
    if ('path' in value) return { path: [...value.path, key] };
    if ('fields' in value) return value.fields.get(String(key));
    return undefined;
  };

  const bind = (pattern: Node | null | undefined, value: Value, environment: Environment): void => {
    if (pattern == null) return;
    if (is.Identifier(pattern)) {
      environment.set(pattern.name, value);
    } else if (is.AssignmentPattern(pattern)) {
      bind(pattern.left, value, environment);
    } else if (is.ObjectPattern(pattern)) {
      for (const property of pattern.properties) {
        if (is.RestElement(property)) {
          consume(value);
          continue;
        }
        const key = propertyKey(property.key, property.computed);
        if (key === null) {
          consume(value);
          continue;
        }
        bind(property.value, member(value, key), environment);
      }
    } else if (is.ArrayPattern(pattern)) {
      pattern.elements.forEach((element, index) => {
        if (element !== null && is.RestElement(element)) consume(value);
        else bind(element, member(value, index), environment);
      });
    } else {
      consume(value);
    }
  };

  /** A top-level function named `name` in `module`, following its imports among the page's modules. */
  const declaration = (module: string, name: string, seen = new Set<string>()): { module: string; node: Node } | undefined => {
    const key = `${module}\0${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const body = sources.program(module);
    if (body === undefined) return undefined;
    for (const statement of body) {
      if (is.ImportDeclaration(statement)) {
        for (const specifier of statement.specifiers) {
          if (specifier.local.name !== name) continue;
          const target = sources.resolve(String(statement.source.value), module);
          if (target === undefined) return undefined;
          const imported = is.ImportSpecifier(specifier)
            ? (is.Identifier(specifier.imported) ? specifier.imported.name : String(specifier.imported.value))
            : 'default';
          return declaration(target, imported, seen);
        }
      }
      const node: Node = (is.ExportNamedDeclaration(statement) || is.ExportDefaultDeclaration(statement)) && statement.declaration != null
        ? statement.declaration
        : statement;
      if (is.FunctionDeclaration(node)) {
        if (node.id?.name === name || (name === 'default' && is.ExportDefaultDeclaration(statement))) return { module, node };
      }
      if (is.VariableDeclaration(node)) {
        for (const declarator of node.declarations) {
          if (!is.Identifier(declarator.id) || declarator.id.name !== name || declarator.init == null) continue;
          if (is.ArrowFunctionExpression(declarator.init) || is.FunctionExpression(declarator.init)) {
            return { module, node: declarator.init };
          }
        }
      }
    }
    return undefined;
  };

  const invoke = (module: string, fn: Node, args: readonly Value[], outer: Environment = new Map()): void => {
    // A recursive component reads what it reads again; what it passes on crosses whole.
    if (active.has(fn)) {
      for (const arg of args) consume(arg);
      return;
    }
    active.add(fn);
    const environment = new Map(outer);
    const params = 'params' in fn ? (fn.params as Node[]) : [];
    params.forEach((param, index) => bind(param, args[index], environment));
    if ('body' in fn) visit(fn.body as Node, environment, module);
    active.delete(fn);
  };

  const expression = (node: Node | null | undefined, environment: Environment, module: string): Value => {
    if (node == null) return undefined;
    if (is.Identifier(node)) return environment.get(node.name);
    if (is.MemberExpression(node)) {
      const object = expression(node.object, environment, module);
      const key = node.computed ? literalKey(node.property) : is.Identifier(node.property) ? node.property.name : null;
      if (key === null) {
        // `rows[i]`: any row, so the whole value crosses, and the index is read too.
        consume(object);
        visit(node.property, environment, module);
        return undefined;
      }
      return member(object, key);
    }
    if (is.ObjectExpression(node)) {
      const fields = new Map<string, Value>();
      for (const property of node.properties) {
        if (is.SpreadElement(property)) {
          const spread = expression(property.argument, environment, module);
          if (spread !== undefined && 'fields' in spread) {
            for (const [key, value] of spread.fields) fields.set(key, value);
          } else {
            // An opaque spread must not lose its inputs.
            consume(spread);
          }
          continue;
        }
        const key = propertyKey(property.key, property.computed);
        const value = expression(property.value, environment, module);
        if (key === null) consume(value);
        else fields.set(key, value);
      }
      return { fields };
    }
    if (is.CallExpression(node)) return call(node, environment, module);
    if (is.JSXElement(node)) {
      element(node, environment, module);
      return undefined;
    }
    if (is.ArrowFunctionExpression(node) || is.FunctionExpression(node)) {
      return { callable: { module, node, environment } };
    }
    // Anything else (operators, templates, conditionals, statements, JSX children): read each
    // part whole. A value chosen by `a ? user : other` therefore crosses whole, never partly.
    for (const child of children(node)) visit(child, environment, module);
    return undefined;
  };

  const call = (node: Extract<Node, { type: 'CallExpression' }>, environment: Environment, module: string): Value => {
    const callee = node.callee;
    const args = node.arguments as Node[];
    if (is.MemberExpression(callee) && !callee.computed && is.Identifier(callee.property) && ARRAY_CALLBACKS.has(callee.property.name)) {
      const source = expression(callee.object, environment, module);
      const callback = args[0];
      if (callback !== undefined && (is.ArrowFunctionExpression(callback) || is.FunctionExpression(callback))) {
        invoke(module, callback, [member(source, '*')], environment);
      } else {
        consume(source);
        for (const arg of args) consume(expression(arg, environment, module));
        return undefined;
      }
      // What comes out is still the input's rows: `visible = tasks.filter(…)`, then
      // `visible.map(task => task.title)` reads `tasks.*.title`. A `map` makes new values, whose
      // reads its callback already made.
      const name = callee.property.name;
      if (name === 'filter') return source;
      if (name === 'find' || name === 'findLast') return member(source, '*');
      return undefined;
    }
    // `Array.from(rows, (row) => …)` maps each row, as `rows.map` does. It is what `.auwla`'s
    // `for (const row of rows) { … }` in markup becomes.
    const mapper = args[1];
    if (is.MemberExpression(callee) && !callee.computed && is.Identifier(callee.object, 'Array') && is.Identifier(callee.property, 'from')
      && !environment.has('Array') && mapper !== undefined && (is.ArrowFunctionExpression(mapper) || is.FunctionExpression(mapper))) {
      invoke(module, mapper, [member(expression(args[0], environment, module), '*')], environment);
      return undefined;
    }
    const values = args.map((arg) => expression(arg, environment, module));
    const local = is.Identifier(callee) ? environment.get(callee.name) : undefined;
    if (local !== undefined && 'callable' in local) {
      invoke(local.callable.module, local.callable.node, values, local.callable.environment);
      return undefined;
    }
    const helper = is.Identifier(callee) && !environment.has(callee.name) ? declaration(module, callee.name) : undefined;
    if (helper !== undefined) {
      invoke(helper.module, helper.node, values);
      return undefined;
    }
    // An unknown call reads its receiver and arguments whole.
    if (is.MemberExpression(callee)) consume(expression(callee.object, environment, module));
    else consume(expression(callee, environment, module));
    for (const value of values) consume(value);
    return undefined;
  };

  const element = (node: Extract<Node, { type: 'JSXElement' }>, environment: Environment, module: string): void => {
    const opening = node.openingElement;
    const name = is.JSXIdentifier(opening.name) ? opening.name.name : null;
    const component = name !== null && /^[A-Z]/.test(name) ? declaration(module, name) : undefined;
    const props = new Map<string, Value>();
    for (const attribute of opening.attributes) {
      if (is.JSXSpreadAttribute(attribute)) {
        const spread = expression(attribute.argument, environment, module);
        if (component !== undefined && spread !== undefined && 'fields' in spread) {
          for (const [key, value] of spread.fields) props.set(key, value);
        } else {
          consume(spread);
        }
        continue;
      }
      const value = attribute.value;
      const item = value == null ? undefined
        : is.JSXExpressionContainer(value) ? (is.JSXEmptyExpression(value.expression) ? undefined : expression(value.expression, environment, module))
        : expression(value, environment, module);
      const key = is.JSXIdentifier(attribute.name) ? attribute.name.name : null;
      if (component !== undefined && key !== null) props.set(key, item);
      else consume(item);
    }
    // Children are read where they are written, as the old compiler did.
    for (const child of node.children) {
      if (is.JSXExpressionContainer(child)) {
        if (!is.JSXEmptyExpression(child.expression)) consume(expression(child.expression, environment, module));
      } else if (is.JSXElement(child) || is.JSXFragment(child)) {
        consume(expression(child, environment, module));
      }
    }
    // An unknown component tag (a package's) reads its props whole.
    if (component !== undefined) invoke(component.module, component.node, [{ fields: props }]);
    else if (name !== null && /^[A-Z]/.test(name)) for (const value of props.values()) consume(value);
  };

  const visit = (node: Node | null | undefined, environment: Environment, module: string): void => {
    if (node == null) return;
    if (is.VariableDeclaration(node)) {
      for (const declarator of node.declarations) bind(declarator.id, expression(declarator.init, environment, module), environment);
    } else if (is.BlockStatement(node)) {
      const scope = new Map(environment);
      // Helpers stay lexical closures, hoisted declarations included: their captured inputs are
      // read when they are called, after the declarations they read.
      for (const statement of node.body as Node[]) {
        if (is.FunctionDeclaration(statement) && statement.id != null) {
          scope.set(statement.id.name, { callable: { module, node: statement, environment: scope } });
        }
      }
      for (const statement of node.body as Node[]) visit(statement, scope, module);
    } else if (!is.FunctionDeclaration(node)) {
      consume(expression(node, environment, module));
    }
  };

  const fn = declaration(root, component);
  if (fn === undefined) throw new Error(`memo-dom: the page module '${root}' has no component '${component}'`);
  const inputs = new Map<string, Value>(Array.from({ length: count }, (_, index) => [String(index), { path: [index] }]));
  invoke(root, fn.node, [{ fields: inputs }]);
  return [...paths.values()];
}

/** A property's key: `name`, `'name'`, `0`; null for a computed key. */
function propertyKey(key: Node, computed: boolean): string | null {
  if (!computed && is.Identifier(key)) return key.name;
  return literalKey(key);
}

function literalKey(node: Node): string | null {
  if (is.Literal(node) && (typeof node.value === 'string' || typeof node.value === 'number')) return String(node.value);
  return null;
}

/** A node's child nodes, skipping what names rather than reads (keys, declared names). */
function children(node: Node): Node[] {
  const result: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'key' || key === 'id' || key === 'property') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) result.push(item);
    } else if (isNode(value)) {
      result.push(value);
    }
  }
  return result;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
