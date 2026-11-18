/**
 * `$routed` preparations (`wiki/compiler/routes.md`, "Preparations"; `docs/16-routed.md`).
 *
 *     export function Story() {                         $registerRoutedPreparation({ id: "./Story.tsx#routed:Story:0",
 *       const story = $routed(({ params }) => …);          server: false, prepare: ({ params }) => … });
 *       return <h1>{story.title}</h1>;                   export function Story() {
 *     }                                                    const story = $readRoutedPreparation("./Story.tsx#routed:Story:0");
 *
 * The router runs a route's preparations before the route commits (`router/src/preparation.ts`),
 * so the component reads a value that is already there. The callback moves to the top of the
 * module, which is why it may not capture anything of the component instance; it learns what it
 * needs from its context. A callback that reads `request`, `state`, `services` or `platform`, or
 * a `#server/` import, is server-backed: a client build keeps only its id, and the router asks
 * the server for its value. Sources made inside a callback (`$fetch`, `$read`, a server function)
 * are settled where they are made, so what it returns or caches is data, not a handle.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import type { Module } from '../../core/resolve';
import type { FunctionNode } from '../../core/resolve/functions';
import { componentName } from './collect';

const SERVER_FIELDS = new Set(['request', 'state', 'services', 'platform']);

/** One `$routed(...)` call. */
export interface RoutedPreparation {
  readonly module: Module;
  readonly id: string;
  readonly component: FunctionNode;
  readonly call: Extract<Node, { type: 'CallExpression' }>;
  readonly callback: FunctionNode;
  /** Reads a server-only field or import: a client build omits its body. */
  readonly server: boolean;
  /** `$fetch`, `$read` and server function calls inside it, which are settled where made. */
  readonly sources: readonly Extract<Node, { type: 'CallExpression' }>[];
  /** `#server/` imports only its callback reads, which a client build drops. */
  readonly serverImports: ReadonlySet<Node>;
}

/** Every `$routed` call of a module, checked. */
export function collectPreparations(module: Module, components: ReadonlySet<FunctionNode>): RoutedPreparation[] {
  const preparations: RoutedPreparation[] = [];
  const counters = new Map<FunctionNode, number>();
  const fail = (message: string, node: Node) => CompileError.at(`memo-dom: ${message}`, module.path, module.source, node.start);

  for (const call of module.findAll('CallExpression')) {
    if (!isRoutedCall(module, call)) continue;

    const component = nearestFunction(module, call);
    if (component === null || !components.has(component)) {
      throw fail('$routed must be declared directly in a component, not at module scope or inside a nested callback', call);
    }
    if (!isConstInitializer(module, call)) {
      throw fail('assign $routed directly to a component-local const binding', call);
    }
    const callback = call.arguments[0];
    if (call.arguments.length !== 1) throw fail('$routed requires exactly one inline preparation callback', call);
    if (callback === undefined || !(is.ArrowFunctionExpression(callback) || is.FunctionExpression(callback))) {
      throw fail('$routed requires an inline preparation callback so the compiler can extract its server boundary', callback ?? call);
    }
    if (callback.generator) throw fail('$routed preparation cannot be a generator', callback);

    const fields = contextFields(callback, fail);
    checkCaptures(module, component, callback, fail);
    const serverImports = serverImportsRead(module, callback);
    const index = counters.get(component) ?? 0;
    counters.set(component, index + 1);

    preparations.push({
      module,
      id: `${module.path}#routed:${componentName(module, component)}:${index}`,
      component,
      call,
      callback,
      server: serverImports.size > 0 || fields.some((field) => SERVER_FIELDS.has(field)),
      sources: sourceCalls(module, callback, fail),
      serverImports,
    });
  }

  return preparations;
}

/** `$routed(…)`, written without an import (it is ambient) or imported from the router. */
function isRoutedCall(module: Module, call: Extract<Node, { type: 'CallExpression' }>): boolean {
  if (!is.Identifier(call.callee) || call.callee.name !== '$routed') return false;
  const binding = module.referenceOf(call.callee)?.binding ?? null;
  if (binding === null) return true;
  const imported = module.imports.find((entry) => entry.local === binding);
  return imported?.specifier === '@memoized-dom/router' && imported.name === '$routed';
}

function nearestFunction(module: Module, node: Node): FunctionNode | null {
  let first = true;
  for (const ancestor of module.ancestors(node)) {
    if (first) {
      first = false;
      continue;
    }
    if (is.Function(ancestor)) return ancestor as FunctionNode;
  }
  return null;
}

