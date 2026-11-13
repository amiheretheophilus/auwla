/**
 * Server functions (`docs/12-server-functions.md`, `wiki/compiler/server.md`): what a module under
 * `server/functions/` exports, and the client facade that calls it over HTTP.
 *
 * Each export is `define.function({ get|post|put|patch|delete: async (context, ...args) => … })`.
 * The analysis reads the endpoint, its HTTP method and its transported parameters from the
 * module's syntax alone; the facade is what client code imports from `#server-functions`, the same
 * names calling `$fetch` instead of running the body. Ported from the old compiler
 * (`packages/compiler/src/server-functions.ts`), whose output the tests compare against.
 */
import { is } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../core/diagnostics';
import { languageExtensions, moduleText, type SourceLanguage } from '../core/parse/languages';

export type ServerFunctionMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ServerFunctionQueryKind = 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]';

export interface ServerFunctionParameter {
  readonly name: string;
  readonly optional: boolean;
  /** Present only for GET query decoding; mutation bodies keep JSON types. */
  readonly queryKind?: ServerFunctionQueryKind;
}

export interface ServerFunctionDefinition {
  readonly exported: string;
  readonly local: string;
  readonly method: ServerFunctionMethod;
  readonly path: string;
  /** With `input`, the one transported value is the schema's. */
  readonly schemaInput: boolean;
  readonly live?: true;
  readonly generator?: true;
  /** The handler returns markup: a server-owned region (`docs/server-components-design.md`). */
  readonly page?: true;
  readonly parameters: readonly ServerFunctionParameter[];
}

