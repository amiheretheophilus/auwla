/** Parser-neutral discovery and client-facade generation for named HTTP functions. */
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  memoizedEstreeFrontend,
  parseWithEstreeFrontendOrThrow,
  type BaseNode,
  type EstreeFrontend,
} from './ast';
import { unwrapTypeExpression, nodeHasJsx } from './context';
import { compilerError } from './errors';

export type ServerFunctionMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

export type ServerFunctionQueryKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export interface ServerFunctionParameter {
  readonly name: string;
  readonly optional: boolean;
  /** Present only for GET query decoding; mutation bodies retain JSON types. */
  readonly queryKind?: ServerFunctionQueryKind;
}

export interface ServerFunctionDefinition {
  readonly exported: string;
  readonly local: string;
  readonly method: ServerFunctionMethod;
  readonly path: string;
  /** Descriptor input is one schema-owned transport value. */
  readonly schemaInput: boolean;
  readonly live?: true;
  readonly generator?: true;
  readonly page?: true;
  readonly parameters: readonly ServerFunctionParameter[];
}

export interface ServerFunctionModule {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly middlewareExport: boolean;
  readonly functions: readonly ServerFunctionDefinition[];
}

export interface AnalyzeServerFunctionOptions {
  readonly moduleId: string;
  readonly functionsRoot?: string;
  readonly frontend?: EstreeFrontend;
}

interface FunctionBinding {
  readonly local: string;
  readonly declaration: BaseNode;
  readonly method: ServerFunctionMethod;
  readonly schemaInput: boolean;
  readonly live: boolean;
  readonly node:
    | t.FunctionExpression
    | t.ArrowFunctionExpression;
}

