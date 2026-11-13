/**
 * The Vite plugin over compiler-next's applications (`wiki/compiler/project.md`, "Vite"). Selected
 * with `memoizedDom({ compiler: 'next' })` or `MMD_COMPILER=next` until the old compiler is deleted.
 *
 * Vite only serves and bundles what the application gives: the client program to the `client`
 * environment, the server program to `ssr`. Collecting modules, `#server` boundaries, server
 * functions, the server entry's `serve()` and hydration are the application's
 * (`wiki/compiler/server.md`), so the Bun plugin and the command line do the same.
 *
 * - **Loading:** each module the program compiled is loaded from its output, with its source map;
 *   modules that exist only in the build (`./.memoized/…`, companion outputs) are resolved by
 *   probing a relative import as the compiler does.
 * - **Edits:** `hotUpdate` gives the edited file to `application.update()`, once per change for
 *   both environments, and invalidates exactly the outputs that changed in each. A dev build is
 *   compiled with `hot`, so a module exporting only components replaces its live instances.
 * - **Errors** go to Vite with their file, line and column, and the edit that fixes them sends an
 *   update even when the output is the one before the error.
 * - **Delivery:** the server's document and files come from `virtual:memoized-dom/integration`:
 *   Vite's transformed `index.html` and its middleware in development, the built client after a
 *   build (`fullstack.ts`). The production server entry and the native dev launcher (`dev.ts`) are
 *   the old plugin's, through the same `api`.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { normalizePath } from 'vite';
import type { DevEnvironment, EnvironmentModuleNode, Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import {
  createApplication, GENERATED, importCandidates, initialPage, isSourcePath, normalizeProjectPath, projectPath,
  type Application, type ApplicationBuild, type ApplicationUpdate, type CompileError, type ProjectBuild,
} from '@memoized-dom/compiler-next';
import type { MemoizedDomViteOptions } from '../options';
import {
  configureDevelopmentDelivery, developmentIntegrationModule, productionIntegrationModule,
  integrationVirtualId, resolvedIntegrationVirtualId, productionEntryVirtualId, resolvedProductionEntryVirtualId,
  nodeProductionEntry, bunProductionEntry, relocateClientRoot,
  type FullstackPluginApi, type ProductionDelivery,
} from '../fullstack';
import { serverFunctionsVirtualId } from '../server-functions';
import { longPath } from '../paths';
import { viteHost, type ViteResolver } from './host';

/** Packages whose subpaths share state: prebundling them would give the app a second copy. */
const STATEFUL_PACKAGES = ['@memoized-dom/runtime', '@memoized-dom/data', '@memoized-dom/router'];

type Side = 'client' | 'server';

