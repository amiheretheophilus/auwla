/**
 * An application: the client build and, with a server entry, the server build of one project
 * (`wiki/compiler/server.md`, "Application"). Any tool gets SSR from it: Vite, the Bun plugin and
 * the command line only bundle what it gives.
 *
 * Both builds read the same files through one host, each through its own view of it:
 *
 * - `#server-functions` is a generated barrel of facades (`./.memoized/server-functions.ts`), which
 *   call each endpoint over HTTP, in both builds. A component rendered on the server calls them
 *   as the browser does.
 * - In the client build, `#server/*` is never followed: those modules are server-only. A
 *   server-backed `$routed` body that reads one is dropped there (`features/routes/`); any other
 *   `#server/` import left in client output is an error. The entry also installs the hydration
 *   runtime, so it adopts the server's markup.
 * - In the server build, `#server/*` resolves into the server folder the application is given
 *   (`server.folder`; no folder is server-only by its name), and the entry's
 *   `@memoized-dom/server` import resolves to a generated module whose `serve()` installs the
 *   server function routes (`./.memoized/server-functions.server.ts`) and the tool's delivery
 *   module (the page's document and its assets, which depend on where the app runs).
 */
import { is } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../core/diagnostics';
import { languageExtensions, moduleText, type SourceLanguage } from '../core/parse/languages';
import { importCandidates, relativeModule } from '../core/resolve/imports';
import type { CompileModulesOptions } from '../options';
import { isSourcePath } from '../project/collect';
import { normalizeProjectPath, type ProjectHost } from '../project/host';
import { createProject, type ProjectBuild } from '../project/project';
import { analyzeServerFunctions, type ServerFunctionModule } from './functions';
import { SOCKET_BINDING, SOCKET_HOST } from './delivery';
import { serverFunctionClient, serverFunctionDeclarations } from './generate';
import { routeDeclarations } from '../features/routes/declarations';
import { SERVER_CONFIG_DECLARATIONS, serverConfigDeclarations } from './config-declarations';
import { modulePages, PAGE_HYDRATION, PAGES, pageTable, type ModulePages } from './page-build';
import {
  checkServices, isMiddlewareFile, serverFunctionBarrel, serverFunctionRegistry, serverServices,
  type DiscoveredFunctions, type ServerService,
} from './registry';

export interface ApplicationOptions extends CompileModulesOptions {
  /** The browser's entry (`./src/main.ts`). */
  readonly client: string;
  /** The server, for an application rendered on the server. */
  readonly server?: ServerOptions;
  readonly host: ProjectHost;
}

/**
 * Where the server's code is. Nothing is server-only because of its name: the application is
 * told which folder is (the user's direction, 2026-11-12).
 */
export interface ServerOptions {
  /** The server's entry (`./server.ts`). */
  readonly entry: string;
  /**
   * The server-only folder (`./server`): `#server/*` resolves into it, and client code never
   * reaches it. Without one, nothing is server-only, and a `#server/` import is an error.
   */
  readonly folder?: string;
  /** Where server functions are (`docs/12-server-functions.md`). Default: `functions` in `folder`. */
  readonly functions?: string;
  /**
   * The module the server build imports for the page's document and its assets: a default export
   * with `document(request)` and `assets(request)` (`@memoized-dom/server`, `ServerIntegration`),
   * and optionally `routeStyles`, the stylesheets each lazily loaded route component's chunk
   * brings, by the client build's `routeComponents` keys. The tool supplies it. Default
   * `virtual:memoized-dom/delivery`.
   */
  readonly delivery?: string;
  /**
   * Where the built server runs. On `cloudflare`, a Worker calls the exported application as
   * `fetch(request, env, ctx)`; the application reads its bindings as `platform.env` and
   * `platform.executionCtx`, as on every runtime, so the wrapper passes them on. Default `bun`.
   */
  readonly runtime?: 'bun' | 'node' | 'cloudflare';
}

export interface ApplicationBuild {
  readonly client: ProjectBuild;
  /** Present with a server entry. */
  readonly server?: ProjectBuild;
  readonly functions: readonly ServerFunctionModule[];
  /** The `#server-functions` declarations a tool writes for TypeScript; null without functions. */
  readonly declarations: string | null;
  /**
   * `.memoized/routes.d.ts`, which types the app's route patterns for `route-to` and `navigate`
   * (`features/routes/declarations.ts`). Null when the app has no routes; undefined when the client
   * failed to build, so a tool keeps the file it has.
   */
  readonly routeDeclarations?: string | null;
  /**
   * `.memoized/server-config.d.ts`, which types each request's `state`, `platform` and `services`
   * from the server folder's `define` module and services (`config-declarations.ts`). Null
   * without a `define` module.
   */
  readonly serverConfigDeclarations: string | null;
}