function record(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function cleanModuleId(moduleId: string): string {
  return moduleId.replaceAll('\\', '/').split(/[?#]/, 1)[0]!;
}

export function serverFunctionModuleName(
  moduleId: string,
  functionsRoot = 'server/functions',
): string {
  const clean = cleanModuleId(moduleId);
  const normalizedRoot = functionsRoot
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
  const marker = `/${normalizedRoot}/`;
  const rooted = `/${clean.replace(/^\.\//, '').replace(/^\/+/, '')}`;
  const index = rooted.lastIndexOf(marker);
  if (index === -1) {
    throw compilerError(
      `memo-dom: server function module '${moduleId}' is outside '${normalizedRoot}/'`,
      moduleId,
    );
  }
  const relative = rooted.slice(index + marker.length)
    .replace(/\.(?:[cm]?[jt]sx?|tsrx)$/i, '');
  if (relative === '' || relative === '_middleware') {
    return relative;
  }
  return relative
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function propertyName(node: BaseNode): string | null {
  const value = record(node);
  if (node.type === 'Identifier') return value.name as string;
  if (node.type === 'Literal' && typeof value.value === 'string') {
    return value.value;
  }
  return null;
}

function definedFunction(
  local: string,
  declaration: BaseNode,
  raw: t.Expression,
  moduleId: string,
): FunctionBinding | null {
  const init = unwrapTypeExpression(raw);
  if (!astFactory.isCallExpression(init)) return null;
  const callee = unwrapTypeExpression(init.callee);
  if (
    !astFactory.isMemberExpression(callee) || callee.computed ||
    propertyName(callee.property as unknown as BaseNode) !== 'function'
  ) return null;
  if (init.arguments.length !== 1 || !astFactory.isExpression(init.arguments[0]!)) {
    throw compilerError(
      'memo-dom: define.function() requires exactly one object definition',
      moduleId,
      declaration,
    );
  }
  const definition = unwrapTypeExpression(init.arguments[0]!);
  if (!astFactory.isObjectExpression(definition)) {
    throw compilerError(
      'memo-dom: define.function() requires an inline object definition',
      moduleId,
      declaration,
    );
  }
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
  let method: ServerFunctionMethod | null = null;
  let handler: t.FunctionExpression | t.ArrowFunctionExpression | null = null;
  let schemaInput = false;
  let live = false;
  let updates = false;
  for (const property of definition.properties) {
    if (property.type !== 'Property' || property.computed) {
      throw compilerError(
        'memo-dom: define.function() fields must be explicit; spreads and computed keys hide HTTP method ownership',
        moduleId,
        property as unknown as BaseNode,
      );
    }
    const name = propertyName(property.key as unknown as BaseNode);
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
    if (name === null || !methods.has(name)) {
      throw compilerError(
        `memo-dom: unsupported define.function() field '${name ?? 'unknown'}'`,
        moduleId,
        property as unknown as BaseNode,
      );
    }
    if (method !== null) {
      throw compilerError(
        'memo-dom: define.function() requires exactly one HTTP method: get, post, put, patch, or delete',
        moduleId,
        property as unknown as BaseNode,
      );
    }
    method = name.toUpperCase() as ServerFunctionMethod;
    const value = unwrapTypeExpression(property.value as t.Expression);
    if (
      !astFactory.isFunctionExpression(value) &&
      !astFactory.isArrowFunctionExpression(value)
    ) {
      throw compilerError(
        `memo-dom: define.function() '${name}' requires an inline handler`,
        moduleId,
        property as unknown as BaseNode,
      );
    }
    handler = value;
  }
  if (method === null || handler === null) {
    throw compilerError(
      'memo-dom: define.function() requires exactly one HTTP method: get, post, put, patch, or delete',
      moduleId,
      declaration,
    );
  }
  if ((live && (method !== 'GET' || updates || handler.generator)) || (updates && method === 'GET')) {
    throw compilerError('memo-dom: live requires an ordinary GET; updates belongs to mutations', moduleId, declaration);
  }
  return { local, declaration, method, schemaInput, live, node: handler };
}

function functionBindings(
  program: t.Program,
  moduleId: string,
): Map<string, FunctionBinding> {
  const functions = new Map<string, FunctionBinding>();
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const item of declaration.declarations) {
      if (!astFactory.isIdentifier(item.id) || item.init === null) continue;
      if (!astFactory.isExpression(item.init)) continue;
      const binding = definedFunction(
        item.id.name,
        statement as unknown as BaseNode,
        item.init,
        moduleId,
      );
      if (binding !== null) functions.set(item.id.name, binding);
    }
  }
  return functions;
}

function exportedLocals(program: t.Program): Array<{
  exported: string;
  local: string;
  at: BaseNode;
}> {
  const exports: Array<{ exported: string; local: string; at: BaseNode }> = [];
  for (const statement of program.body) {
    if (astFactory.isExportDefaultDeclaration(statement)) {
      throw compilerError(
        'memo-dom: [MMD-S003] server/functions modules use named exports; default exports cannot cross the client boundary',
        undefined,
        statement as unknown as BaseNode,
      );
    }
    if (!astFactory.isExportNamedDeclaration(statement)) continue;
    if (record(statement as unknown as BaseNode).exportKind === 'type') continue;
    if (statement.source !== null) {
      throw compilerError(
        'memo-dom: [MMD-S003] re-export server functions through a local named binding so their endpoint and middleware ownership stay explicit',
        undefined,
        statement as unknown as BaseNode,
      );
    }
    const declaration = statement.declaration;
    if (
      astFactory.isFunctionDeclaration(declaration) &&
      declaration.id !== null
    ) {
      exports.push({
        exported: declaration.id.name,
        local: declaration.id.name,
        at: declaration.id as unknown as BaseNode,
      });
    } else if (astFactory.isVariableDeclaration(declaration)) {
      for (const item of declaration.declarations) {
        if (!astFactory.isIdentifier(item.id)) continue;
        exports.push({
          exported: item.id.name,
          local: item.id.name,
          at: item.id as unknown as BaseNode,
        });
      }
    }
    for (const specifier of statement.specifiers) {
      if (!astFactory.isExportSpecifier(specifier)) continue;
      const exported = astFactory.isIdentifier(specifier.exported)
        ? specifier.exported.name
        : specifier.exported.value;
      exports.push({
        exported,
        local: specifier.local.name,
        at: specifier as unknown as BaseNode,
      });
    }
  }
  return exports;
}

function typeNode(identifier: t.Identifier): BaseNode | null {
  const annotation = record(identifier as unknown as BaseNode).typeAnnotation;
  if (
    annotation === null ||
    typeof annotation !== 'object' ||
    !('type' in annotation)
  ) return null;
  const nested = record(annotation as BaseNode).typeAnnotation;
  return nested !== null && typeof nested === 'object' && 'type' in nested
    ? nested as BaseNode
    : null;
}

function literalQueryKind(node: BaseNode): Exclude<ServerFunctionQueryKind,
  'string[]' | 'number[]' | 'boolean[]'> | null {
  if (node.type === 'TSStringKeyword') return 'string';
  if (node.type === 'TSNumberKeyword') return 'number';
  if (node.type === 'TSBooleanKeyword') return 'boolean';
  if (node.type !== 'TSLiteralType') return null;
  const literal = record(node).literal;
  if (literal === null || typeof literal !== 'object' || !('type' in literal)) {
    return null;
  }
  const value = record(literal as BaseNode).value;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return null;
}

function queryKindFromType(node: BaseNode | null): ServerFunctionQueryKind | null {
  if (node === null) return null;
  const scalar = literalQueryKind(node);
  if (scalar !== null) return scalar;
  if (node.type === 'TSArrayType') {
    const element = record(node).elementType;
    if (element === null || typeof element !== 'object' || !('type' in element)) {
      return null;
    }
    const item = literalQueryKind(element as BaseNode);
    return item === null ? null : `${item}[]`;
  }
  if (node.type === 'TSUnionType') {
    const values = record(node).types;
    if (!Array.isArray(values)) return null;
    const kinds = new Set<ServerFunctionQueryKind>();
    for (const value of values) {
      if (value === null || typeof value !== 'object' || !('type' in value)) {
        return null;
      }
      const type = value as BaseNode;
      if (type.type === 'TSUndefinedKeyword' || type.type === 'TSNullKeyword') {
        continue;
      }
      const kind = queryKindFromType(type);
      if (kind === null) return null;
      kinds.add(kind);
    }
    return kinds.size === 1 ? [...kinds][0]! : null;
  }
  return null;
}

function inferredDefaultKind(value: t.Expression): ServerFunctionQueryKind | null {
  if (astFactory.isStringLiteral(value)) return 'string';
  if (astFactory.isNumericLiteral(value)) return 'number';
  if (astFactory.isBooleanLiteral(value)) return 'boolean';
  return null;
}

function parametersFor(
  fn: FunctionBinding['node'],
  method: ServerFunctionMethod,
  moduleId: string,
  schemaInput: boolean,
): ServerFunctionParameter[] {
  if (schemaInput && fn.params.length > 2) {
    throw compilerError(
      'memo-dom: [MMD-S013] a server function with input validation receives at most one schema-owned input after its injected request argument',
      moduleId,
      fn as unknown as BaseNode,
    );
  }
  if (schemaInput) return [{ name: 'input', optional: false }];
  return fn.params.slice(1).map((rawParameter) => {
    const defaulted = astFactory.isAssignmentPattern(rawParameter);
    const parameter = defaulted ? rawParameter.left : rawParameter;
    if (!astFactory.isIdentifier(parameter)) {
      throw compilerError(
        'memo-dom: [MMD-S013] server function parameters must be named identifiers so the HTTP query/body contract is stable',
        moduleId,
        rawParameter as unknown as BaseNode,
      );
    }
    const optional = defaulted ||
      record(parameter as unknown as BaseNode).optional === true;
    if (method !== 'GET') return { name: parameter.name, optional };
    const annotation = typeNode(parameter);
    const queryKind = annotation === null
      ? (defaulted ? inferredDefaultKind(rawParameter.right) : null) ?? 'string'
      : queryKindFromType(annotation);
    if (queryKind === null) {
      throw compilerError(
        `memo-dom: [MMD-S003] GET server function parameter '${parameter.name}' must use one string, number, or boolean query type; received '${annotation?.type ?? 'unknown'}'`,
        moduleId,
        parameter as unknown as BaseNode,
      );
    }
    return { name: parameter.name, optional, queryKind };
  });
}

export function analyzeServerFunctionModule(
  source: string,
  options: AnalyzeServerFunctionOptions,
): ServerFunctionModule {
  const frontend = options.frontend ?? memoizedEstreeFrontend;
  const parsed = parseWithEstreeFrontendOrThrow(frontend, source, {
    filename: options.moduleId,
    sourceType: 'module',
  });
  const program = parsed.program as unknown as t.Program;
  const moduleName = serverFunctionModuleName(
    options.moduleId,
    options.functionsRoot,
  );
  const bindings = functionBindings(program, options.moduleId);
  const functions: ServerFunctionDefinition[] = [];
  let middlewareExport = false;

  for (const exported of exportedLocals(program)) {
    if (exported.exported === 'middleware') {
      middlewareExport = true;
      continue;
    }
    const binding = bindings.get(exported.local);
    if (binding === undefined) {
      throw compilerError(
        `memo-dom: [MMD-S003] Server function module export '${exported.exported}' must be created by define.function() with one get, post, put, patch, or delete handler; only defined functions and 'middleware' may cross the client boundary`,
        options.moduleId,
        exported.at,
      );
    }
    if (!binding.node.async) {
      throw compilerError(
        `memo-dom: [MMD-S003] Server function '${exported.exported}' handler must be async before it can cross the client boundary`,
        options.moduleId,
        exported.at,
      );
    }
    if (moduleName === '') {
      throw compilerError(
        'memo-dom: server/functions root cannot contain endpoints; place functions in a named module',
        options.moduleId,
        exported.at,
      );
    }
    functions.push({
      exported: exported.exported,
      local: binding.local,
      method: binding.method,
      path: `/_fn/${moduleName}/${encodeURIComponent(exported.exported)}`,
      schemaInput: binding.schemaInput,
      ...(binding.live ? { live: true as const } : {}),
      ...(binding.node.generator ? { generator: true as const } : {}),
      ...(nodeHasJsx(binding.node) ? { page:true as const } : {}),
      parameters: parametersFor(
        binding.node,
        binding.method,
        options.moduleId,
        binding.schemaInput,
      ),
    });
  }

  return {
    moduleId: options.moduleId,
    moduleName,
    middlewareExport,
    functions: functions.sort((left, right) =>
      left.path.localeCompare(right.path)),
  };
}

/** Definition calls retain their own metadata; implementation source is unchanged. */
export function generateServerFunctionImplementation(
  source: string,
  _options: AnalyzeServerFunctionOptions,
): string {
  return source;
}

export function generateServerFunctionClient(
  module: ServerFunctionModule,
  dataModule = '@memoized-dom/data',
): string {
  const lines = [`import { $fetch as __mmd_fetch } from ${JSON.stringify(dataModule)};`];
  if (module.functions.some(fn => fn.live || fn.generator)) {
    lines.push(`import { createStreamingSource as __mmd_stream } from ${JSON.stringify(dataModule + '/internal')};`);
  }
  if (module.functions.some(fn => fn.page)) lines.push(`import { createPageSource as __mmd_page } from ${JSON.stringify(dataModule + '/internal')};`,
    `import { loadPageBinding as __mmd_pageBinding } from 'virtual:memoized-dom/page-bindings';`);
  for (const fn of module.functions) {
    const parameters = fn.parameters.map(parameter => parameter.name).join(', ');
    const entries = fn.parameters.map(parameter => parameter.name).join(', ');
    const fetcher = fn.live || fn.generator ? '__mmd_stream' : '__mmd_fetch';
    const stream = fn.live ? 'live' : 'generator';
    if (fn.page) {
      if (fn.generator) throw new Error('memo-dom: page() generator results are not supported');
      const options = fn.method === 'GET'
        ? fn.parameters.length === 0 ? '{}' : fn.schemaInput ? `{query:{input:JSON.stringify(${parameters})}}` : `{query:{${entries}}}`
        : `{method:${JSON.stringify(fn.method)}${fn.parameters.length === 0 ? '' : fn.schemaInput ? `,body:JSON.stringify(${parameters}),headers:{'content-type':'application/json'}` : `,body:{${entries}}`}}`;
      lines.push(`export function ${fn.exported}(${parameters}) { return __mmd_page(${JSON.stringify(fn.path)}, ${options}, ${fn.live ? '"live"' : 'undefined'}, __mmd_pageBinding); }`);
      continue;
    }
    if (fn.live || fn.generator) {
      const options = fn.method === 'GET'
        ? (fn.parameters.length === 0 ? '{}' : fn.schemaInput ? `{ query: { input: JSON.stringify(${parameters}) } }` : `{ query: { ${entries} } }`)
        : `{ method: ${JSON.stringify(fn.method)}, ${fn.parameters.length === 0 ? '' : fn.schemaInput ? `body: JSON.stringify(${parameters}), headers: { 'content-type': 'application/json' }` : `body: { ${entries} }`} }`;
      lines.push(`export function ${fn.exported}(${parameters}) { return ${fetcher}(${JSON.stringify(fn.path)}, ${options}, ${JSON.stringify(stream)}); }`);
      continue;
    }
    if (fn.method === 'GET') {
      const options = fn.parameters.length === 0
        ? ''
        : fn.schemaInput
          ? `, { query: { input: JSON.stringify(${parameters}) } }`
          : `, { query: { ${entries} } }`;
      lines.push(
        `export function ${fn.exported}(${parameters}) { return __mmd_fetch(${JSON.stringify(fn.path)}${options}); }`,
      );
    } else {
      const body = fn.parameters.length === 0
        ? ''
        : fn.schemaInput
          ? `, body: JSON.stringify(${parameters}), headers: { 'content-type': 'application/json' }`
          : `, body: { ${entries} }`;
      lines.push(
        `export function ${fn.exported}(${parameters}) { return __mmd_fetch(${JSON.stringify(fn.path)}, { method: ${JSON.stringify(fn.method)}${body} }); }`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export interface ServerFunctionDeclarationOptions {
  /**
   * Resolves each analyzed module id to the specifier the generated file uses
   * to type-import its real implementation. Type-only, so it erases at runtime
   * and never pulls the server dependency graph into a client build.
   */
  readonly resolveImplementation: (moduleId: string) => string;
  readonly dataModule?: string;
}

/**
 * Emit the client-facing declaration barrel for the application's server
 * functions. Signatures reference the real implementations through
 * `Parameters`/`ReturnType`, so server builds keep their ordinary async
 * TypeScript types while client imports see the colorless `ResolvedValue<T>`
 * contract (readable as `T`, `$track`-able). Exported names must be unique
 * across modules because the barrel is one flat module.
 */
export function generateServerFunctionDeclarations(
  modules: readonly ServerFunctionModule[],
  options: ServerFunctionDeclarationOptions,
): string {
  const lines = [
    '// Generated by @memoized-dom/compiler — client facade declarations for the application server functions.',
    `import type { ResolvedValue } from ${JSON.stringify(options.dataModule ?? '@memoized-dom/data')};`,
    `import type { ErrorResponse, JsonResponse, ServerFunctionArguments, ServerFunctionResult } from '@memoized-dom/server';`,
    'type __mmdClientValue<T> = T extends ErrorResponse ? never : T extends JsonResponse<infer U> ? U : T extends Response ? unknown : T;',
  ];
  const seen = new Map<string, string>();
  const statements: string[] = [];
  let aliasIndex = 0;
  for (const module of modules) {
    if (module.functions.length === 0) continue;
    const alias = `__mmd_impl_${aliasIndex++}`;
    lines.push(
      `import type * as ${alias} from ${JSON.stringify(options.resolveImplementation(module.moduleId))};`,
    );
    for (const fn of module.functions) {
      const owner = seen.get(fn.exported);
      if (owner !== undefined) {
        throw compilerError(
          `memo-dom: [MMD-S012] server function name '${fn.exported}' is exported by both '${owner}' and '${module.moduleId}'; the '#server-functions' barrel requires unique exported names`,
          module.moduleId,
        );
      }
      seen.set(fn.exported, module.moduleId);
      const target = `${alias}.${fn.exported}`;
      statements.push(
        `export declare function ${fn.exported}(...args: ServerFunctionArguments<typeof ${target}>): ResolvedValue<__mmdClientValue<Awaited<ServerFunctionResult<typeof ${target}>>>>;`,
      );
    }
  }
  return `${[...lines, ...statements].join('\n')}\n`;
}
