/**
 * The Vite plugin over compiler-next's applications (`wiki/compiler/project.md`, "Vite"). It only
 * connects compiler-next's results to Vite (`wiki/rules.md`, rule 17).
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
 *   Vite's transformed `index.html` and its middleware in development (`fullstack.ts`), and
 *   compiler-next's delivery module for the built client after a build. The production server
 *   entry is compiler-next's `hostEntryModule`; the native dev launcher is `dev.ts`, through `api`.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { normalizePath, searchForWorkspaceRoot } from 'vite';
import type { DevEnvironment, EnvironmentModuleNode, Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import {
  createApplication, declarationFiles, deliveryModule, hostEntryModule, importCandidates, initialPage, isSourcePath, languageExtensions,
  nativePackages, normalizeProjectPath, projectPath, standaloneDeliveryModule, writeLinkedTypes,
  type Application, type ApplicationBuild, type ApplicationUpdate, type CompileError, type DeliveryOptions, type ProjectBuild,
  type SourceLanguage,
} from '@memoized-dom/compiler-next';
import type { MemoizedDomViteOptions } from './options';
import {
  clientRootPlaceholder, configureDevelopmentDelivery, developmentIntegrationModule,
  integrationVirtualId, resolvedIntegrationVirtualId, productionEntryVirtualId, resolvedProductionEntryVirtualId,
  relocateClientRoot, type FullstackPluginApi,
} from './fullstack';
import { registerClientStyles } from './dev-assets';
import { longPath } from './paths';
import { viteHost, type ViteResolver } from './host';

/** Packages whose subpaths share state: prebundling them would give the app a second copy. */
const STATEFUL_PACKAGES = ['@memoized-dom/runtime', '@memoized-dom/data', '@memoized-dom/router'];

type Side = 'client' | 'server';