/**
 * The declaration files an application build makes for TypeScript, by project path: each tool
 * writes them the same way (`wiki/rules.md`, rule 17). Null removes a file; a file not listed is
 * left as it is (route types, while the client fails to build).
 */
export function declarationFiles(build: ApplicationBuild): Record<string, string | null> {
  return {
    './.memoized/server-functions.d.ts': build.declarations,
    [SERVER_CONFIG_DECLARATIONS]: build.serverConfigDeclarations,
    ...(build.routeDeclarations === undefined ? {} : { './.memoized/routes.d.ts': build.routeDeclarations }),
  };
}

export interface ApplicationUpdate {
  readonly build: ApplicationBuild;
  readonly client: { readonly changed: readonly string[]; readonly removed: readonly string[] };
  readonly server?: { readonly changed: readonly string[]; readonly removed: readonly string[] };
}

export interface Application {
  build(): Promise<ApplicationBuild>;
  update(paths: readonly string[]): Promise<ApplicationUpdate>;
}

/** Where generated modules live, as project paths. */
export const GENERATED = {
  barrel: './.memoized/server-functions.ts',
  registry: './.memoized/server-functions.server.ts',
  server: './.memoized/server-application.ts',
  socketHost: './.memoized/websocket-host.ts',
  facades: './.memoized/functions/',
} as const;

const HYDRATE = "\nimport '@memoized-dom/runtime/hydrate';\n";

