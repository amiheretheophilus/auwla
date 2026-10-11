import { createServer as createViteServer, mergeConfig, createServerModuleRunner, type InlineConfig, type Plugin, type ViteDevServer } from 'vite';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { toWebRequest, sendNodeResponse } from '@memoized-dom/adapters/node';
import type { FullstackPluginApi } from './fullstack';

interface Backend {
  fetch(request: Request, platform?: unknown): Response | undefined | Promise<Response | undefined>;
  installIntegration?: unknown;
}
interface BackendModule {
  default: Backend;
  /** Release application-owned services after the previous generation's response streams finish. */
  dispose?: () => void | Promise<void>;
}
interface Generation {
  module: BackendModule;
  revision: number;
  pending: number;
  retired: boolean;
  disposed: boolean;
}

export interface NativeDevServer {
  readonly vite: ViteDevServer;
  readonly origin: string;
  readonly runtime: 'bun' | 'node' | 'cloudflare';
  close(): Promise<void>;
}

async function toolingPort(): Promise<number> {
  const probe = createPortProbe();
  await new Promise<void>((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Missing tooling server address');
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  return address.port;
}

/** Run transformed backend modules in this process and use its actual native HTTP host. */
export async function createDevServer(inline: InlineConfig = {}): Promise<NativeDevServer> {
  const port = await toolingPort();
  let backendPort = 3000;
  let hostname = '127.0.0.1';
  let entry: string | undefined;
  let revision = 0;
  let workerHost = false;
  const launcher: Plugin = {
    name: 'memoized-dom:native-launcher', enforce: 'post',
    config(config) {
      const plugins = (config.plugins as unknown[] | undefined)?.flat(Infinity) as Plugin[] | undefined;
      workerHost = plugins?.some(plugin => plugin?.name === 'memoized-dom' &&
        (plugin.api as FullstackPluginApi | undefined)?.runtime === 'cloudflare') ?? false;
      if (workerHost) return;
      backendPort = config.server?.port ?? 3000;
      hostname = typeof config.server?.host === 'string' ? config.server.host : '127.0.0.1';
      return { server: { port, host: '127.0.0.1', strictPort: true, middlewareMode: false,
        ws: { host: '127.0.0.1', clientPort: port }, hmr: true } };
    },
    configResolved(config) {
      const plugin = config.plugins.find(plugin => plugin.name === 'memoized-dom');
      const api = plugin?.api as FullstackPluginApi | undefined;
      if (!api?.serverEntry) throw new Error('memoized-dom: native development requires memoizedDom({ clientEntry, serverEntry })');
      api.nativeDevelopment = true;
      entry = api.serverEntry;
    },
    hotUpdate(update) {
      if (workerHost) return;
      if (this.environment.name !== 'ssr' || update.modules.length === 0) return;
      // The compiler's hotUpdate has finished. Invalidate transforms before
      // allowing a request to load the replacement backend.
      const seen = new Set<import('vite').EnvironmentModuleNode>();
      for (const module of update.modules) {
        this.environment.moduleGraph.invalidateModule(module, seen, update.timestamp, true);
      }
      revision++;
    },
  };
  const vite = await createViteServer(mergeConfig(inline, { plugins: [launcher] }));
  if (workerHost) {
    try {
      await vite.listen();
      const origin = vite.resolvedUrls?.local[0];
      if (!origin) throw new Error('memoized-dom: missing Cloudflare development address');
      return { vite, origin: new URL(origin).origin, runtime: 'cloudflare', close: () => vite.close() };
    } catch (error) { await vite.close(); throw error; }
  }
  let node: Server | undefined;
  let bun: Bun.Server<unknown> | undefined;
  const generations = new Set<Generation>();
  let current: Generation | undefined;
  // Backend generations own replacement. Vite's eager runner HMR can race a
  // request importing the same entry while a previous reload is still running.
  const runner = createServerModuleRunner(vite.environments.ssr!, { hmr: false });
  let loading: Promise<Generation> | undefined;
  const dispose = async (generation: Generation): Promise<void> => {
    if (!generation.retired || generation.pending !== 0 || generation.disposed) return;
    generation.disposed = true;
    generations.delete(generation);
    try { await generation.module.dispose?.(); }
    catch (error) { vite.config.logger.error(`memoized-dom: backend disposal failed: ${String(error)}`); }
  };
  const backend = async (): Promise<Generation> => {
    if (current?.revision === revision) return current;
    if (loading) { await loading; return backend(); }
    loading = (async () => {
      while (true) {
        const nextRevision = revision;
        runner.clearCache();
        const module = await runner.import<BackendModule>(entry!);
        if (!module.default || typeof module.default.fetch !== 'function') {
          throw new TypeError(`memoized-dom: '${entry}' must default-export a backend with a fetch handler`);
        }
        const next = { module, revision: nextRevision, pending: 0, retired: false, disposed: false };
        if (revision !== nextRevision) {
          next.retired = true;
          await dispose(next);
          continue;
        }
        const previous = current;
        current = next;
        generations.add(next);
        if (previous) { previous.retired = true; await dispose(previous); }
        return next;
      }
    })();
    try { return await loading; }
    finally { loading = undefined; }
  };
  const dispatch = async (request: Request, platform?: unknown): Promise<Response | undefined> => {
    const generation = await backend();
    generation.pending++;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      generation.pending--;
      await dispose(generation);
    };
    try {
      const application = generation.module.default;
      const response = await application.fetch(request, application.installIntegration ? { platform } : platform);
      if (!response?.body) { await release(); return response; }
      const reader = response.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) { reader.releaseLock(); await release(); controller.close(); }
            else controller.enqueue(next.value);
          } catch (error) { reader.releaseLock(); await release(); controller.error(error); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); await release(); } },
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { await release(); throw error; }
  };
  try {
    await vite.listen();
    const initial = (await backend()).module.default;
    let origin: string;
    if (typeof Bun !== 'undefined') {
      // Hono has its own routes array: only native Bun options belong to the listener.
      const native: Record<string, unknown> = {};
      const exported = initial as unknown as Record<string, unknown>;
      for (const key of ['port', 'hostname', 'websocket', 'error', 'idleTimeout', 'maxRequestBodySize', 'tls', 'reusePort', 'ipv6Only']) {
        if (exported[key] !== undefined) native[key] = exported[key];
      }
      bun = Bun.serve({ port: backendPort, hostname, ...native, fetch: dispatch } as Bun.Serve.Options<unknown>);
      origin = bun.url.origin;
    } else {
      const exported = initial as unknown as { port?: number; hostname?: string };
      backendPort = exported.port ?? backendPort;
      hostname = exported.hostname ?? hostname;
      node = createHttpServer(async (request, response) => {
        try {
          const result = await dispatch(toWebRequest(request), { incoming: request, outgoing: response });
          await sendNodeResponse(result ?? new Response('Not Found', { status: 404 }), response);
        } catch (error) {
          vite.config.logger.error(String(error));
          if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
          else { response.statusCode = 500; response.end('Internal Server Error'); }
        }
      });
      await new Promise<void>((done, reject) => { node!.once('error', reject); node!.listen(backendPort, hostname, done); });
      const address = node.address();
      if (!address || typeof address === 'string') throw new Error('Missing native server address');
      origin = `http://${hostname}:${address.port}`;
    }
    return {
      vite, origin, runtime: bun ? 'bun' : 'node',
      async close() {
        if (bun) await bun.stop(true);
        if (node) { node.closeAllConnections(); await new Promise<void>(done => node!.close(() => done())); }
        await runner.close();
        await vite.close();
        for (const generation of generations) { generation.retired = true; await dispose(generation); }
      },
    };
  } catch (error) {
    await runner.close();
    await vite.close();
    for (const generation of generations) { generation.retired = true; await dispose(generation); }
    throw error;
  }
}
