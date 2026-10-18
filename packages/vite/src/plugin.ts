/**
 * Vite 8 plugin backed by connected compiler graphs and live module HMR.
 */
import { dirname, join, relative, resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import remapping from '@jridgewell/remapping';
import type { CompilerSourceMap } from '@memoized-dom/compiler';
import type {
  DevEnvironment,
  MinimalPluginContextWithoutEnvironment,
  Plugin,
  ResolvedConfig,
} from 'vite';
import type { GraphPluginContext } from './graph/collector';
import { compileGraph } from './graph/collector';
import { discoverPackageArtifact, packageArtifactSource } from './graph/package-artifacts';
import { InstalledPackages } from './graph/installed-packages';
import { writeRoutesDeclaration } from './routes';
import { invalidateManagedModules } from './hmr';
import {
  resolveAdapterOptions,
  type MemoizedDomViteOptions,
} from './options';
import {
  acceptsSource,
  cleanViteId,
  entryFiles,
  normalizeFile,
} from './paths';
import { AdapterState } from './state';
import { ServerPages, isPageModule, pageHydrationId } from './server-pages';
import { configureInspector, inspectorId, resolvedInspectorId, inspectorSource } from './inspector';
import { hydrationBootstrap, hydrationVirtualId, resolvedHydrationVirtualId } from './hydration';
import { applyInitialPage } from './initial-html';
import { initialBootstrapDescriptor } from '@memoized-dom/runtime/server';
import { registerClientStyles } from './dev-assets';
import {
  applicationVirtualId, integrationVirtualId, productionEntryVirtualId,
  resolvedApplicationVirtualId, resolvedIntegrationVirtualId, resolvedProductionEntryVirtualId,
  applicationModule, configureDevelopmentDelivery, developmentIntegrationModule,
  productionIntegrationModule, integratedServerImports, relocateClientRoot,
  nodeProductionEntry, bunProductionEntry,
  type FullstackPluginApi, type ProductionDelivery,
} from './fullstack';
import {
  generateServerFunctionRoutesModule,
  isServerFunctionFile,
  isServerFunctionImplementation,
  serverFunctionImplementationSource,
  resolvedServerFunctionsClientVirtualId,
  resolvedServerFunctionsVirtualId,
  type ServerFunctionBarrelEntry,
  type DiscoveredServerService,
  serverFunctionsClientVirtualId,
  serverFunctionsVirtualId,
  writeServerFunctionDeclarations,
} from './server-functions';
import {
  isServerConfigFile,
  isServerSourceFile,
  resolveServerAlias,
  writeServerConfigDeclaration,
} from './server-config';

const sourceId = /(?:\.[jt]sx?|\.tsrx)(?:$|[?#])/;
const statefulRuntimePackages = [
  '@memoized-dom/runtime',
  '@memoized-dom/data',
  '@memoized-dom/router',
];

interface AdapterTransformContext extends GraphPluginContext {
  environment: Pick<DevEnvironment, 'name' | 'depsOptimizer'>;
}

export function memoizedDom(
  input: MemoizedDomViteOptions,
): Plugin {
  const options = resolveAdapterOptions(input);
  const states = new Map<object, AdapterState>();
  // Secondary graphs compiled on demand for files outside the primary entry
  // graph (e.g. visiting /hacker-news/ while the primary graph is the
  // workspace example). Keyed by the requested source file.
  const lazyStates = new Map<object, Map<string, AdapterState>>();
  const installedPackages = new Map<string, InstalledPackages>();
  const installedWatchFiles = new Set<string>();
  const installedWatchers = new Map<string, FSWatcher>();
  const installedWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let config: ResolvedConfig | undefined;
  let devServer: import('vite').ViteDevServer | undefined;
  let pageReloadPending = false;
  let entries: readonly string[] = [];
  let serverFunctionRoutesSource =
    'export const serverFunctionManifest = [];\nexport const serverFunctionRoutes = [];\n';
  let serverFunctionClientBarrelSource = '';
  let serverFunctionBarrelEntries: readonly ServerFunctionBarrelEntry[] = [];
  let serverServices: readonly DiscoveredServerService[] = [];
  let serverPages: ServerPages | undefined;
  let productionDelivery: ProductionDelivery | undefined;
  const api: FullstackPluginApi = {
    runtime: options.runtime ?? 'bun',
    get serverEntry() {
      return options.serverEntry === undefined || config === undefined ? options.serverEntry : resolve(config.root, options.serverEntry);
    },
    nativeDevelopment: false,
  };

  async function assetFiles(directory: string, prefix = ''): Promise<string[]> {
    const files: string[] = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isDirectory()) files.push(...await assetFiles(join(directory, item.name), name + '/'));
      else if (item.isFile()) files.push(name);
    }
    return files;
  }

  async function refreshServerFunctions(): Promise<readonly string[]> {
    if (config === undefined) return [];
    const generated = await generateServerFunctionRoutesModule(
      config.root,
      options,
    );
    serverFunctionRoutesSource = generated.source;
    serverFunctionClientBarrelSource = generated.clientBarrelSource;
    serverFunctionBarrelEntries = generated.clientBarrelEntries;
    serverServices = generated.services;
    serverPages = new ServerPages(config.root,options,generated.modules,generated.clientBarrelEntries,config.command === 'serve');
    await writeServerFunctionDeclarations(config.root, generated.modules, options);
    return generated.files;
  }

  async function refreshServerConfig(): Promise<string | null> {
    if (config === undefined) return null;
    return writeServerConfigDeclaration(config.root, options, serverServices);
  }

  function stateFor(environment: object): AdapterState {
    let state = states.get(environment);
    if (state === undefined) {
      state = new AdapterState();
      states.set(environment, state);
    }
    return state;
  }

  function graphContext(
    context: GraphPluginContext & { environment?: AdapterTransformContext['environment'] },
  ): GraphPluginContext {
    return {
      compilePackage: context.compilePackage ?? (options.compilePackages?.length ? (id, specifier, importer) =>
        installedFor(context.environment?.name ?? 'client').compile(graphContext(context), id, specifier, importer) : undefined),
      async resolve(specifier, importer, resolveOptions) {
        const resolved = await context.resolve(specifier, importer, resolveOptions);
        return resolved === null ? null : { ...resolved,
          id: packageArtifactSource(resolved.id, context.environment?.depsOptimizer?.metadata) };
      },
      addWatchFile(watched) {
        context.addWatchFile(watched);
        devServer?.watcher.add(watched);
        watchInstalledFile(watched);
      },
      error: (error) => context.error(error),
    };
  }

  function hotGraphContext(
    environment: DevEnvironment,
    context: MinimalPluginContextWithoutEnvironment,
  ): GraphPluginContext {
    return {
      compilePackage: options.compilePackages?.length ? (id, specifier, importer) =>
        installedFor(environment.name).compile(hotGraphContext(environment, context), id, specifier, importer) : undefined,
      async resolve(specifier, importer) {
        const resolved =
          await environment.pluginContainer.resolveId(specifier, importer,
            options.compilePackages?.length && installedFor(environment.name).selected(specifier) ? {
              skipCalls: config?.plugins.filter(plugin => plugin.name === 'memoized-dom')
                .map(plugin => ({ id: specifier, importer, plugin })),
            } : undefined);
        return resolved === null
          ? null
          : { id: packageArtifactSource(resolved.id, environment.depsOptimizer?.metadata), external: resolved.external };
      },
      addWatchFile(watched) {
        environment.pluginContainer.watchFiles.add(watched);
        devServer?.watcher.add(watched);
        watchInstalledFile(watched);
      },
      error: (error) => context.error(error),
    };
  }

  // Vite intentionally ignores node_modules even when addWatchFile is used.
  // Watch only explicitly opted-in source dependencies, never the generated
  // cache, and feed their native filesystem events into the normal HMR path.
  function watchInstalledFile(file: string): void {
    if (!options.compilePackages?.length || !file.replaceAll('\\', '/').includes('/node_modules/') ||
        [...installedPackages.values()].some(manager => manager.owns(file))) return;
    file = normalizeFile(file); installedWatchFiles.add(file);
    if (!devServer) return;
    const directory = dirname(file);
    if (installedWatchers.has(directory)) return;
    const watcher = watch(directory, { persistent: false }, (_event, filename) => {
      const changed = filename ? normalizeFile(join(directory, String(filename))) : undefined;
      for (const dependency of installedWatchFiles) {
        if (dirname(dependency) !== directory || changed && changed !== dependency) continue;
        const previous = installedWatchTimers.get(dependency); if (previous) clearTimeout(previous);
        installedWatchTimers.set(dependency, setTimeout(() => {
          installedWatchTimers.delete(dependency); devServer?.watcher.emit('change', dependency);
        }, 30));
      }
    });
    watcher.on('error', error => devServer?.config.logger.warn(`memoized-dom: package watcher: ${error.message}`));
    installedWatchers.set(directory, watcher);
  }

  function installedFor(environment: string): InstalledPackages {
    let manager = installedPackages.get(environment);
    if (!manager) {
      if (!config) throw new Error('memoized-dom: installed package compilation started before config resolution');
      manager = new InstalledPackages(options, { cacheDir: config.cacheDir, environment,
        conditions: config.environments[environment]?.resolve.conditions ?? config.resolve.conditions });
      installedPackages.set(environment, manager);
    }
    return manager;
  }

  async function pageDocuments(environmentName: string): Promise<readonly { filename: string; html: string }[]> {
    if (!config || config.command !== 'build' || environmentName === 'ssr' || config.build.lib) return [];
    const input = config.build.rollupOptions.input ?? resolve(config.root, 'index.html');
    const files = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input);
    return Promise.all(files.filter(file => file.endsWith('.html')).map(async file => {
      const filename = normalizeFile(resolve(config!.root, file));
      return { filename, html: await readFile(filename, 'utf8') };
    }));
  }

  async function refreshGraph(
    context: GraphPluginContext,
    state: AdapterState,
    overrides: ReadonlyMap<string, string> = new Map(),
    environmentName = 'client',
  ): Promise<void> {
    const graphConfig = config;
    if (graphConfig === undefined) {
      throw new Error(
        'memoized-dom: Vite graph compilation started before config resolution',
      );
    }
    if (state.compiling === undefined) {
      state.compiling = pageDocuments(environmentName).then(documents => compileGraph(
        graphContext(context),
        graphConfig.root,
        entries,
        options,
        overrides,
        graphConfig.command === 'serve' && environmentName !== 'ssr',
        true,
        serverFunctionBarrelEntries,
        environmentName === 'ssr' ? 'server' : 'client',
        documents,
      ));
    }
    const compilation = state.compiling;
    try {
      const graph = await compilation;
      state.replace(graph);
      await writeRoutesDeclaration(graphConfig.root, graph.routes);
      if (devServer !== undefined && environmentName !== 'ssr') {
        registerClientStyles(devServer, state, state.eagerStyles, state.routeStyles, state.routeTree);
      }
    } finally {
      if (state.compiling === compilation) {
        state.compiling = undefined;
      }
    }
  }

  async function refreshLazyGraph(
    context: GraphPluginContext,
    state: AdapterState,
    file: string,
    overrides: ReadonlyMap<string, string> = new Map(),
    environmentName = 'client',
  ): Promise<void> {
    if (config === undefined) {
      throw new Error(
        'memoized-dom: Vite graph compilation started before config resolution',
      );
    }
    const entry = state.entry ?? file;
    if (state.compiling === undefined) {
      state.compiling = compileGraph(
        graphContext(context),
        config.root,
        [entry],
        options,
        overrides,
        config.command === 'serve' && environmentName !== 'ssr',
        false,
        serverFunctionBarrelEntries,
        environmentName === 'ssr' ? 'server' : 'client',
      );
    }
    const compilation = state.compiling;
    try {
      state.replace(await compilation);
      if (devServer !== undefined && environmentName !== 'ssr') {
        registerClientStyles(devServer, state, state.eagerStyles, state.routeStyles, state.routeTree);
      }
    } finally {
      if (state.compiling === compilation) {
        state.compiling = undefined;
      }
    }
  }

  function lazyStateContaining(
    environment: object,
    file: string,
  ): AdapterState | undefined {
    const perFile = lazyStates.get(environment);
    if (perFile === undefined) return undefined;
    const direct = perFile.get(file);
    if (
      direct !== undefined && (
        direct.files.has(file) ||
        direct.css.has(file) ||
        direct.semanticDependencies.has(file)
      )
    ) return direct;
    for (const state of perFile.values()) {
      if (
        state.files.has(file) ||
        state.css.has(file) ||
        state.semanticDependencies.has(file)
      ) return state;
    }
    return undefined;
  }

  function hotStateFor(
    environment: object,
    file: string,
  ): AdapterState | undefined {
    const primary = states.get(environment);
    if (
      primary !== undefined && (
        primary.files.has(file) ||
        primary.css.has(file) ||
        primary.semanticDependencies.has(file)
      )
    ) return primary;
    return lazyStateContaining(environment, file);
  }

  async function finishPendingCompilation(state: AdapterState): Promise<void> {
    const pending = state.compiling;
    if (pending === undefined) return;
    try {
      await pending;
    } catch {
      // The update that owns this compilation reports its own error. A newer
      // edit must compile again with its own source instead of inheriting the
      // stale rejection.
    } finally {
      if (state.compiling === pending) state.compiling = undefined;
    }
  }

  function lazyStatesFor(environment: object): Map<string, AdapterState> {
    let perFile = lazyStates.get(environment);
    if (perFile === undefined) {
      perFile = new Map<string, AdapterState>();
      lazyStates.set(environment, perFile);
    }
    return perFile;
  }

  function clientEntryCode(
    file: string,
    code: string,
    environment: { name: string },
  ): string {
    if (
      options.serverEntry === undefined ||
      environment.name === 'ssr' ||
      stateFor(environment).initialPage !== undefined ||
      !entries.includes(file)
    ) return code;
    // Fullstack entries mount over server markup: append the side-effect
    // import that installs the hydration runtime. Appending after the
    // compiled body keeps existing sourcemap lines exact.
    return `${code}\nimport ${JSON.stringify(config?.command === 'build' ? hydrationVirtualId : '@memoized-dom/runtime/hydrate')};\n${serverPages?.enabled ? `import ${JSON.stringify(pageHydrationId)};\n` : ''}`;
  }

  async function transformModule(
    context: AdapterTransformContext,
    code: string,
    id: string,
  ): Promise<{ code: string; map: CompilerSourceMap } | null> {
    if (
      config === undefined ||
      !sourceId.test(id) ||
      isPageModule(id) ||
      id.includes('?memo-style.css') ||
      isServerFunctionImplementation(id)
    ) return null;
    const file = cleanViteId(id);
    if ([...installedPackages.values()].some(manager => manager.owns(file))) return null;
    const state = stateFor(context.environment);
    let managed = entries.includes(file) || state.files.has(file);

    // The SSR environment also loads the application's ordinary server
    // entry and its implementation modules. Plain .ts/.js files outside the
    // connected browser entry graph are server code, not UI compiler roots.
    // JSX/TSRX files remain eligible for on-demand SSR compilation.
    if (
      context.environment.name === 'ssr' &&
      !managed &&
      /\.[jt]s$/.test(file)
    ) return null;

    if (context.environment.name === 'ssr' && config.command === 'serve' && state.output.size === 0) {
      await refreshGraph(context, state, new Map([[file, code]]), 'ssr');
      managed = entries.includes(file) || state.files.has(file);
    }

    const cached = managed ? state.output.get(file) : undefined;
    if (cached !== undefined) {
      return {
        code: clientEntryCode(file, cached, context.environment),
        map: state.maps.get(file)!,
      };
    }

    if (managed) {
      if (state.compiling === undefined) {
        await refreshGraph(
          context,
          state,
          new Map([[file, code]]),
          context.environment.name,
        );
      } else {
        await refreshGraph(context, state, new Map(), context.environment.name);
      }
      const compiled = state.output.get(file);
      if (compiled === undefined) {
        if (!entries.includes(file)) return null;
        throw new Error(
          `memoized-dom: linked Vite graph omitted managed module ${file}`,
        );
      }
      return {
        code: clientEntryCode(file, compiled, context.environment),
        map: state.maps.get(file)!,
      };
    }

    // Outside the primary graph: compile a mount-less graph rooted at the
    // requested file so directly visited example pages work regardless of
    // which graph MMD_EXAMPLE selected.
    if (!acceptsSource(config.root, file, options)) return null;
    const perFile = lazyStatesFor(context.environment);
    let lazy = lazyStateContaining(context.environment, file);
    if (lazy === undefined) {
      lazy = new AdapterState();
      lazy.entry = file;
      perFile.set(file, lazy);
    }
    const lazyCached = lazy.output.get(file);
    if (lazyCached !== undefined) {
      return { code: lazyCached, map: lazy.maps.get(file)! };
    }
    if (lazy.compiling === undefined) {
      lazy.compiling = compileGraph(
        graphContext(context),
        config.root,
        [file],
        options,
        new Map([[file, code]]),
        config.command === 'serve' && context.environment.name !== 'ssr',
        false,
        serverFunctionBarrelEntries,
        context.environment.name === 'ssr' ? 'server' : 'client',
      );
    }
    const compilation = lazy.compiling;
    try {
      lazy.replace(await compilation);
      if (devServer !== undefined && context.environment.name !== 'ssr') {
        registerClientStyles(devServer, lazy, lazy.eagerStyles, lazy.routeStyles, lazy.routeTree);
      }
    } finally {
      if (lazy.compiling === compilation) {
        lazy.compiling = undefined;
      }
    }
    const lazyCompiled = lazy.output.get(file);
    if (lazyCompiled === undefined) return null;
    return { code: lazyCompiled, map: lazy.maps.get(file)! };
  }

  return {
    name: 'memoized-dom',
    enforce: 'pre',
    api,
    config(userConfig) {
      // These packages intentionally share realm/runtime state across public
      // subpath entries (`data` + `data/internal`, and router internals).
      // Prebundling deep imports as independent optimized entries duplicates
      // that state and can hide a registered root from mount(). Let Vite serve their emitted
      // ESM chunks directly so every subpath converges on one module record.
      return {
        ...(options.serverEntry === undefined ? {} : { appType: 'custom' as const }),
        ...(options.serverEntry === undefined || userConfig.build?.ssr ? {} : {
          builder: { sharedPlugins: true, ...(options.runtime === 'cloudflare' ? { buildApp: async () => {} } : {}) },
          environments: {
            client: { build: { outDir: 'dist/client' } },
            ...(options.runtime === 'cloudflare' ? {} : {
              ssr: { resolve: { noExternal: ['@memoized-dom/adapters'] },
                build: { outDir: 'dist', ssr: true, copyPublicDir: false, emptyOutDir: false,
                rollupOptions: { input: productionEntryVirtualId, output: { entryFileNames: 'server.js' } } } },
            }),
          },
        }),
        optimizeDeps: {
          exclude: [...statefulRuntimePackages, ...(options.compilePackages ?? [])],
        },
      };
    },
    configEnvironment(name) {
      if (name !== 'client' && name !== 'ssr') return;
      return {
        optimizeDeps: {
          exclude: [...statefulRuntimePackages, ...(options.compilePackages ?? [])],
          // Scan uncompiled JSX without synthesizing a React runtime import.
          rolldownOptions: { transform: { jsx: 'preserve' as const } },
        },
        ...(name === 'ssr' && options.compilePackages?.length ? { resolve: { noExternal: [...options.compilePackages] } } : {}),
      };
    },
    perEnvironmentWatchChangeDuringDev: true,
    perEnvironmentStartEndDuringDev: true,
    applyToEnvironment(environment) {
      return environment.name === 'client' || environment.name === 'ssr';
    },
    configResolved(resolved) {
      config = resolved;
      entries = entryFiles(resolved.root, options.entries);
      if (options.runtime === 'cloudflare' && !resolved.plugins.some(plugin => plugin.name === 'memoized-dom:cloudflare')) {
        throw new Error('memoized-dom: the Cloudflare target requires cloudflare() from @memoized-dom/vite/cloudflare');
      }
    },
    configureServer(server) {
      devServer = server;
      if (options.devtools !== false) configureInspector(server, api);
      for (const file of installedWatchFiles) watchInstalledFile(file);
      if (options.compilePackages?.length) {
        const close = server.close.bind(server);
        server.close = async () => {
          for (const watcher of installedWatchers.values()) watcher.close();
          installedWatchers.clear(); installedWatchFiles.clear();
          for (const timer of installedWatchTimers.values()) clearTimeout(timer);
          installedWatchTimers.clear();
          return close();
        };
      }
      const updateEnvironments = server.config.server.hotUpdateEnvironments;
      server.config.server.hotUpdateEnvironments = async (server, hmr) => {
        if (updateEnvironments) await updateEnvironments(server, hmr);
        else await Promise.all(Object.values(server.environments).map(environment => hmr(environment)));
        if (pageReloadPending) {
          pageReloadPending = false;
          // Both compiler environments must finish before a browser request
          // can import the new backend. Reloading inside hotUpdate races SSR.
          for (const environment of Object.values(server.environments)) environment.moduleGraph.invalidateAll();
          api.invalidateBackend?.();
          server.ws.send({ type: 'full-reload' });
        }
      };
      for (const [environment, state] of states) {
        if ((environment as { name?: string }).name === 'client') {
          registerClientStyles(server, state, state.eagerStyles, state.routeStyles, state.routeTree);
        }
      }
      if (options.serverEntry !== undefined) configureDevelopmentDelivery(server);
    },
    async buildApp(builder) {
      const client = builder.environments.client;
      if (!client) throw new Error('memoized-dom: missing client build environment');
      if (options.serverEntry === undefined) {
        await builder.build(client);
        return;
      }
      await builder.build(client);
      const ssr = builder.environments.ssr;
      if (!ssr) throw new Error('memoized-dom: missing server build environment');
      const clientDirectory = resolve(client.config.root, client.config.build.outDir);
      const serverDirectory = resolve(ssr.config.root, ssr.config.build.outDir);
      productionDelivery = {
        document: await readFile(join(clientDirectory, 'index.html'), 'utf8'),
        files: await assetFiles(clientDirectory),
        base: client.config.base,
        assetsDir: client.config.build.assetsDir,
        clientRoot: relative(serverDirectory, clientDirectory).replaceAll('\\', '/'),
        runtime: options.runtime ?? 'bun',
        assetsBinding: api.cloudflareAssetsBinding,
      };
      await builder.build(ssr);
    },
    async buildStart() {
      for (const file of await refreshServerFunctions()) this.addWatchFile(file);
      const serverConfig = await refreshServerConfig();
      if (serverConfig !== null) this.addWatchFile(serverConfig);
      // Worker dependency scans start this hook before optimization finishes.
      // Resolve the SSR component graph when its modules are transformed;
      // eagerly resolving dependencies here would wait on the same scan.
      if (config?.command === 'serve' && this.environment.name === 'ssr') return;
      await refreshGraph(
        this as AdapterTransformContext,
        stateFor(this.environment),
        new Map(),
        this.environment.name,
      );
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (config?.command === 'serve' && options.devtools !== false) return { html, tags: [{ tag: 'script', attrs: { type: 'module', src: config.base + '@id/' + inspectorId }, injectTo: 'head' }] };
        if (config?.command !== 'build') return html;
        for (const [environment, state] of states) {
          if ((environment as { name?: string }).name !== 'client' || !state.initialPage) continue;
          const prepared = applyInitialPage(html, context.filename, config.root,
            state.initialPage, state.eagerStyles, options.serverEntry !== undefined);
          if (prepared === null) throw new Error('memoized-dom: page shell changed after compiler delivery planning');
          if (options.serverEntry !== undefined) {
            if (!state.initialDelivery) throw new Error('memoized-dom: missing compiler delivery identity');
            return prepared + initialBootstrapDescriptor({
              key: state.initialDelivery.key, target: state.initialDelivery.target, browser: state.initialDelivery.browser,
            });
          }
          return prepared;
        }
        return html;
      },
    },
    async resolveId(id, importer) {
      if (id === inspectorId && config?.command === 'serve' && options.devtools !== false) return resolvedInspectorId;
      if (isPageModule(id)) return '\0'+id.replace(/^\0/,'');
      if (id === applicationVirtualId) return resolvedApplicationVirtualId;
      if (id === integrationVirtualId) return resolvedIntegrationVirtualId;
      if (id === productionEntryVirtualId) return resolvedProductionEntryVirtualId;
      if (id === hydrationVirtualId) return resolvedHydrationVirtualId;
      if (id === serverFunctionsVirtualId) {
        return resolvedServerFunctionsVirtualId;
      }
      if (id === serverFunctionsClientVirtualId) {
        return resolvedServerFunctionsClientVirtualId;
      }
      if (id.startsWith('#server/')) {
        if (this.environment.name === 'client') {
          this.error(
            `memoized-dom: server-only module '${id}' cannot be imported by the client graph`,
          );
        }
        if (config === undefined) {
          this.error('memoized-dom: #server resolution started before config');
        }
        const candidate = resolveServerAlias(config.root, id, options);
        return this.resolve(candidate, importer, { skipSelf: true });
      }
      if (isServerFunctionImplementation(id)) return id;
      if (id.includes('?memo-style.css')) {
        if (importer) {
          const queryIndex = id.indexOf('?');
          const rawSpecifier = id.slice(0, queryIndex);
          const query = id.slice(queryIndex);
          const cleanImporter = cleanViteId(importer);
          const dir = dirname(cleanImporter);
          const resolvedPath = normalizeFile(join(dir, rawSpecifier));
          return `${resolvedPath}${query}`;
        }
        const queryIndex = id.indexOf('?');
        const query = queryIndex === -1 ? '' : id.slice(queryIndex);
        return `${normalizeFile(cleanViteId(id))}${query}`;
      }
      if (importer && options.compilePackages?.length && installedFor(this.environment.name).selected(id)) {
        const context = graphContext(this);
        const resolved = await context.resolve(id, importer, { skipSelf: true });
        if (!resolved) this.error(`memoized-dom: cannot resolve opted-in package '${id}' from '${importer}'`);
        // A publisher's finalized artifact always wins over consumer recompilation.
        if (await discoverPackageArtifact(resolved.id.replace(/\?v=[\w-]+$/, ''), id, importer)) return null;
        const compiled = await installedFor(this.environment.name).compile(context, resolved.id, id, importer);
        if (compiled) return { id: compiled.resolvedFile, external: false };
      }
      return null;
    },
    async load(id) {
      if (id === resolvedInspectorId && config?.command === 'serve' && options.devtools !== false) return { code: inspectorSource(api), map: { mappings: '' } };
      if (isPageModule(id)) {
        await serverPages?.prepare(graphContext(this));
        const code=serverPages?.load(id,this.environment.name === 'ssr');
        if (code === undefined) this.error('memo-dom: unknown private page artifact');
        return {code,map:{mappings:''}};
      }
      if (id === resolvedApplicationVirtualId) return { code: applicationModule(api.runtime), map: { mappings: '' } };
      if (id === resolvedIntegrationVirtualId) {
        return { code: productionDelivery ? productionIntegrationModule(productionDelivery) : developmentIntegrationModule(devServer!, api.runtime, api.cloudflareAssetsBinding), map: { mappings: '' } };
      }
      if (id === resolvedProductionEntryVirtualId) {
        return { code: options.runtime === 'node' ? nodeProductionEntry(api.serverEntry!) : bunProductionEntry(api.serverEntry!), map: { mappings: '' } };
      }
      if (id === resolvedHydrationVirtualId) {
        return { code: hydrationBootstrap(stateFor(this.environment).hydrationCapabilities), map: { mappings: '' } };
      }
      if (isServerFunctionImplementation(id)) {
        if (this.environment.name === 'client') {
          this.error('memoized-dom: server function implementations cannot be imported by the client graph');
        }
        const file = cleanViteId(id);
        this.addWatchFile(file);
        await serverPages?.prepare(graphContext(this));
        return {
          code: serverPages?.implementation(file) ?? serverFunctionImplementationSource(await readFile(file, 'utf8'), file, config!.root, options),
          map: { mappings: '' },
        };
      }
      if (id === resolvedServerFunctionsVirtualId) {
        if (this.environment.name === 'client') {
          this.error(
            'memoized-dom: virtual:memoized-dom/server-functions is server-only and cannot be imported by the client graph',
          );
        }
        return { code: serverFunctionRoutesSource, map: { mappings: '' } };
      }
      if (id === resolvedServerFunctionsClientVirtualId) {
        return { code: serverFunctionClientBarrelSource, map: { mappings: '' } };
      }
      if (id.includes('?memo-style.css')) {
        const clean = normalizeFile(cleanViteId(id));
        const state = hotStateFor(this.environment, clean);
        const style = state?.css.get(clean);
        if (style !== undefined) {
          return { code: style, map: { mappings: '' } };
        }
      }
      return null;
    },
    transform: {
      filter: { id: sourceId },
      async handler(code, id) {
        const compiled = await transformModule(this, code, id);
        if (this.environment.name !== 'ssr' || (!api.nativeDevelopment && !productionDelivery)) return compiled;
        const integrated = integratedServerImports(compiled?.code ?? code, id);
        if (!integrated) return compiled;
        const map = compiled?.map ? remapping([JSON.parse(integrated.map.toString()), compiled.map], () => null).toString() : integrated.map.toString();
        return { code: integrated.code, map };
      },
    },
    renderChunk(code, chunk) {
      if (!productionDelivery || this.environment.name !== 'ssr') return null;
      return relocateClientRoot(code, chunk.fileName, productionDelivery.clientRoot) ?? null;
    },
    async hotUpdate(update) {
      const file = normalizeFile(update.file);
      const pageChanged = serverPages?.owns(file) === true;
      const serverFunctionChanged =
        config !== undefined && (
          isServerFunctionFile(config.root, file, options) ||
          isServerSourceFile(config.root, file, options) || pageChanged
        );
      const serverConfigChanged = config !== undefined &&
        isServerConfigFile(config.root, file, options);
      if (serverConfigChanged) await refreshServerConfig();
      let virtualModule = serverFunctionChanged
        ? this.environment.moduleGraph.getModuleById(
            resolvedServerFunctionsVirtualId,
          )
        : undefined;
      const clientBarrelModule = serverFunctionChanged
        ? this.environment.moduleGraph.getModuleById(
            resolvedServerFunctionsClientVirtualId,
          )
        : undefined;
      if (serverFunctionChanged) {
        await refreshServerFunctions();
        await refreshServerConfig();
        for (const module of [virtualModule, clientBarrelModule]) {
          if (module !== undefined) {
            this.environment.moduleGraph.invalidateModule(
              module,
              new Set(),
              update.timestamp,
              true,
            );
          }
        }
      }
      if (pageChanged) {
        // Do not navigate away from a working document until its replacement
        // page artifacts compile. Vite can show a recoverable overlay instead.
        try { await serverPages?.prepare(hotGraphContext(this.environment, this)); }
        catch (error) { pageReloadPending = false; throw error; }
        if (this.environment.name === 'ssr') pageReloadPending = true;
        return [];
      }
      const primary = states.get(this.environment);
      const state = hotStateFor(this.environment, file);
      const isPrimary = primary === state;
      if (state === undefined) {
        // Preserve Vite's affected modules, especially importers whose prior
        // resolution failed while a dependency was missing. Replacing them
        // with only the generated routes leaves their failed transforms cached.
        return virtualModule === undefined ? undefined : [...new Set([...update.modules, virtualModule])];
      }
      const previous = new Map(state.output);
      const previousCss = new Map(state.css);
      const overrides =
        update.type === 'delete'
          ? new Map<string, string>()
          : new Map([[file, await update.read()]]);
      const context = hotGraphContext(this.environment, this);
      await finishPendingCompilation(state);
      try {
        if (isPrimary) {
          await refreshGraph(context, state, overrides, this.environment.name);
        } else {
          await refreshLazyGraph(
            context,
            state,
            file,
            overrides,
            this.environment.name,
          );
        }
      } catch (error) {
        state.hotUpdateFailed = true;
        throw error;
      }
      const changed = new Set<string>();
      for (const candidate of new Set([
        ...previous.keys(),
        ...state.output.keys(),
      ])) {
        if (previous.get(candidate) !== state.output.get(candidate)) {
          changed.add(candidate);
        }
      }
      for (const candidate of new Set([
        ...previousCss.keys(),
        ...state.css.keys(),
      ])) {
        if (previousCss.get(candidate) !== state.css.get(candidate)) {
          changed.add(candidate);
        }
      }
      if (state.hotUpdateFailed) {
        // A repaired edit can compile to the same output as the last good
        // graph. It still needs one HMR update so Vite clears its error
        // overlay and resumes the client update pipeline.
        if (state.files.has(file) || state.css.has(file)) {
          changed.add(file);
        } else {
          // A semantic dependency is not itself a browser module. Re-emit the
          // managed modules so Vite clears the overlay after a repaired
          // artifact, even when generated output returns to its last-good form.
          for (const candidate of state.files) changed.add(candidate);
        }
        state.hotUpdateFailed = false;
      }
      const modules = invalidateManagedModules(
        this.environment,
        changed,
        update.timestamp,
      );
      if (virtualModule !== undefined && !modules.includes(virtualModule)) {
        modules.push(virtualModule);
      }
      return modules;
    },
  };
}
