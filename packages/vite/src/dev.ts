import { createServer as createViteServer, mergeConfig, createServerModuleRunner, type InlineConfig, type Plugin, type ViteDevServer } from 'vite';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { toWebRequest, sendNodeResponse } from '@memoized-dom/adapters/node';
import type { FullstackPluginApi } from './fullstack';
import { isDocumentRequest, recoveryDocument, serverUpdateEvent } from './dev-recovery';
import { runWithDiagnosticSink } from '@memoized-dom/devtools/node';

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
  liveStreams: Set<() => void>;
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
  let failedBackend = false;
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
      api.invalidateBackend = () => { revision++; };
      entry = api.serverEntry;
    },
    hotUpdate(update) {
      if (workerHost) return;
      if (this.environment.name !== 'ssr') return;
      if (update.modules.length === 0 && !(failedBackend && update.type === 'create')) return;
      // The compiler's hotUpdate has finished. Invalidate transforms before
      // allowing a request to load the replacement backend.
      const seen = new Set<import('vite').EnvironmentModuleNode>();
      // A failed SSR resolution can have no edge to the newly created file.
      // Retry its importer transforms as well, not just the restored module.
      if (failedBackend) this.environment.moduleGraph.invalidateAll();
      for (const module of update.modules) {
        this.environment.moduleGraph.invalidateModule(module, seen, update.timestamp, true);
      }
      revision++;
      // A document that failed before the application/template loaded still
      // needs to hear server-only repairs, not just client module updates.
      vite.ws.send({ type: 'custom', event: serverUpdateEvent, data: {} });
    },
  };
  const vite = await createViteServer(mergeConfig(inline, { plugins: [launcher] }));
  const tooling = vite.config.plugins.find(plugin => plugin.name === 'memoized-dom')?.api as FullstackPluginApi | undefined;
  const withDiagnostics = <T>(callback: () => T): T => runWithDiagnosticSink(tooling?.diagnosticSink, callback);
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
        const next: Generation = { module, revision: nextRevision, pending: 0, retired: false, disposed: false, liveStreams: new Set() };
        if (revision !== nextRevision) {
          next.retired = true;
          await dispose(next);
          continue;
        }
        const previous = current;
        current = next;
        failedBackend = false;
        generations.add(next);
        if (previous) {
          previous.retired = true;
          // Live queries must reconnect to the new application's invalidation hub.
          // Ordinary finite streams continue draining from their original generation.
          for (const reconnect of previous.liveStreams) reconnect();
          await dispose(previous);
        }
        return next;
      }
    })();
    try { return await loading; }
    catch (error) { failedBackend = true; throw error; }
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
      const response = await withDiagnostics(() => application.fetch(request, application.installIntegration ? { platform } : platform));
      if (!response?.body) { await release(); return response; }
      const reader = response.body.getReader();
      const live = response.headers.get('content-type')?.includes('text/event-stream') &&
        (response.headers.get('x-mmd-multiplex') === '1' || request.headers.get('x-mmd-stream') === 'live');
      let finished = false;
      let reconnect: (() => void) | undefined;
      const finish = async (reason?: unknown) => {
        if (finished) return;
        finished = true;
        if (reconnect) generation.liveStreams.delete(reconnect);
        try { await withDiagnostics(() => reader.cancel(reason)); }
        finally { reader.releaseLock(); await release(); }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!live) return;
          reconnect = () => {
            if (finished) return;
            // A clean EOF uses the client's existing reconnect/backoff protocol.
            controller.close();
            void finish().catch(error => vite.config.logger.error(`memoized-dom: live stream retirement failed: ${String(error)}`));
          };
          generation.liveStreams.add(reconnect);
          // The handler may have finished after its generation was replaced.
          if (generation.retired) reconnect();
        },
        async pull(controller) {
          try {
            const next = await withDiagnostics(() => reader.read());
            if (finished) return;
            if (next.done) { await finish(); controller.close(); }
            else controller.enqueue(next.value);
          } catch (error) {
            if (finished) return;
            try { await finish(error); } finally { controller.error(error); }
          }
        },
        cancel: finish,
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { await release(); throw error; }
  };
  const developmentFetch = async (request: Request, platform?: unknown): Promise<Response | undefined> => {
    try { return await dispatch(request, platform); }
    catch (error) {
      if (!isDocumentRequest(request)) throw error;
      return recoveryDocument(vite, `http://127.0.0.1:${port}`, error);
    }
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
      // Cold compilation/server reloads can exceed Bun's default idle timeout.
      // Explicit application listener options still take precedence.
      bun = Bun.serve({ port: backendPort, hostname, idleTimeout: 0, ...native, fetch: developmentFetch } as Bun.Serve.Options<unknown>);
      origin = bun.url.origin;
    } else {
      const exported = initial as unknown as { port?: number; hostname?: string };
      backendPort = exported.port ?? backendPort;
      hostname = exported.hostname ?? hostname;
      node = createHttpServer(async (request, response) => {
        try {
          const result = await developmentFetch(toWebRequest(request), { incoming: request, outgoing: response });
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