export function createApplication(options: ApplicationOptions): Application {
  const { client, server, host, ...compile } = options;
  // Modules a source language owns (`.auwla`) are server code like `.ts` ones: functions,
  // services, `#server/` modules (`core/parse/languages.ts`).
  const { languages } = compile;
  const clientEntry = normalizeProjectPath(client);
  const serverEntry = server === undefined ? undefined : normalizeProjectPath(server.entry);
  const delivery = server?.delivery ?? 'virtual:memoized-dom/delivery';
  /** The declared server-only folder, or null: then nothing is server-only. */
  const root = server?.folder === undefined ? null : folderPath(server.folder);
  const functionsFolder = server?.functions !== undefined ? folderPath(server.functions) : root === null ? null : `${root}/functions`;
  /** The folders client code never reaches: the server folder, and the functions folder outside it. */
  const serverOnlyFolders = [...new Set([root, functionsFolder].filter((folder) => folder !== null))];

  /** The server folder's functions and services, found again by each build. */
  let generated: Generated = { modules: [], services: [], define: null, facades: new Map(), pages: [], texts: { client: new Map(), server: new Map() } };

  async function discover(): Promise<Generated> {
    const modules: DiscoveredFunctions[] = [];
    const services: ServerService[] = [];
    const facades = new Map<string, string>();
    const pages: ModulePages[] = [];
    const pageContext = { host, languages, serverModule: (rest: string) => root === null ? Promise.resolve(false as const) : serverModule(root, rest, host, languages) };
    const folders = [...new Set([root, functionsFolder].filter((folder) => folder !== null))];
    const paths = new Set<string>();
    for (const folder of folders) for (const path of (await host.list?.(folder)) ?? []) paths.add(path);
    for (const path of [...paths].sort()) {
      if (!isSourcePath(path, languages)) continue;
      const text = await host.readFile(path);
      if (text === undefined) continue;
      services.push(...serverServices(path, text, languages));
      if (functionsFolder === null || !path.startsWith(`${functionsFolder}/`)) continue;
      const module = analyzeServerFunctions(path, text, functionsFolder, languages);
      modules.push({ path, module });
      if (!isMiddlewareFile(path) && module.functions.length > 0) {
        facades.set(facadePath(functionsFolder, path, languages), serverFunctionClient(module));
      }
      // Server pages (`page-build.ts`): only a module that returns markup or names `page`.
      const hasMarkup = module.functions.some((fn) => fn.page === true);
      if (!isMiddlewareFile(path) && (hasMarkup || /\bpage\b/.test(text))) {
        const found = await modulePages(pageContext, path, text, functionBase(functionsFolder, path, languages), hasMarkup);
        if (found !== null) pages.push(found);
      }
    }
    checkServices(services);
    // The module whose `define` types every request (`config-declarations.ts`).
    const define = root === null ? false : await serverModule(root, 'define', host, languages);
    return { modules, services, define: define === false ? null : define, facades, pages, texts: pageTexts(pages) };
  }

  /** `#server-functions`: each module's functions, re-exported from its facade. */
  function barrel(): string {
    const facades = generated.modules
      .map((entry) => ({ ...entry, path: facadePath(functionsFolder ?? '', entry.path, languages) }))
      .filter((entry) => generated.facades.has(entry.path));
    return serverFunctionBarrel(GENERATED.barrel, facades);
  }

  /** The host as a build sees it: generated modules, and the imports only that build resolves. */
  function view(side: 'client' | 'server'): ProjectHost {
    function socketPaths(): string[] {
      return generated.modules.flatMap(({ module }) => module.functions
        .filter((fn) => fn.method === 'WEBSOCKET')
        .map((fn) => fn.path));
    }

    return {
      readFile(path) {
        const facade = generated.facades.get(path);
        if (facade !== undefined) return facade;
        // Server pages: the page modules, the browser's table, and the server's copy of a handler.
        const page = generated.texts[side].get(path);
        if (page !== undefined) return page;
        if (path === GENERATED.barrel) return barrel();
        if (side === 'server' && path === GENERATED.registry) {
          return serverFunctionRegistry(GENERATED.registry, functionsFolder ?? '', generated.modules, generated.services);
        }
        if (side === 'server' && path === GENERATED.server) {
          // A relative delivery module is relative to the project, and the wrapper is in `.memoized/`.
          const specifier = delivery.startsWith('.') ? relativeModule(GENERATED.server, normalizeProjectPath(delivery), true) : delivery;
          return serverApplication(specifier, server?.runtime ?? 'bun', socketPaths());
        }
        if (side === 'server' && path === GENERATED.socketHost && serverEntry !== undefined) {
          return cloudflareSocketHostModule(serverEntry, socketPaths());
        }
        const text = host.readFile(path);
        if (side === 'server' && path === serverEntry && server?.runtime === 'cloudflare' && socketPaths().length > 0) {
          const source = relativeModule(serverEntry, GENERATED.socketHost, true);
          return Promise.resolve(text).then(value => value === undefined ? undefined
            : `${value}\nexport { ${SOCKET_HOST} } from ${JSON.stringify(source)};\n`);
        }
        // Appended, so the entry's authored offsets stay in place for its source map.
        if (side === 'client' && path === clientEntry && serverEntry !== undefined) {
          // Pages the server rendered into the document are bound before the entry mounts.
          const pages = generated.texts.client.has(PAGES.hydration)
            ? `import ${JSON.stringify(relativeModule(clientEntry, PAGES.hydration))};\n`
            : '';
          return Promise.resolve(text).then((value) => (value === undefined ? undefined : value + HYDRATE + pages));
        }
        return text;
      },
      async resolve(specifier, importer) {
        if (specifier === '#server-functions') return GENERATED.barrel;
        if (specifier === 'virtual:memoized-dom/page-bindings') return PAGES.table;
        if (specifier.startsWith('#server/')) {
          // Left unresolved, it stays in the output, where `checkServerOnly` reports it.
          if (side === 'client' || root === null) return false;
          return serverModule(root, specifier.slice('#server/'.length), host, languages);
        }
        if (side === 'server') {
          if (specifier === 'virtual:memoized-dom/server-functions') return GENERATED.registry;
          if (specifier === '@memoized-dom/server' && importer !== GENERATED.server && await importsServe(host, importer, languages)) {
            return GENERATED.server;
          }
        }
        return host.resolve?.(specifier, importer);
      },
      ...(host.list === undefined ? {} : { list: host.list.bind(host) }),
    };
  }

  const clientProject = createProject({
    ...compile,
    entries: [clientEntry],
    host: view('client'),
    routedEnvironment: 'client',
    dataDelivery: serverEntry === undefined ? 'client' : 'universal',
  });
  const serverProject = serverEntry === undefined ? null : createProject({
    ...compile,
    entries: [serverEntry],
    host: view('server'),
    routedEnvironment: 'server',
    dataDelivery: 'universal',
    // Backend code, compiled as plain code (`options.ts`, `serverOnly`): the server folder, the
    // entry, and the generated routes and `serve()` wrapper. Not the facades: components call them.
    serverOnly: [...(root === null ? [] : [root]), serverEntry, GENERATED.registry, GENERATED.server, GENERATED.socketHost],
    // Hot replacement is the browser's: a server loads each module again for the next request.
    hot: false,
  });

  /** The modules each program read in its last build, which a failure before building keeps. */
  let lastModules: { client: readonly string[]; server: readonly string[] } = { client: [], server: [] };

  /** A build also waits for the update or build before it: both read and replace the same modules. */
  function build(): Promise<ApplicationBuild> {
    const result = running.then(buildNow, buildNow);
    running = result;
    return result;
  }

  async function buildNow(): Promise<ApplicationBuild> {
    const discovered = await discoverSafely();
    if (discovered instanceof CompileError) return failed(discovered);
    generated = discovered;
    const clientBuild = checkServerOnly(await clientProject.build(), 'client', serverOnlyFolders, languages);
    const serverBuild = await serverProject?.build();
    return finish(clientBuild, serverBuild === undefined ? undefined : checkServerOnly(serverBuild, 'server', serverOnlyFolders, languages));
  }

  /**
   * Updates run one at a time, and edits that arrive while one waits join it
   * (`wiki/compiler/project.md`, "Hot replacement"). Saves made while a build runs then cost one
   * more build together, not one each, and two updates never read and compile at the same time.
   * Everyone who joined gets the same result, whose changes cover all their edits.
   */
  let running: Promise<unknown> = Promise.resolve();
  let waiting: { readonly paths: string[]; readonly result: Promise<ApplicationUpdate> } | null = null;

  function update(paths: readonly string[]): Promise<ApplicationUpdate> {
    if (waiting !== null) {
      waiting.paths.push(...paths);
      return waiting.result;
    }
    const batch = [...paths];
    const start = (): Promise<ApplicationUpdate> => {
      // From here on, a new edit waits for the next update: this one has started reading.
      waiting = null;
      return updateNow(batch);
    };
    // After the one before, whether it compiled, failed or threw.
    const result = running.then(start, start);
    waiting = { paths: batch, result };
    running = result;
    return result;
  }

  async function updateNow(paths: readonly string[]): Promise<ApplicationUpdate> {
    const discovered = await discoverSafely();
    if (discovered instanceof CompileError) {
      const build = failed(discovered);
      return { build, client: { changed: [], removed: [] }, ...(serverProject === null ? {} : { server: { changed: [], removed: [] } }) };
    }
    // A generated module changes with the folder it comes from.
    const folders = [root, functionsFolder].filter((folder) => folder !== null);
    const touchesServer = paths.some((path) => folders.some((folder) => normalizeProjectPath(path).startsWith(`${folder}/`)));
    const generatedPaths = touchesServer ? [GENERATED.barrel, GENERATED.registry, ...generated.facades.keys(), ...discovered.facades.keys()] : [];
    if (touchesServer) {
      generatedPaths.push(GENERATED.server);
      if (server?.runtime === 'cloudflare' && serverEntry !== undefined) {
        generatedPaths.push(GENERATED.socketHost, serverEntry);
      }
    }
    // A page's generated modules change with any module it reaches, inside the server folder or not.
    generatedPaths.push(...changedTexts(generated.texts, discovered.texts));
    if (generated.texts.client.has(PAGES.hydration) !== discovered.texts.client.has(PAGES.hydration)) generatedPaths.push(clientEntry);
    generated = discovered;

    const clientUpdate = await clientProject.update([...paths, ...generatedPaths]);
    const clientBuild = checkServerOnly(clientUpdate.build, 'client', serverOnlyFolders, languages);
    const serverUpdate = await serverProject?.update([...paths, ...generatedPaths]);
    const serverBuild = serverUpdate === undefined ? undefined : checkServerOnly(serverUpdate.build, 'server', serverOnlyFolders, languages);
    return {
      build: finish(clientBuild, serverBuild),
      client: clientBuild.ok ? { changed: clientUpdate.changed, removed: clientUpdate.removed } : { changed: [], removed: [] },
      ...(serverUpdate === undefined ? {} : { server: { changed: serverUpdate.changed, removed: serverUpdate.removed } }),
    };
  }

  async function discoverSafely(): Promise<Generated | CompileError> {
    try {
      return await discover();
    } catch (error) {
      if (error instanceof CompileError) return error;
      throw error;
    }
  }

  /**
   * A failure found before either program builds (finding server functions). Its modules are
   * the last build's: a tool decides from them which edits concern the application, and the
   * edit that fixes this error must count.
   */
  function failed(error: CompileError): ApplicationBuild {
    const client: ProjectBuild = { ok: false, error, modules: lastModules.client };
    const server: ProjectBuild = { ok: false, error, modules: lastModules.server };
    // The declarations of the last discovery that worked, so the editor's types stay while the
    // folder is fixed: a tool would remove a file whose text is null.
    return {
      client,
      ...(serverProject === null ? {} : { server }),
      functions: [],
      ...folderDeclarations(serverFunctionsOf(generated)),
    };
  }

  function finish(clientBuild: ProjectBuild, serverBuild: ProjectBuild | undefined): ApplicationBuild {
    lastModules = { client: clientBuild.modules, server: serverBuild?.modules ?? [] };
    const functions = serverFunctionsOf(generated);
    const routeTypes = clientBuild.ok ? { routeDeclarations: routeDeclarations(clientBuild.routes ?? []) } : {};
    return {
      client: clientBuild,
      ...(serverBuild === undefined ? {} : { server: serverBuild }),
      functions,
      ...folderDeclarations(functions),
      ...routeTypes,
    };
  }

  /** The types of `#server-functions` and of each request, from the server folder's discovery. */
  function folderDeclarations(functions: readonly ServerFunctionModule[]): Pick<ApplicationBuild, 'declarations' | 'serverConfigDeclarations'> {
    const declarations = functions.some((module) => module.functions.length > 0)
      ? serverFunctionDeclarations(functions, (moduleId) => implementationSpecifier(moduleId))
      : null;
    return { declarations, serverConfigDeclarations: serverConfigDeclarations(generated.define, generated.services) };
  }

  return { build, update };
}