/** `const page = $routed(…)`, through type assertions. */
function isConstInitializer(module: Module, call: Node): boolean {
  let current: Node = call;
  let parent = module.parentOf(current);
  while (parent !== null && (is.TSAsExpression(parent) || is.TSNonNullExpression(parent) || is.TSSatisfiesExpression(parent)
    || is.ParenthesizedExpression(parent))) {
    current = parent;
    parent = module.parentOf(current);
  }
  if (parent === null || !is.VariableDeclarator(parent) || parent.init !== current || !is.Identifier(parent.id)) return false;
  const declaration = module.parentOf(parent);
  return declaration !== null && is.VariableDeclaration(declaration) && declaration.kind === 'const';
}

/** The context fields the callback destructures, which must all be visible. */
function contextFields(callback: FunctionNode, fail: (message: string, node: Node) => CompileError): string[] {
  if (callback.params.length === 0) return [];
  const param = callback.params[0]!;
  if (callback.params.length !== 1 || !is.ObjectPattern(param)) {
    throw fail('$routed callback must receive one destructured context object', callback);
  }
  const fields: string[] = [];
  for (const property of param.properties) {
    if (is.RestElement(property)) {
      throw fail('$routed context does not support a rest binding because execution capabilities must remain statically visible', property);
    }
    const key = !property.computed && is.Identifier(property.key) ? property.key.name
      : is.Literal(property.key) && typeof property.key.value === 'string' ? property.key.value
      : null;
    if (key === null) throw fail('$routed context fields must use static property names', property);
    fields.push(key);
  }
  return [...new Set(fields)];
}

/** The callback moves to the module's top, so it cannot read a binding of the instance. */
function checkCaptures(module: Module, component: FunctionNode, callback: FunctionNode, fail: (message: string, node: Node) => CompileError): void {
  for (const identifier of module.findAll('Identifier')) {
    if (identifier.start < callback.start || identifier.end > callback.end) continue;
    const binding = module.referenceOf(identifier)?.binding ?? null;
    const declared = binding?.declarations[0];
    if (binding === null || declared === undefined) continue;
    const inComponent = declared.start >= component.start && declared.end <= component.end;
    const inCallback = declared.start >= callback.start && declared.end <= callback.end;
    if (inComponent && !inCallback) {
      throw fail(`$routed preparation cannot capture component-instance binding '${identifier.name}'; pass destination inputs through its context`, identifier);
    }
  }
}

/** The `#server/` import specifiers the callback reads. */
function serverImportsRead(module: Module, callback: FunctionNode): Set<Node> {
  const read = new Set<Node>();
  for (const identifier of module.findAll('Identifier')) {
    if (identifier.start < callback.start || identifier.end > callback.end) continue;
    const declared = module.referenceOf(identifier)?.binding?.declarations[0];
    const specifier = declared === undefined ? null : module.parentOf(declared);
    const declaration = specifier === null ? null : module.parentOf(specifier);
    if (declaration !== null && is.ImportDeclaration(declaration) && String(declaration.source.value).startsWith('#server/')) {
      read.add(specifier!);
    }
  }
  return read;
}

/**
 * Calls inside the callback that make a source: `$fetch`, `$read`, and functions from
 * `#server-functions`. Each is settled where it is made, which needs an async function.
 */
function sourceCalls(
  module: Module,
  callback: FunctionNode,
  fail: (message: string, node: Node) => CompileError,
): Extract<Node, { type: 'CallExpression' }>[] {
  const found: Extract<Node, { type: 'CallExpression' }>[] = [];
  for (const call of module.findAll('CallExpression')) {
    if (call.start < callback.start || call.end > callback.end || !is.Identifier(call.callee)) continue;
    if (!makesSource(module, call.callee)) continue;
    const owner = nearestFunction(module, call);
    if (owner !== callback && !(owner as FunctionNode | null)?.async) {
      throw fail('a colorless source inside a nested $routed callback requires an async callback so its payload can settle', call);
    }
    found.push(call);
  }
  return found;
}

function makesSource(module: Module, callee: Extract<Node, { type: 'Identifier' }>): boolean {
  const binding = module.referenceOf(callee)?.binding ?? null;
  if (binding === null) return callee.name === '$fetch' || callee.name === '$read';
  const imported = module.imports.find((entry) => entry.local === binding);
  if (imported === undefined) return false;
  return (imported.specifier === '@memoized-dom/data' && (imported.name === '$fetch' || imported.name === '$read'))
    || imported.specifier === '#server-functions';
}