export function memoizedDom(options: MemoizedDomViteOptions): Plugin {
  if (options.clientEntry.trim() === '') throw new Error('memoized-dom: clientEntry must not be empty');
  const { clientEntry, serverEntry, server: serverFolder, runtime = 'bun', languages } = options;
  // Files a source language owns (`.auwla`) are compiled, resolved and hot-updated like `.tsx` ones.
  const extensions = languageExtensions(languages);

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
  /** The built client's delivery, set between the client and server builds of `buildApp`. */
  let productionDelivery: DeliveryOptions | undefined;
  /** The client's output folder relative to the server's, which each server chunk is pointed at. */
  let clientFolder = 'client';
  /** The stylesheets each lazily loaded route component's client chunk brings, by its key. */
  let clientRouteStyles: Record<string, string[]> | undefined;
  /** The native packages the app depends on, found when Vite reads the config. */
  let nativeNames: readonly string[] = [];

  const api: FullstackPluginApi = {
    runtime,
    get serverEntry() {
      return serverEntry === undefined || config === undefined ? serverEntry : resolve(config.root, serverEntry);
    },
    nativeDevelopment: false,
    // compiler-next builds on the first request; `types` asks for the build, whose declarations
    // `withDeclarations` writes.
    writeDeclarations: async () => {
      await built();
    },
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
    building ??= application.build().then(afterBuild);
    return building;
  }

  /** What follows each build or update: its declarations, and the dev server's page styles. */
  async function afterBuild(build: ApplicationBuild): Promise<ApplicationBuild> {
    registerDevelopmentStyles(build);
    return withDeclarations(build);
  }

  /**
   * In development, a page the server renders links the client's stylesheets in its head, so it is
   * styled before any script runs (`dev-assets.ts`): the eager ones on every page, a route's own on
   * the pages of that route. compiler-next lists them; a failed build keeps the last lists.
   */
  function registerDevelopmentStyles(build: ApplicationBuild): void {
    if (devServer === undefined || !build.client.ok) return;
    const routes = Object.entries(build.client.routeStylesheets ?? {})
      .map(([key, paths]) => [key, paths.map((path) => fileOf(path))] as const);
    registerClientStyles(devServer, build.client.stylesheets.map((path) => fileOf(path)), Object.fromEntries(routes));
  }

  /**
   * Writes the declarations compiler-next made (`declarationFiles`): the types of
   * `#server-functions`, of the app's route patterns and of each request's state and services.
   */
  async function withDeclarations(build: ApplicationBuild): Promise<ApplicationBuild> {
    for (const [path, text] of Object.entries(declarationFiles(build))) {
      await writeGenerated(fileOf(path), text);
    }
    return build;
  }

  /**
   * Writes a file compiler-next generated, only when its text changed so watchers are not woken
   * for nothing; null removes it.
   */
  async function writeGenerated(file: string, text: string | null): Promise<void> {
    const previous = await readFile(file, 'utf8').catch(() => null);
    if (previous === text) return;
    if (text === null) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
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
    if (!isSourcePath(path, languages) || path.includes('/node_modules/')) return false;
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
      // The project compiles native packages as its own source (compiler-next, `packages/native.ts`).
      // Prebundling one would give the app a second copy of its state, and a server external would
      // run its uncompiled source; a linked one may live outside the root, which the dev server
      // must be allowed to serve. TypeScript finds a linked one's imports through files written here.
      const root = resolve(userConfig.root ?? process.cwd());
      const native = nativePackages(root);
      nativeNames = native.names;
      writeLinkedTypes(native.linkedImports);
      return {
        ...(native.linkedDirectories.length === 0 ? {} : {
          server: { fs: { allow: [searchForWorkspaceRoot(root), ...native.linkedDirectories] } },
        }),
        ...(nativeNames.length === 0 ? {} : { ssr: { noExternal: [...nativeNames] } }),
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
        optimizeDeps: { exclude: [...STATEFUL_PACKAGES, ...nativeNames] },
      };
    },

    configEnvironment(name) {
      if (name !== 'client' && name !== 'ssr') return;
      // Scan authored JSX without a React runtime import: this plugin compiles it.
      return { optimizeDeps: { exclude: [...STATEFUL_PACKAGES, ...nativeNames], rolldownOptions: { transform: { jsx: 'preserve' as const } } } };
    },

    applyToEnvironment(environment) {
      return environment.name === 'client' || environment.name === 'ssr';
    },

    configResolved(resolved) {
      config = resolved;
      application = createApplication({
        ...compileOptions(options),
        // Vite's `base`, when it is a path: the router reads routes below it and links carry it.
        // A full URL (a CDN) or `./` only places assets.
        ...(resolved.base.startsWith('/') && resolved.base !== '/' ? { base: resolved.base } : {}),
        sourceMaps: true,
        hot: resolved.command === 'serve',
        client: normalizeProjectPath(clientEntry),
        ...(serverEntry === undefined ? {} : {
          server: {
            entry: normalizeProjectPath(serverEntry),
            ...(serverFolder === undefined ? {} : { folder: normalizeProjectPath(serverFolder) }),
            delivery: integrationVirtualId,
            runtime,
          },
        }),
        host: viteHost(resolved.root, () => resolver, languages),
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
      clientFolder = relative(serverDirectory, clientDirectory).replaceAll('\\', '/');
      productionDelivery = {
        runtime,
        document: await readFile(join(clientDirectory, 'index.html'), 'utf8'),
        files: await filesUnder(clientDirectory),
        base: client.config.base,
        assetsDir: client.config.build.assetsDir,
        // Where each server chunk lands is known only when it renders (`renderChunk`).
        clientRoot: clientRootPlaceholder,
        ...(api.cloudflareAssetsBinding === undefined ? {} : { assetsBinding: api.cloudflareAssetsBinding }),
        ...(clientRouteStyles === undefined ? {} : { routeStyles: clientRouteStyles }),
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
      const filename = cleanId(id);
      if (config?.command === 'serve' && filename.endsWith('.css') && isAbsolute(filename)) {
        // Direct SSR stylesheet links can arrive before Vite has seen their JS importer.
        resolver ??= contextResolver(this);
        const program = programOf(await built(), this.environment.name);
        if (!program?.ok) return null;
        const candidates = [pathOf(filename)];
        if (filename.startsWith('/')) candidates.push(pathOf(fileOf('.' + filename)));
        const found = candidates.find(path => program.css?.[path] !== undefined);
        return found === undefined ? null : fileOf(found) + id.slice(filename.length);
      }
      if (importer === undefined || !id.startsWith('.') || importer.startsWith('\0')) return null;

      // A relative import from a compiled module may name one that exists only in the build.
      resolver ??= contextResolver(this);
      const program = programOf(await built(), this.environment.name);
      if (program === undefined || !program.ok) return null;
      const from = pathOf(importer);
      // A static page links its CSS directly from HTML after its script is removed.
      // That importer is not a compiled module, but its generated CSS still is ours.
      const found = (importCandidates(id, from, extensions) ?? []).find((candidate) => {
        if (program.css?.[candidate] !== undefined) return true;
        return program.output[from] !== undefined && program.output[candidate] !== undefined;
      });
      return found === undefined ? null : fileOf(found);
    },

    async load(id) {
      if (id === resolvedIntegrationVirtualId) {
        let code: string;
        if (productionDelivery !== undefined) code = deliveryModule(productionDelivery);
        else if (devServer !== undefined) code = developmentIntegrationModule(devServer, runtime, api.cloudflareAssetsBinding);
        // A server built on its own: compiler-next's delivery with no page and no files.
        else code = standaloneDeliveryModule();
        return { code, map: { mappings: '' } };
      }
      if (id === resolvedProductionEntryVirtualId) {
        // A Worker is started by workerd itself; only Bun and Node get an entry.
        const host = runtime === 'node' ? 'node' : 'bun';
        return { code: hostEntryModule(host, api.serverEntry!), map: { mappings: '' } };
      }
      const cssAsset = cleanId(id).endsWith('.css');
      if (id.startsWith('\0') || (!cssAsset && (id.includes('?') || !isSourcePath(id, languages)))) return null;

      resolver ??= contextResolver(this);
      const program = programOf(await built(), this.environment.name);
      if (program === undefined) return null;
      const path = pathOf(id);
      if (!program.ok) {
        // A program that reached no module (its entry has no file) owns every module asked for:
        // passing one on would leave it to Vite's own JSX transform, which asks for React.
        if (program.modules.includes(path) || program.modules.length === 0) {
          this.error(viteError(program.error, fileOf(program.error.path)));
        }
        return null;
      }
      if (cssAsset) {
        const css = program.css?.[path];
        if (css !== undefined) {
          for (const dependency of program.modules) {
            if (program.output[dependency] === undefined) {
              this.addWatchFile(fileOf(dependency));
            }
          }
        }
        return css === undefined ? null : { code: css, map: { mappings: '' } };
      }
      const code = program.output[path];
      if (code === undefined) return null;
      // A linked package's file lives outside the root, where Vite's watcher does not look by itself.
      if (path.startsWith('../')) this.addWatchFile(fileOf(path));
      const map = program.maps?.[path];
      if (map === undefined) return { code, map: null };
      // compiler-next names sources by project path; Vite expects files, which it makes relative to
      // the module, so the browser finds each beside the module's URL. Its map type has mutable arrays.
      return {
        code,
        map: { ...map, sources: map.sources.map((source) => fileOf(source)), names: [...map.names], sourcesContent: [...(map.sourcesContent ?? [])] },
      };
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

    /**
     * A route component that loads with its route has a chunk of its own, which brings its
     * stylesheets only when it runs. The server links them on a page it renders
     * (`@memoized-dom/server`, `route-styles.ts`): here each chunk's CSS is found, with the CSS
     * of the chunks it imports, under the key the compiler gave the component.
     */
    async generateBundle(_options, bundle) {
      if (this.environment.name !== 'client' || serverEntry === undefined) return;
      const build = await built();
      const components = build.client.ok ? build.client.routeComponents : undefined;
      if (components === undefined) return;

      const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
      const styles: Record<string, string[]> = {};
      for (const [key, module] of Object.entries(components)) {
        const file = fileOf(module);
        const chunk = chunks.find((candidate) => candidate.facadeModuleId !== null && normalizePath(candidate.facadeModuleId) === file);
        if (chunk === undefined) continue;
        const hrefs = chunkStyles(chunk, chunks).map((fileName) => `${config!.base}${fileName}`);
        if (hrefs.length > 0) styles[key] = hrefs;
      }
      clientRouteStyles = styles;
    },

    renderChunk(code, chunk) {
      if (productionDelivery === undefined || this.environment.name !== 'ssr') return null;
      return relocateClientRoot(code, chunk.fileName, clientFolder) ?? null;
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
        const result = application.update([path]).then(async (done) => ({ ...done, build: await afterBuild(done.build) }));
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
        const styleOnly = program.modules.includes(path) && program.output[path] === undefined;
        let recovered: readonly string[];
        if (styleOnly) {
          recovered = Object.keys(program.css ?? {});
        } else if (program.output[path] !== undefined) {
          recovered = [path];
        } else {
          recovered = Object.keys(program.output);
        }
        for (const module of recovered) {
          changed.add(module);
        }
      }
      return invalidate(this.environment, changed, update.timestamp);
    },
  };
  return plugin;
}

type BundleChunk = { readonly fileName: string; readonly imports: readonly string[]; readonly viteMetadata?: { readonly importedCss: ReadonlySet<string> } };

/** The CSS files a chunk brings, and those of the chunks it imports statically, once each. */
function chunkStyles(chunk: BundleChunk, chunks: readonly BundleChunk[]): string[] {
  const styles: string[] = [];
  const seen = new Set<string>();
  const visit = (current: BundleChunk): void => {
    if (seen.has(current.fileName)) return;
    seen.add(current.fileName);
    for (const css of current.viteMetadata?.importedCss ?? []) {
      if (!styles.includes(css)) styles.push(css);
    }
    for (const imported of current.imports) {
      const next = chunks.find((candidate) => candidate.fileName === imported);
      if (next !== undefined) visit(next);
    }
  };
  visit(chunk);
  return styles;
}

function sideOf(environment: string): Side {
  return environment === 'ssr' ? 'server' : 'client';
}

/** The compiler options the Vite options carry; compiler-next ignores the old compiler's others. */
function compileOptions(options: MemoizedDomViteOptions): { runtimePath?: string; languages?: readonly SourceLanguage[] } {
  return {
    ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
    ...(options.languages === undefined ? {} : { languages: options.languages }),
  };
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