/** The server function modules a discovery found, without the middleware files. */
function serverFunctionsOf(generated: Generated): ServerFunctionModule[] {
  return generated.modules.filter((entry) => !isMiddlewareFile(entry.path)).map((entry) => entry.module);
}

interface Generated {
  readonly modules: readonly DiscoveredFunctions[];
  readonly services: readonly ServerService[];
  /** The server folder's `define` module, or null without one. */
  readonly define: string | null;
  /** Facade text by its project path. */
  readonly facades: ReadonlyMap<string, string>;
  readonly pages: readonly ModulePages[];
  /** The server pages' generated texts each build reads, by project path (`page-build.ts`). */
  readonly texts: { readonly client: ReadonlyMap<string, string>; readonly server: ReadonlyMap<string, string> };
}

/**
 * What each build reads for the server pages: both read the page modules and a table (the
 * server's loads nothing); the browser reads the bindings modules, the server the rewritten
 * handlers.
 */
function pageTexts(pages: readonly ModulePages[]): Generated['texts'] {
  const client = new Map<string, string>([[PAGES.table, pageTable(pages, 'client')]]);
  const server = new Map<string, string>([[PAGES.table, pageTable(pages, 'server')]]);
  for (const page of pages) {
    client.set(page.modulePath, page.clientModule);
    server.set(page.modulePath, page.module);
    server.set(page.handlerPath, page.handler);
    if (page.bindingsPath !== undefined && page.bindings !== undefined) client.set(page.bindingsPath, page.bindings);
  }
  if (pages.some((page) => page.bindingsPath !== undefined)) client.set(PAGES.hydration, PAGE_HYDRATION);
  return { client, server };
}