export function memoizedDomNext(options: MemoizedDomViteOptions): Plugin {
  if (options.clientEntry.trim() === '') throw new Error('memoized-dom: clientEntry must not be empty');
  if (options.compilePackages?.length) {
    throw new Error("memoized-dom: compilePackages is not supported with compiler: 'next' yet");
  }
  const { clientEntry, serverEntry, server: serverFolder, runtime = 'bun' } = options;

  let config: ResolvedConfig | undefined;
  let devServer: ViteDevServer | undefined;
  let application: Application | undefined;
  /** How the host resolves aliases: set by the hook that starts a build or an update. */
  let resolver: ViteResolver | null = null;
  let building: Promise<ApplicationBuild> | null = null;
  /** The last update, which both environments' `hotUpdate` share. */
  let lastUpdate: { key: string; result: Promise<ApplicationUpdate> } | null = null;
  /** Environments whose last update failed: their next one must send an update. */
  const failedEnvironments = new Set<string>();
  let productionDelivery: ProductionDelivery | undefined;

  const api: FullstackPluginApi = {
    runtime,
    get serverEntry() {
      return serverEntry === undefined || config === undefined ? serverEntry : resolve(config.root, serverEntry);
    },
    nativeDevelopment: false,
  };

  function rootOf(): string {
    if (config === undefined) throw new Error('memoized-dom: used before Vite resolved its config');
    return config.root;
  }

  /** The project path of a Vite id, whichever way its path was spelled. */
  function pathOf(id: string): string {
    return projectPath(rootOf(), longPath(cleanId(id)));
  }

  /** The file a project path names, as Vite writes ids. */
  function fileOf(path: string): string {
    return normalizePath(resolve(rootOf(), path));
  }

  function built(): Promise<ApplicationBuild> {
    if (application === undefined) throw new Error('memoized-dom: used before Vite resolved its config');
    building ??= application.build().then(withDeclarations);
    return building;
  }

  /** Writes `.memoized/server-functions.d.ts`, which types `#server-functions` for TypeScript. */
  async function withDeclarations(build: ApplicationBuild): Promise<ApplicationBuild> {
    if (build.declarations !== null) {
      const file = join(rootOf(), '.memoized', 'server-functions.d.ts');
      const previous = await readFile(file, 'utf8').catch(() => null);
      if (previous !== build.declarations) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, build.declarations);
      }
    }
    return build;
  }

  function programOf(build: ApplicationBuild, environment: string): ProjectBuild | undefined {
    return sideOf(environment) === 'server' ? build.server : build.client;
  }

  /** Resolution through a hook's plugin context, past this plugin. */
  function contextResolver(context: { resolve: (id: string, importer?: string, options?: { skipSelf?: boolean }) => Promise<{ id: string } | null> }): ViteResolver {
    return async (specifier, importer) => (await context.resolve(specifier, importer, { skipSelf: true }))?.id ?? null;
  }

  /** Resolution through an environment, for `hotUpdate`, which has no plugin context to resolve with. */
  function environmentResolver(environment: DevEnvironment): ViteResolver {
    return async (specifier, importer) => {
      const self = config?.plugins.filter((plugin) => plugin.name === 'memoized-dom') ?? [];
      const resolved = await environment.pluginContainer.resolveId(specifier, importer, {
        skipCalls: self.map((plugin) => ({ id: specifier, importer, plugin })),
      });
      return resolved?.id ?? null;
    };
  }

  /** The modules of each edited output, invalidated, for Vite to send or reload. */
  function invalidate(environment: DevEnvironment, paths: Iterable<string>, timestamp: number): EnvironmentModuleNode[] {
    const seen = new Set<EnvironmentModuleNode>();
    const modules: EnvironmentModuleNode[] = [];
    for (const path of paths) {
      for (const module of environment.moduleGraph.getModulesByFile(fileOf(path)) ?? []) {
        environment.moduleGraph.invalidateModule(module, seen, timestamp, true);
        modules.push(module);
      }
    }
    return modules;
  }

  /** Whether an edit to this project path can change the application. */
  function concerns(path: string, build: ApplicationBuild, type: 'create' | 'update' | 'delete'): boolean {
    if (!isSourcePath(path) || path.includes('/node_modules/')) return false;
    // A new or deleted file can change where any import points.
    if (type !== 'update') return true;
    if (build.client.modules.includes(path) || build.server?.modules.includes(path) === true) return true;
    return serverFolder !== undefined && path.startsWith(`${normalizeProjectPath(serverFolder)}/`);
  }

  const plugin: Plugin = {
    name: 'memoized-dom',
    enforce: 'pre',
    api,

    config(userConfig) {
      const fullstack = serverEntry !== undefined && userConfig.build?.ssr === undefined;
      return {
        ...(serverEntry === undefined ? {} : { appType: 'custom' as const }),
        ...(!fullstack ? {} : {
          builder: { sharedPlugins: true, ...(runtime === 'cloudflare' ? { buildApp: async () => {} } : {}) },
          environments: {
            client: { build: { outDir: 'dist/client' } },
            ...(runtime === 'cloudflare' ? {} : {
              ssr: {
                resolve: { noExternal: ['@memoized-dom/adapters'] },
                build: {
                  outDir: 'dist', ssr: true, copyPublicDir: false, emptyOutDir: false,
                  rollupOptions: { input: productionEntryVirtualId, output: { entryFileNames: 'server.js' } },
                },
              },
            }),
          },
        }),
        optimizeDeps: { exclude: STATEFUL_PACKAGES },
      };
    },

    configEnvironment(name) {
      if (name !== 'client' && name !== 'ssr') return;
      // Scan authored JSX without a React runtime import: this plugin compiles it.
      return { optimizeDeps: { exclude: STATEFUL_PACKAGES, rolldownOptions: { transform: { jsx: 'preserve' as const } } } };
    },

    applyToEnvironment(environment) {
      return environment.name === 'client' || environment.name === 'ssr';
    },

    configResolved(resolved) {
      config = resolved;
      application = createApplication({
        ...compileOptions(options),
        sourceMaps: true,
        hot: resolved.command === 'serve',
        client: normalizeProjectPath(clientEntry),
        ...(serverEntry === undefined ? {} : {
          server: {
            entry: normalizeProjectPath(serverEntry),
            ...(serverFolder === undefined ? {} : { folder: normalizeProjectPath(serverFolder) }),
            delivery: integrationVirtualId,
          },
        }),
        host: viteHost(resolved.root, () => resolver),
      });
    },

    configureServer(server) {
      devServer = server;
      if (serverEntry !== undefined) configureDevelopmentDelivery(server);
    },

    async buildApp(builder) {
      const client = builder.environments.client;
      if (client === undefined) throw new Error('memoized-dom: missing client build environment');
      await builder.build(client);
      if (serverEntry === undefined) return;
      const ssr = builder.environments.ssr;
      if (ssr === undefined) throw new Error('memoized-dom: missing server build environment');
      const clientDirectory = resolve(client.config.root, client.config.build.outDir);
      const serverDirectory = resolve(ssr.config.root, ssr.config.build.outDir);
      productionDelivery = {
        document: await readFile(join(clientDirectory, 'index.html'), 'utf8'),
        files: await filesUnder(clientDirectory),
        base: client.config.base,
        assetsDir: client.config.build.assetsDir,
        clientRoot: relative(serverDirectory, clientDirectory).replaceAll('\\', '/'),
        runtime,
      };
      await builder.build(ssr);
    },

    buildStart() {
      // Each environment's `vite build`, and each dev server, compiles anew, resolving through
      // its own context.
      building = null;
      resolver = contextResolver(this);
    },

    async resolveId(id, importer, resolveOptions) {
      // The dependency scan reads authored files. Waiting for the build here would deadlock: the
      // build resolves packages, which waits for the scan. (Vite passes `scan` to plugins without
      // typing it.)
      if ((resolveOptions as { scan?: boolean }).scan === true) return null;
      if (id === integrationVirtualId && serverEntry !== undefined) return resolvedIntegrationVirtualId;
      if (id === productionEntryVirtualId && serverEntry !== undefined) return resolvedProductionEntryVirtualId;
      // The delivery module's routes import: the application's generated registry.
      if (id === serverFunctionsVirtualId && sideOf(this.environment.name) === 'server') return fileOf(GENERATED.registry);
      if (importer === undefined || !id.startsWith('.') || importer.startsWith('\0')) return null;

      // A relative import from a compiled module may name one that exists only in the build.
      resolver ??= contextResolver(this);
      const program = programOf(await built(), this.environment.name);
      if (program === undefined || !program.ok) return null;
      const from = pathOf(importer);
      if (program.output[from] === undefined) return null;
      const found = (importCandidates(id, from) ?? []).find((candidate) => program.output[candidate] !== undefined);
      return found === undefined ? null : fileOf(found);
    },

    async load(id) {
      if (id === resolvedIntegrationVirtualId) {
        const code = productionDelivery !== undefined
          ? productionIntegrationModule(productionDelivery)
          : developmentIntegrationModule(devServer!, runtime);
        return { code, map: { mappings: '' } };
      }
      if (id === resolvedProductionEntryVirtualId) {
        const entry = api.serverEntry!;
        return { code: runtime === 'node' ? nodeProductionEntry(entry) : bunProductionEntry(entry), map: { mappings: '' } };
      }
      if (id.startsWith('\0') || id.includes('?') || !isSourcePath(id)) return null;

      resolver ??= contextResolver(this);
      const program = programOf(await built(), this.environment.name);
      if (program === undefined) return null;
      const path = pathOf(id);
      if (!program.ok) {
        if (program.modules.includes(path)) this.error(viteError(program.error, fileOf(program.error.path)));
        return null;
      }
      const code = program.output[path];
      if (code === undefined) return null;
      const map = program.maps?.[path];
      // Vite's map type has mutable arrays.
      return { code, map: map === undefined ? null : { ...map, sources: [...map.sources], names: [...map.names], sourcesContent: [...(map.sourcesContent ?? [])] } };
    },

    transformIndexHtml: {
      order: 'pre',
      async handler(html, context) {
        // A page that cannot change ships as its HTML, with no script (`project/page.ts`). Only
        // in a build: a dev server keeps the program, for hot updates. With a server, the server
        // renders the page.
        if (config?.command !== 'build' || serverEntry !== undefined) return html;
        const build = await built();
        if (!build.client.ok) return html;
        return initialPage(html, pathOf(context.filename), build.client) ?? html;
      },
    },

    renderChunk(code, chunk) {
      if (productionDelivery === undefined || this.environment.name !== 'ssr') return null;
      return relocateClientRoot(code, chunk.fileName, productionDelivery.clientRoot) ?? null;
    },

    async hotUpdate(update) {
      if (application === undefined || building === null) return;
      const before = await building.catch(() => null);
      if (before === null) return;
      const path = pathOf(update.file);
      if (!concerns(path, before, update.type)) return;

      // Each environment hears the same change; the application updates once for both.
      const key = `${update.timestamp}\0${path}`;
      if (lastUpdate?.key !== key) {
        resolver = environmentResolver(this.environment);
        const result = application.update([path]).then(async (done) => ({ ...done, build: await withDeclarations(done.build) }));
        lastUpdate = { key, result };
        building = result.then((done) => done.build);
      }
      const result = await lastUpdate.result;
      const environment = this.environment.name;
      const program = programOf(result.build, environment);
      if (program === undefined) return [];
      if (!program.ok) {
        failedEnvironments.add(environment);
        throw viteError(program.error, fileOf(program.error.path));
      }

      const changed = new Set((sideOf(environment) === 'server' ? result.server?.changed : result.client.changed) ?? []);
      // The fix can compile to the output before the error, which still must clear Vite's overlay.
      if (failedEnvironments.delete(environment)) {
        for (const module of program.output[path] === undefined ? Object.keys(program.output) : [path]) changed.add(module);
      }
      return invalidate(this.environment, changed, update.timestamp);
    },
  };
  return plugin;
}

function sideOf(environment: string): Side {
  return environment === 'ssr' ? 'server' : 'client';
}

/** The compiler options the Vite options carry; compiler-next ignores the old compiler's others. */
function compileOptions(options: MemoizedDomViteOptions): { runtimePath?: string } {
  return options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath };
}

function cleanId(id: string): string {
  return id.replace(/[?#].*$/, '');
}

/** A compile error as Vite reports one: its message, file, line and column. */
function viteError(error: CompileError, file: string): Error & { id: string; loc?: { file: string; line: number; column: number } } {
  return Object.assign(new Error(error.message), {
    id: file,
    ...(error.line === undefined ? {} : { loc: { file, line: error.line, column: error.column ?? 0 } }),
  });
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) files.push(...await filesUnder(join(directory, item.name), `${name}/`));
    else if (item.isFile()) files.push(name);
  }
  return files;
}
