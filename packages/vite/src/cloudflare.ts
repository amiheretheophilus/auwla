import { cloudflare as workerRuntime, type PluginConfig } from '@cloudflare/vite-plugin';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { FullstackPluginApi } from './fullstack';

/** Configure the official Worker host while Memoized DOM owns frontend delivery. */
export function cloudflare(options: PluginConfig = {}): Plugin[] {
  let binding = 'ASSETS';
  let root = process.cwd();
  let entry: string | undefined;
  const integration: Plugin = {
    name: 'memoized-dom:cloudflare', enforce: 'pre',
    config(config) {
      root = resolve(config.root ?? root);
      const plugin = ((config.plugins as unknown[] | undefined)?.flat(Infinity) as Plugin[] | undefined)?.find(plugin => plugin?.name === 'memoized-dom');
      const api = plugin?.api as FullstackPluginApi | undefined;
      entry = api?.serverEntry;
      if (entry) entry = resolve(root, entry);
      return {
        server: { host: config.server?.host ?? '127.0.0.1', port: config.server?.port ?? 3000 },
      };
    },
    configResolved(config) {
      const plugin = config.plugins.find(plugin => plugin.name === 'memoized-dom');
      const api = plugin?.api as FullstackPluginApi | undefined;
      if (!api?.serverEntry || api.runtime !== 'cloudflare') {
        throw new Error("memoized-dom: cloudflare() requires memoizedDom({ clientEntry, serverEntry, runtime: 'cloudflare' })");
      }
      api.nativeDevelopment = true;
      api.cloudflareAssetsBinding = binding;
    },
    buildApp: {
      order: 'post',
      async handler(builder) {
        const worker = builder.environments.ssr;
        const client = builder.environments.client;
        if (!worker?.isBuilt || !client?.isBuilt) return;
        const workerDirectory = resolve(root, worker.config.build.outDir);
        const clientDirectory = resolve(root, client.config.build.outDir);
        const manifest = JSON.parse(await readFile(join(workerDirectory, '.vite/manifest.json'), 'utf8')) as Record<string, { assets?: string[] }>;
        for (const asset of new Set(Object.values(manifest).flatMap(chunk => chunk.assets ?? []))) {
          const target = join(clientDirectory, asset);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(join(workerDirectory, asset), target);
        }
      },
    },
  };
  return [integration, ...workerRuntime({
    ...options,
    viteEnvironment: { ...options.viteEnvironment, name: 'ssr' },
    config(config) {
      const customized = typeof options.config === 'function' ? options.config(config) : options.config;
      const worker = { ...config, ...customized };
      binding = worker.assets?.binding ?? 'ASSETS';
      if (worker.compatibility_flags?.includes('no_nodejs_compat')) {
        throw new Error('memoized-dom: Worker request context requires Node compatibility for AsyncLocalStorage');
      }
      return {
        ...worker,
        main: worker.main ?? entry,
        compatibility_flags: [...new Set([...(worker.compatibility_flags ?? []), 'nodejs_compat'])],
        assets: { ...worker.assets, binding, run_worker_first: true, html_handling: 'none', not_found_handling: 'none' },
      };
    },
  })];
}

export default cloudflare;