/** The generated paths whose text differs between two discoveries, on either side. */
function changedTexts(before: Generated['texts'], after: Generated['texts']): string[] {
  const changed = new Set<string>();
  for (const side of ['client', 'server'] as const) {
    for (const path of new Set([...before[side].keys(), ...after[side].keys()])) {
      if (before[side].get(path) !== after[side].get(path)) changed.add(path);
    }
  }
  return [...changed];
}

/**
 * A module's path inside the functions folder, without its extension:
 * `./server/functions/users.tsx` → `users`. A language's extension (`.auwla`) goes too.
 */
function functionBase(functionsFolder: string, path: string, languages: readonly SourceLanguage[] | undefined): string {
  const inside = path.slice(functionsFolder.length + 1);
  const language = languageExtensions(languages).find((extension) => inside.endsWith(extension));
  return language !== undefined ? inside.slice(0, -language.length) : inside.replace(/\.[cm]?[jt]sx?$/, '');
}

/** `./server/functions/users.tsx` → `./.memoized/functions/users.ts`: a facade has no markup. */
function facadePath(functionsFolder: string, path: string, languages: readonly SourceLanguage[] | undefined): string {
  return `${GENERATED.facades}${functionBase(functionsFolder, path, languages)}.ts`;
}

/** The project path `#server/<rest>` names, probing extensions as a relative import does. */
async function serverModule(
  root: string, rest: string, host: ProjectHost, languages: readonly SourceLanguage[] | undefined,
): Promise<string | false> {
  for (const candidate of importCandidates(`./${rest}`, `${root}/index.ts`, languageExtensions(languages)) ?? []) {
    if (isSourcePath(candidate, languages) && await host.readFile(candidate) !== undefined) return candidate;
  }
  return false;
}