export interface ServerFunctionModule {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly middlewareExport: boolean;
  readonly functions: readonly ServerFunctionDefinition[];
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * The endpoint name of a module: its path inside the functions folder, without the extension,
 * each segment URL-encoded. `''` for the folder itself, `_middleware` for a middleware file.
 * `extensions` are the source languages' (`.auwla`), removed like `.ts`.
 */
export function serverFunctionModuleName(moduleId: string, functionsRoot = 'server/functions', extensions: readonly string[] = []): string {
  const clean = moduleId.replaceAll('\\', '/').split(/[?#]/, 1)[0]!;
  const root = functionsRoot.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  const marker = `/${root}/`;
  const rooted = `/${clean.replace(/^\.\//, '').replace(/^\/+/, '')}`;
  const index = rooted.lastIndexOf(marker);
  if (index === -1) {
    throw new CompileError(`server function module '${moduleId}' is outside '${root}/'`, moduleId);
  }
  const inside = rooted.slice(index + marker.length);
  const language = extensions.find((extension) => inside.endsWith(extension));
  const relative = language !== undefined ? inside.slice(0, -language.length) : inside.replace(/\.(?:[cm]?[jt]sx?|tsrx)$/i, '');
  if (relative === '' || relative === '_middleware') return relative;
  return relative.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * What a server function module exports. Any other export is an error: it would reach the client.
 * A module a source language owns (`languages`) is read as the TSX it becomes, and its errors are
 * located in the authored text.
 */
export function analyzeServerFunctions(
  moduleId: string,
  authored: string,
  functionsRoot = 'server/functions',
  languages?: readonly SourceLanguage[],
): ServerFunctionModule {
  const { text: source, lang, origin } = moduleText(moduleId, authored, languages);
  const { program, diagnostics } = parse(source, { lang, sourceType: 'module' });
  const at = (message: string, offset: number) => CompileError.at(message, moduleId, authored, origin.original(offset));
  const syntax = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (syntax !== undefined) throw at(syntax.message, syntax.start);

  const fail = (message: string, node: Node): never => {
    throw at(message, node.start);
  };
  const moduleName = serverFunctionModuleName(moduleId, functionsRoot, languageExtensions(languages));
  const bindings = definedFunctions(program.body as Node[], fail);
  const functions: ServerFunctionDefinition[] = [];
  let middlewareExport = false;

  for (const exported of exportedLocals(program.body as Node[], fail)) {
    if (exported.exported === 'middleware') {
      middlewareExport = true;
      continue;
    }
    const binding = bindings.get(exported.local);
    if (binding === undefined) {
      fail(`[MMD-S003] Server function module export '${exported.exported}' must be created by define.function() with one get, post, put, patch, or delete handler; only defined functions and 'middleware' may cross the client boundary`, exported.at);
    }
    if (!binding!.handler.async) {
      fail(`[MMD-S003] Server function '${exported.exported}' handler must be async before it can cross the client boundary`, exported.at);
    }
    if (moduleName === '') {
      fail('server/functions root cannot contain endpoints; place functions in a named module', exported.at);
    }
    const { handler, method, schemaInput, live } = binding!;
    functions.push({
      exported: exported.exported,
      local: binding!.local,
      method,
      path: `/_fn/${moduleName}/${encodeURIComponent(exported.exported)}`,
      schemaInput,
      ...(live ? { live: true as const } : {}),
      ...(handler.generator ? { generator: true as const } : {}),
      ...(containsJsx(handler) ? { page: true as const } : {}),
      parameters: parametersOf(handler, method, schemaInput, fail),
    });
  }

  return {
    moduleId,
    moduleName,
    middlewareExport,
    functions: functions.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

// ---------------------------------------------------------------------------
// Definitions

type Handler = Extract<Node, { type: 'FunctionExpression' | 'ArrowFunctionExpression' }>;
type Fail = (message: string, node: Node) => never;

interface DefinedFunction {
  readonly local: string;
  readonly method: ServerFunctionMethod;
  readonly schemaInput: boolean;
  readonly live: boolean;
  readonly handler: Handler;
}

/** `const name = define.function({ … })` at the top of the module, by local name. */
function definedFunctions(body: readonly Node[], fail: Fail): Map<string, DefinedFunction> {
  const functions = new Map<string, DefinedFunction>();
  for (const statement of body) {
    const declaration = is.ExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!is.VariableDeclaration(declaration)) continue;
    for (const item of declaration.declarations) {
      if (!is.Identifier(item.id) || item.init == null) continue;
      const defined = definedFunction(item.id.name, statement, item.init, fail);
      if (defined !== null) functions.set(item.id.name, defined);
    }
  }
  return functions;
}

function definedFunction(local: string, statement: Node, init: Node, fail: Fail): DefinedFunction | null {
  const call = unwrapType(init);
  if (!is.CallExpression(call)) return null;
  const callee = unwrapType(call.callee);
  if (!is.MemberExpression(callee) || callee.computed || propertyName(callee.property) !== 'function') return null;
  if (call.arguments.length !== 1 || is.SpreadElement(call.arguments[0])) {
    fail('define.function() requires exactly one object definition', statement);
  }
  const definition = unwrapType(call.arguments[0]!);
  if (!is.ObjectExpression(definition)) fail('define.function() requires an inline object definition', statement);

  let method: ServerFunctionMethod | null = null;
  let handler: Handler | null = null;
  let schemaInput = false;
  let live = false;
  let updates = false;
  for (const property of (definition as Extract<Node, { type: 'ObjectExpression' }>).properties) {
    if (!is.Property(property) || property.computed) {
      fail('define.function() fields must be explicit; spreads and computed keys hide HTTP method ownership', property);
    }
    const field = property as Extract<Node, { type: 'Property' }>;
    const name = propertyName(field.key);
    if (name === 'input') {
      schemaInput = true;
      continue;
    }
    if (name === 'middleware') continue;
    if (name === 'live' || name === 'updates') {
      if (name === 'live') live = true;
      else updates = true;
      continue;
    }
    if (name === null || !METHODS.has(name)) fail(`unsupported define.function() field '${name ?? 'unknown'}'`, field);
    if (method !== null) fail('define.function() requires exactly one HTTP method: get, post, put, patch, or delete', field);
    method = name!.toUpperCase() as ServerFunctionMethod;
    const value = unwrapType(field.value);
    if (!is.FunctionExpression(value) && !is.ArrowFunctionExpression(value)) {
      fail(`define.function() '${name}' requires an inline handler`, field);
    }
    handler = value as Handler;
  }
  if (method === null || handler === null) {
    return fail('define.function() requires exactly one HTTP method: get, post, put, patch, or delete', statement);
  }
  if ((live && (method !== 'GET' || updates || handler.generator)) || (updates && method === 'GET')) {
    fail('live requires an ordinary GET; updates belongs to mutations', statement);
  }
  return { local, method, schemaInput, live, handler };
}

/** Each runtime export: its exported name, its local name, and where it is written. */
function exportedLocals(body: readonly Node[], fail: Fail): Array<{ exported: string; local: string; at: Node }> {
  const exports: Array<{ exported: string; local: string; at: Node }> = [];
  for (const statement of body) {
    if (is.ExportDefaultDeclaration(statement)) {
      fail('[MMD-S003] server/functions modules use named exports; default exports cannot cross the client boundary', statement);
    }
    if (is.ExportAllDeclaration(statement)) {
      fail('[MMD-S003] re-export server functions through a local named binding so their endpoint and middleware ownership stay explicit', statement);
    }
    if (!is.ExportNamedDeclaration(statement) || statement.exportKind === 'type') continue;
    if (statement.source != null) {
      fail('[MMD-S003] re-export server functions through a local named binding so their endpoint and middleware ownership stay explicit', statement);
    }
    const declaration = statement.declaration;
    if (is.FunctionDeclaration(declaration) && declaration.id != null) {
      exports.push({ exported: declaration.id.name, local: declaration.id.name, at: declaration.id });
    } else if (is.VariableDeclaration(declaration)) {
      for (const item of declaration.declarations) {
        if (is.Identifier(item.id)) exports.push({ exported: item.id.name, local: item.id.name, at: item.id });
      }
    }
    for (const specifier of statement.specifiers) {
      if (!is.ExportSpecifier(specifier) || specifier.exportKind === 'type') continue;
      const exported = is.Identifier(specifier.exported) ? specifier.exported.name : String(specifier.exported.value);
      const local = is.Identifier(specifier.local) ? specifier.local.name : String(specifier.local.value);
      exports.push({ exported, local, at: specifier });
    }
  }
  return exports;
}

// ---------------------------------------------------------------------------
// Parameters: the HTTP contract. A GET's go in the query, so each needs one scalar type.

function parametersOf(handler: Handler, method: ServerFunctionMethod, schemaInput: boolean, fail: Fail): ServerFunctionParameter[] {
  if (schemaInput && handler.params.length > 2) {
    fail('[MMD-S013] a server function with input validation receives at most one schema-owned input after its injected request argument', handler);
  }
  if (schemaInput) return [{ name: 'input', optional: false }];

  return handler.params.slice(1).map((written) => {
    const defaulted = is.AssignmentPattern(written);
    const parameter = defaulted ? written.left : written;
    if (!is.Identifier(parameter)) {
      fail('[MMD-S013] server function parameters must be named identifiers so the HTTP query/body contract is stable', written);
    }
    const name = (parameter as Extract<Node, { type: 'Identifier' }>).name;
    const optional = defaulted || (parameter as { optional?: boolean }).optional === true;
    if (method !== 'GET') return { name, optional };

    const annotation = typeOf(parameter);
    const queryKind = annotation === null
      ? (defaulted ? defaultKind(written.right) : null) ?? 'string'
      : queryKindOf(annotation);
    if (queryKind === null) {
      fail(`[MMD-S003] GET server function parameter '${name}' must use one string, number, or boolean query type; received '${annotation?.type ?? 'unknown'}'`, parameter);
    }
    return { name, optional, queryKind: queryKind! };
  });
}

function typeOf(parameter: Node): Node | null {
  const annotation = (parameter as { typeAnnotation?: Node | null }).typeAnnotation;
  if (annotation == null) return null;
  return is.TSTypeAnnotation(annotation) ? annotation.typeAnnotation : annotation;
}

function scalarKind(type: Node): 'string' | 'number' | 'boolean' | null {
  if (is.TSStringKeyword(type)) return 'string';
  if (is.TSNumberKeyword(type)) return 'number';
  if (is.TSBooleanKeyword(type)) return 'boolean';
  if (!is.TSLiteralType(type)) return null;
  const value = (type.literal as { value?: unknown }).value;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return null;
}

function queryKindOf(type: Node): ServerFunctionQueryKind | null {
  const scalar = scalarKind(type);
  if (scalar !== null) return scalar;
  if (is.TSArrayType(type)) {
    const item = scalarKind(type.elementType);
    return item === null ? null : `${item}[]`;
  }
  if (is.TSUnionType(type)) {
    const kinds = new Set<ServerFunctionQueryKind>();
    for (const member of type.types) {
      if (is.TSUndefinedKeyword(member) || is.TSNullKeyword(member)) continue;
      const kind = queryKindOf(member);
      if (kind === null) return null;
      kinds.add(kind);
    }
    return kinds.size === 1 ? [...kinds][0]! : null;
  }
  return null;
}

function defaultKind(value: Node): ServerFunctionQueryKind | null {
  if (!is.Literal(value)) return null;
  if (typeof value.value === 'string') return 'string';
  if (typeof value.value === 'number') return 'number';
  if (typeof value.value === 'boolean') return 'boolean';
  return null;
}

// ---------------------------------------------------------------------------
// Helpers

function propertyName(node: Node): string | null {
  if (is.Identifier(node)) return node.name;
  if (is.Literal(node) && typeof node.value === 'string') return node.value;
  return null;
}

/** `x as T`, `x satisfies T`, `x!` and `(x)` are `x`. */
function unwrapType(node: Node): Node {
  let current = node;
  while (is.TSAsExpression(current) || is.TSSatisfiesExpression(current) || is.TSNonNullExpression(current)
    || is.ParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function containsJsx(node: Node): boolean {
  let found = false;
  const visit = (value: unknown): void => {
    if (found || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const type = (value as { type?: unknown }).type;
    if (type === 'JSXElement' || type === 'JSXFragment') {
      found = true;
      return;
    }
    for (const key of Object.keys(value)) visit((value as Record<string, unknown>)[key]);
  };
  visit(node);
  return found;
}
