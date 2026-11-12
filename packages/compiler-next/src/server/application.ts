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
 * - In the server build, `#server/*` resolves into the server folder, and the entry's
 *   `@memoized-dom/server` import resolves to a generated module whose `serve()` installs the
 *   server function routes (`./.memoized/server-functions.server.ts`) and the tool's delivery
 *   module (the page's document and its assets, which depend on where the app runs).
 */
import { CompileError } from '../core/diagnostics';
import { importCandidates, relativeModule } from '../core/resolve/imports';
import type { CompileModulesOptions } from '../options';
import { isSourcePath } from '../project/collect';
import { normalizeProjectPath, type ProjectHost } from '../project/host';
import { createProject, type ProjectBuild } from '../project/project';
import { analyzeServerFunctions, type ServerFunctionModule } from './functions';
import { serverFunctionClient, serverFunctionDeclarations } from './generate';
import {
  checkServices, isMiddlewareFile, serverFunctionBarrel, serverFunctionRegistry, serverServices,
  type DiscoveredFunctions, type ServerService,
} from './registry';

export interface ApplicationOptions extends CompileModulesOptions {
  /** The browser's entry (`./src/main.ts`). */
  readonly client: string;
  /** The server's entry (`./server.ts`), for an application rendered on the server. */
  readonly server?: string;
  /** The server-only folder (`docs/12-server-functions.md`). Default `server`. */
  readonly serverRoot?: string;
  /**
   * The module the server build imports for the page's document and its assets: a default export
   * with `document(request)` and `assets(request)` (`@memoized-dom/server`, `ServerIntegration`).
   * The tool supplies it. Default `virtual:memoized-dom/delivery`.
   */
  readonly delivery?: string;
  readonly host: ProjectHost;
}

export interface ApplicationBuild {
  readonly client: ProjectBuild;
  /** Present with a server entry. */
  readonly server?: ProjectBuild;
  readonly functions: readonly ServerFunctionModule[];
  /** The `#server-functions` declarations a tool writes for TypeScript; null without functions. */
  readonly declarations: string | null;
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
  facades: './.memoized/functions/',
} as const;

const HYDRATE = "\nimport '@memoized-dom/runtime/hydrate';\n";

export function createApplication(options: ApplicationOptions): Application {
  const { client, server, serverRoot = 'server', delivery = 'virtual:memoized-dom/delivery', host, ...compile } = options;
  const clientEntry = normalizeProjectPath(client);
  const serverEntry = server === undefined ? undefined : normalizeProjectPath(server);
  const root = normalizeProjectPath(serverRoot).replace(/\/+$/, '');
  const functionsFolder = `${root}/functions`;

  /** The server folder's functions and services, found again by each build. */
  let generated: Generated = { modules: [], services: [], facades: new Map() };

  async function discover(): Promise<Generated> {
    const modules: DiscoveredFunctions[] = [];
    const services: ServerService[] = [];
    const facades = new Map<string, string>();
    for (const path of (await host.list?.(root)) ?? []) {
      if (!isSourcePath(path)) continue;
      const text = await host.readFile(path);
      if (text === undefined) continue;
      services.push(...serverServices(path, text));
      if (!path.startsWith(`${functionsFolder}/`)) continue;
      const module = analyzeServerFunctions(path, text, functionsFolder);
      modules.push({ path, module });
      if (!isMiddlewareFile(path) && module.functions.length > 0) facades.set(facadePath(functionsFolder, path), serverFunctionClient(module));
    }
    checkServices(services);
    return { modules, services, facades };
  }

  /** `#server-functions`: each module's functions, re-exported from its facade. */
  function barrel(): string {
    const facades = generated.modules
      .map((entry) => ({ ...entry, path: facadePath(functionsFolder, entry.path) }))
      .filter((entry) => generated.facades.has(entry.path));
    return serverFunctionBarrel(GENERATED.barrel, facades);
  }

  /** The host as a build sees it: generated modules, and the imports only that build resolves. */
  function view(side: 'client' | 'server'): ProjectHost {
    return {
      readFile(path) {
        const facade = generated.facades.get(path);
        if (facade !== undefined) return facade;
        if (path === GENERATED.barrel) return barrel();
        if (side === 'server' && path === GENERATED.registry) {
          return serverFunctionRegistry(GENERATED.registry, functionsFolder, generated.modules, generated.services);
        }
        if (side === 'server' && path === GENERATED.server) {
          // A relative delivery module is relative to the project, and the wrapper is in `.memoized/`.
          const specifier = delivery.startsWith('.') ? relativeModule(GENERATED.server, normalizeProjectPath(delivery), true) : delivery;
          return serverApplication(specifier);
        }
        const text = host.readFile(path);
        // Appended, so the entry's authored offsets stay in place for its source map.
        if (side === 'client' && path === clientEntry && serverEntry !== undefined) {
          return Promise.resolve(text).then((value) => (value === undefined ? undefined : value + HYDRATE));
        }
        return text;
      },
      async resolve(specifier, importer) {
        if (specifier === '#server-functions') return GENERATED.barrel;
        if (specifier.startsWith('#server/')) {
          if (side === 'client') return false;
          return serverModule(root, specifier.slice('#server/'.length), host);
        }
        if (side === 'server') {
          if (specifier === 'virtual:memoized-dom/server-functions') return GENERATED.registry;
          if (specifier === '@memoized-dom/server' && importer !== GENERATED.server) return GENERATED.server;
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
  });

  async function build(): Promise<ApplicationBuild> {
    const discovered = await discoverSafely();
    if (discovered instanceof CompileError) return failed(discovered);
    generated = discovered;
    const clientBuild = checkClient(await clientProject.build());
    const serverBuild = await serverProject?.build();
    return finish(clientBuild, serverBuild);
  }

  async function update(paths: readonly string[]): Promise<ApplicationUpdate> {
    const discovered = await discoverSafely();
    if (discovered instanceof CompileError) {
      const build = failed(discovered);
      return { build, client: { changed: [], removed: [] }, ...(serverProject === null ? {} : { server: { changed: [], removed: [] } }) };
    }
    // A generated module changes with the folder it comes from.
    const touchesServer = paths.some((path) => normalizeProjectPath(path).startsWith(`${root}/`));
    const generatedPaths = touchesServer ? [GENERATED.barrel, GENERATED.registry, ...generated.facades.keys(), ...discovered.facades.keys()] : [];
    generated = discovered;

    const clientUpdate = await clientProject.update([...paths, ...generatedPaths]);
    const clientBuild = checkClient(clientUpdate.build);
    const serverUpdate = await serverProject?.update([...paths, ...generatedPaths]);
    return {
      build: finish(clientBuild, serverUpdate?.build),
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

  function failed(error: CompileError): ApplicationBuild {
    const failure: ProjectBuild = { ok: false, error, modules: [] };
    return { client: failure, ...(serverProject === null ? {} : { server: failure }), functions: [], declarations: null };
  }

  function finish(clientBuild: ProjectBuild, serverBuild: ProjectBuild | undefined): ApplicationBuild {
    const functions = generated.modules.filter((entry) => !isMiddlewareFile(entry.path)).map((entry) => entry.module);
    let declarations: string | null = null;
    if (functions.some((module) => module.functions.length > 0)) {
      declarations = serverFunctionDeclarations(functions, (moduleId) => implementationSpecifier(moduleId));
    }
    return { client: clientBuild, ...(serverBuild === undefined ? {} : { server: serverBuild }), functions, declarations };
  }

  return { build, update };
}

interface Generated {
  readonly modules: readonly DiscoveredFunctions[];
  readonly services: readonly ServerService[];
  /** Facade text by its project path. */
  readonly facades: ReadonlyMap<string, string>;
}

/** `./server/functions/users.tsx` → `./.memoized/functions/users.ts`: a facade has no markup. */
function facadePath(functionsFolder: string, path: string): string {
  return `${GENERATED.facades}${path.slice(functionsFolder.length + 1).replace(/\.[cm]?[jt]sx?$/, '.ts')}`;
}

/** The project path `#server/<rest>` names, probing extensions as a relative import does. */
async function serverModule(root: string, rest: string, host: ProjectHost): Promise<string | false> {
  for (const candidate of importCandidates(`./${rest}`, `${root}/index.ts`) ?? []) {
    if (isSourcePath(candidate) && await host.readFile(candidate) !== undefined) return candidate;
  }
  return false;
}

/**
 * The module the server entry's `@memoized-dom/server` import becomes: everything the package
 * exports, with `serve()` installing the application's routes and the tool's delivery.
 */
function serverApplication(delivery: string): string {
  return `export * from '@memoized-dom/server';
import { serve as __mmd_serve, integrateApplication as __mmd_integrate } from '@memoized-dom/server';
import { serverFunctionRoutes as __mmd_routes } from ${JSON.stringify(`./${GENERATED.registry.slice('./.memoized/'.length)}`)};
import __mmd_delivery from ${JSON.stringify(delivery)};
export function serve(options) {
  return __mmd_integrate(__mmd_serve(options), {
    get routes() { return __mmd_routes; },
    document: (request) => __mmd_delivery.document?.(request),
    assets: (request, platform) => __mmd_delivery.assets?.(request, platform),
  });
}
`;
}

/** From `./.memoized/server-functions.d.ts`, the real module of a function, by its output name. */
function implementationSpecifier(moduleId: string): string {
  return `../${moduleId.replace(/^\.\//, '').replace(/\.[cm]?[jt]sx?$/, '.js')}`;
}

/** A client build that still imports `#server/` code would ship server-only code. */
function checkClient(build: ProjectBuild): ProjectBuild {
  if (!build.ok) return build;
  for (const [path, code] of Object.entries(build.output)) {
    const match = /from\s+["'](#server\/[^"']+)["']|import\s+["'](#server\/[^"']+)["']/.exec(code);
    if (match !== null) {
      const error = new CompileError(`'${match[1] ?? match[2]}' is server-only: client code cannot import it outside a server-backed $routed callback`, path);
      return { ok: false, error, modules: build.modules };
    }
  }
  return build;
}