/**
 * The module the server entry's `@memoized-dom/server` import becomes: everything the package
 * exports, with `serve()` installing the application's routes and the tool's delivery.
 *
 * On Cloudflare, the exported application may be the Worker itself, which the runtime calls as
 * `fetch(request, env, ctx)`. That call becomes `{ platform: { env, executionCtx } }`. A call with
 * two arguments (`app.fetch(request, { platform })`, from a Hono backend) passes through as it is.
 */
function serverApplication(delivery: string, runtime: 'bun' | 'node' | 'cloudflare', sockets: readonly string[]): string {
  const socketImport = sockets.length === 0 ? '' : socketHostImport(runtime, sockets);
  const application = '__mmd_integrate(__mmd_serve(options), __mmd_integration)';
  const attach = sockets.length === 0 ? application : `__mmd_sockets(${application}, ${JSON.stringify(sockets)})`;
  const serve = runtime === 'cloudflare'
    ? `export function serve(options) {
  const application = __mmd_integrate(__mmd_serve(options), __mmd_integration);
  const dispatch = application.fetch;
  application.fetch = (request, options, executionCtx) => {
    ${sockets.length === 0 ? '' : `if (executionCtx !== undefined && __mmd_isSocket(request)) {
      return __mmd_forwardSocket(request, options, ${JSON.stringify(SOCKET_BINDING)});
    }`}
    return dispatch(request, executionCtx === undefined ? options : { platform: { env: options, executionCtx } });
  };
  return application;
}`
    : `export function serve(options) {
  return ${attach};
}`;
  return `export * from '@memoized-dom/server';
import { serve as __mmd_serve, integrateApplication as __mmd_integrate } from '@memoized-dom/server';
import { serverFunctionRoutes as __mmd_routes } from ${JSON.stringify(`./${GENERATED.registry.slice('./.memoized/'.length)}`)};
import __mmd_delivery from ${JSON.stringify(delivery)};
${socketImport}const __mmd_integration = {
  routes: __mmd_routes,
  document: (request) => __mmd_delivery.document?.(request),
  assets: (request, platform) => __mmd_delivery.assets?.(request, platform),
  routeStyles: __mmd_delivery.routeStyles,
};
${serve}
`;
}

function socketHostImport(runtime: 'bun' | 'node' | 'cloudflare', sockets: readonly string[]): string {
  if (runtime === 'cloudflare') {
    return `import { forwardCloudflareSocket as __mmd_forwardSocket, matchesCloudflareSocket as __mmd_matchesSocket } from '@memoized-dom/server/ws-cloudflare';
const __mmd_socketPaths = new Set(${JSON.stringify(sockets)});
const __mmd_isSocket = (request) => __mmd_matchesSocket(request, __mmd_socketPaths);
`;
  }
  const attach = runtime === 'bun' ? 'attachBunSockets' : 'attachNodeSockets';
  return `import { ${attach} as __mmd_sockets } from '@memoized-dom/server/ws-${runtime}';\n`;
}

function cloudflareSocketHostModule(entry: string, sockets: readonly string[]): string {
  // Read the default backend only on dispatch, after the entry's exports initialize.
  return `import backend from ${JSON.stringify(relativeModule(GENERATED.socketHost, entry, true))};
import { cloudflareSocketHost } from '@memoized-dom/server/ws-cloudflare';
export const ${SOCKET_HOST} = cloudflareSocketHost((request, platform) =>
  backend.fetch(request, { platform }), ${JSON.stringify(sockets)});
`;
}

