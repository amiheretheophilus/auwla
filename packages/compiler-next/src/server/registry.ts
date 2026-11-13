/**
 * The server's routes for an application's server functions (`wiki/compiler/server.md`,
 * "Registry"): one module that imports every handler and exports `serverFunctionRoutes`, with the
 * middleware of each function's folders, its module and its own definition, plus the endpoint that
 * runs a server-backed `$routed` preparation. Ported from the old Vite plugin
 * (`packages/vite/src/server-functions.ts`), without its file system: the application gives the
 * modules, and imports are relative to where the registry is.
 */
import { is } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../core/diagnostics';
import { moduleText, type SourceLanguage } from '../core/parse/languages';
import { relativeModule } from '../core/resolve/imports';
import type { ServerFunctionModule } from './functions';

/** A module in the functions folder, analyzed. */
export interface DiscoveredFunctions {
  readonly path: string;
  readonly module: ServerFunctionModule;
}

/** `export const x = define.service('name', …)` anywhere in the server folder. */
export interface ServerService {
  readonly path: string;
  readonly exported: string;
  readonly name: string;
}

const MIDDLEWARE_FILE = /(?:^|\/)_middleware\.[^./]+$/;

/**
 * The services a server module registers. Their modules are imported by the registry for that. A
 * module a source language owns is read as its TSX, with errors located in the authored text.
 */
export function serverServices(path: string, authored: string, languages?: readonly SourceLanguage[]): ServerService[] {
  if (!authored.includes('.service')) return [];
  const { text: source, lang, origin } = moduleText(path, authored, languages);
  const { program } = parse(source, { lang, sourceType: 'module' });
  const services: ServerService[] = [];
  for (const statement of program.body as Node[]) {
    if (!is.ExportNamedDeclaration(statement) || !is.VariableDeclaration(statement.declaration)) continue;
    for (const item of statement.declaration.declarations) {
      const call = item.init;
      if (!is.Identifier(item.id) || !is.CallExpression(call)) continue;
      const callee = call.callee;
      if (!is.MemberExpression(callee) || callee.computed || !is.Identifier(callee.property) || callee.property.name !== 'service') continue;
      const first = call.arguments[0];
      if (!is.Literal(first) || typeof first.value !== 'string') {
        throw CompileError.at(`exported service '${item.id.name}' needs a literal service name`, path, authored, origin.original(call.start));
      }
      services.push({ path, exported: item.id.name, name: first.value });
    }
  }
  return services;
}

/** Each service name once across the server folder. */
export function checkServices(services: readonly ServerService[]): void {
  const owners = new Map<string, string>();
  for (const service of services) {
    const owner = owners.get(service.name);
    if (owner !== undefined) {
      throw new CompileError(`service '${service.name}' is exported by both '${owner}' and '${service.path}'`, service.path);
    }
    owners.set(service.name, service.path);
  }
}

/**
 * The registry's source. `functionsFolder` is the project path of the functions folder, which
 * decides which `_middleware.ts` files apply to a module: those of its folder and every folder
 * above it inside the functions folder.
 */