/** From `./.memoized/server-functions.d.ts`, the real module of a function, by its output name. */
function implementationSpecifier(moduleId: string): string {
  return `../${moduleId.replace(/^\.\//, '').replace(/\.[cm]?[jt]sx?$/, '.js')}`;
}

/**
 * A `#server/` import left in output: in a client build it would ship server-only code; in a
 * server build it names a folder no one declared. A client build also may not reach a server-only
 * folder by a relative path (`serverFolderImport`).
 */
function checkServerOnly(
  build: ProjectBuild,
  side: 'client' | 'server',
  serverOnlyFolders: readonly string[],
  languages: readonly SourceLanguage[] | undefined,
): ProjectBuild {
  if (!build.ok) return build;
  for (const folder of side === 'client' ? serverOnlyFolders : []) {
    const reached = serverFolderImport(build.output, folder, languages);
    if (reached !== null) {
      const message = `'${reached.specifier}' is in '${folder}', which is server-only: `
        + `client code calls server functions through '#server-functions'`;
      return { ok: false, error: new CompileError(message, reached.importer), modules: build.modules };
    }
  }
  for (const [path, code] of Object.entries(build.output)) {
    const match = /from\s+["'](#server\/[^"']+)["']|import\s+["'](#server\/[^"']+)["']/.exec(code);
    if (match === null) continue;
    const specifier = match[1] ?? match[2];
    const message = side === 'client'
      ? `'${specifier}' is server-only: client code cannot import it outside a server-backed $routed callback`
      : `'${specifier}' needs the server folder: declare it as server.folder`;
    return { ok: false, error: new CompileError(message, path), modules: build.modules };
  }
  return build;
}

/**
 * A client module that imports a module of the server folder by its path (`../server/db`), which
 * `#server/` would have refused: the import and the module making it. When only the folder's
 * module itself is found (an import the scan does not read), it is reported on its own.
 */
function serverFolderImport(
  output: Readonly<Record<string, string>>,
  folder: string,
  languages: readonly SourceLanguage[] | undefined,
): { importer: string; specifier: string } | null {
  const inFolder = new Set(Object.keys(output).filter((path) => path.startsWith(`${folder}/`)));
  if (inFolder.size === 0) return null;

  const extensions = languageExtensions(languages);
  for (const [path, code] of Object.entries(output)) {
    if (inFolder.has(path)) continue;
    for (const match of code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      const candidates = importCandidates(specifier, path, extensions) ?? [];
      if (candidates.some((candidate) => inFolder.has(candidate))) return { importer: path, specifier };
    }
  }
  const first = [...inFolder][0]!;
  return { importer: first, specifier: first };
}

/**
 * Whether a module takes `serve` from `@memoized-dom/server` (by name, as a namespace, or by
 * re-exporting it). Only those get the generated `serve()`: a module taking `createDefine` from
 * the package, such as the app's `define.ts`, keeps the package itself, since the generated module
 * imports every server function, and server functions import `define`; sending `define.ts` there
 * would make a cycle in which a function reads `define` before it is set. The old Vite plugin
 * decided the same way (`packages/vite/src/fullstack.ts`, `integratedServerImports`).
 */
async function importsServe(host: ProjectHost, importer: string, languages: readonly SourceLanguage[] | undefined): Promise<boolean> {
  const authored = await host.readFile(importer);
  if (authored === undefined) return false;
  const { text, lang } = moduleText(importer, authored, languages);
  const { program } = parse(text, { lang, sourceType: 'module' });
  for (const statement of program.body as Node[]) {
    if (is.ExportAllDeclaration(statement) && statement.source.value === '@memoized-dom/server') return true;
    if ((is.ImportDeclaration(statement) || is.ExportNamedDeclaration(statement)) && statement.source?.value === '@memoized-dom/server') {
      for (const specifier of statement.specifiers) {
        if (is.ImportNamespaceSpecifier(specifier)) return true;
        const name = is.ImportSpecifier(specifier) ? specifier.imported : is.ExportSpecifier(specifier) ? specifier.local : null;
        if (name !== null && (is.Identifier(name) ? name.name : String(name.value)) === 'serve') return true;
      }
    }
  }
  return false;
}

/** A folder as a project path, without a trailing slash. */
function folderPath(folder: string): string {
  return normalizeProjectPath(folder).replace(/\/+$/, '');
}