export function serverFunctionRegistry(
  registryPath: string,
  functionsFolder: string,
  modules: readonly DiscoveredFunctions[],
  services: readonly ServerService[],
): string {
  const specifier = (path: string) => JSON.stringify(relativeModule(registryPath, path, true));
  const imports = [
    `import { createServerFunctionRoutes as __mmd_create_routes, invokeRoutedPreparation as __mmd_invoke_routed } from '@memoized-dom/server/router';`,
    ...[...new Set(services.map((service) => service.path))].map((path) => `import ${specifier(path)};`),
  ];

  // Named imports of exactly what the routes use, rather than namespaces: a namespace read is a
  // live input to the compiler (`linking.md`), and these definitions never change.
  const local = (index: number, name: string) => `__mmd_server_${index}_${name.replace(/[^\w$]/g, '_')}`;
  modules.forEach((entry, index) => {
    const names = [...entry.module.functions.map((fn) => fn.exported), ...(entry.module.middlewareExport ? ['middleware'] : [])];
    if (names.length === 0) {
      imports.push(`import ${specifier(entry.path)};`);
      return;
    }
    const specifiers = names.map((name) => `${JSON.stringify(name)} as ${local(index, name)}`);
    imports.push(`import { ${specifiers.join(', ')} } from ${specifier(entry.path)};`);
  });

  // A folder's `_middleware.ts`, by the folder's path inside the functions folder.
  const folderMiddleware = new Map<string, string>();
  modules.forEach((entry, index) => {
    if (!MIDDLEWARE_FILE.test(entry.path)) return;
    if (!entry.module.middlewareExport) {
      throw new CompileError(`server function middleware '${entry.path}' must export a named 'middleware' array`, entry.path);
    }
    folderMiddleware.set(folderOf(functionsFolder, entry.path), local(index, 'middleware'));
  });

  const manifest: unknown[] = [];
  const definitions: string[] = [];
  for (const [index, entry] of modules.entries()) {
    if (MIDDLEWARE_FILE.test(entry.path)) continue;
    const layers = foldersAbove(folderOf(functionsFolder, entry.path))
      .map((folder) => folderMiddleware.get(folder))
      .filter((layer): layer is string => layer !== undefined);
    if (entry.module.middlewareExport) layers.push(local(index, 'middleware'));

    for (const fn of entry.module.functions) {
      const id = `${entry.module.moduleName}/${fn.exported}`;
      const own = local(index, fn.exported);
      manifest.push({ id, method: fn.method, path: fn.path, schemaInput: fn.schemaInput, parameters: fn.parameters });
      definitions.push(`{
        id: ${JSON.stringify(id)},
        method: ${JSON.stringify(fn.method)},
        path: ${JSON.stringify(fn.path)},
        schemaInput: ${JSON.stringify(fn.schemaInput)},
        parameters: ${JSON.stringify(fn.parameters)},
        middleware: [${[...layers.map((layer) => `...${layer}`), `...${own}.middleware`].join(', ')}],
        input: ${own}.input,
        live: ${own}.live,
        updates: ${own}.updates,
        handler: ${own}.handler
      }`);
    }
  }

  return `${imports.join('\n')}
export const serverFunctionManifest = ${JSON.stringify(manifest)};
const __mmd_function_routes = __mmd_create_routes([
${definitions.join(',\n')}
]);
export const serverFunctionRoutes = [...__mmd_function_routes, {
  method: 'POST',
  path: '/_memoized/routed',
  middleware: [],
  async handler(context) {
    const input = await context.request.json();
    if (
      typeof input !== 'object' || input === null ||
      typeof input.id !== 'string' ||
      typeof input.href !== 'string' ||
      typeof input.params !== 'object' || input.params === null ||
      (input.state !== undefined &&
        (typeof input.state !== 'object' || input.state === null))
    ) {
      return Response.json({ error: 'invalid_routed_preparation_input' }, { status: 400 });
    }
    return __mmd_invoke_routed(input, context);
  }
}];
`;
}

/** The `#server-functions` barrel: each module's functions, re-exported from it. */
export function serverFunctionBarrel(barrelPath: string, modules: readonly DiscoveredFunctions[]): string {
  const lines: string[] = [];
  for (const entry of modules) {
    if (MIDDLEWARE_FILE.test(entry.path) || entry.module.functions.length === 0) continue;
    const names = entry.module.functions.map((fn) => fn.exported).join(', ');
    lines.push(`export { ${names} } from ${JSON.stringify(relativeModule(barrelPath, entry.path, true))};`);
  }
  return `${lines.join('\n')}\n`;
}

export function isMiddlewareFile(path: string): boolean {
  return MIDDLEWARE_FILE.test(path);
}

/** A file's folder inside the functions folder: `''` for the folder itself. */
function folderOf(functionsFolder: string, path: string): string {
  const inside = path.slice(functionsFolder.length).replace(/^\/+/, '');
  const slash = inside.lastIndexOf('/');
  return slash === -1 ? '' : inside.slice(0, slash);
}

/** `a/b` → `['', 'a', 'a/b']`: the folder and every folder above it. */
function foldersAbove(folder: string): string[] {
  if (folder === '') return [''];
  const parts = folder.split('/');
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))];
}
