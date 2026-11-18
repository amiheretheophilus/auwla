import { DevEnvironment, resolveConfig, type InlineConfig } from 'vite';
import type { FullstackPluginApi } from './fullstack';

/** Run the configured graph/declaration hooks without a server, optimizer, or bundle. */
export async function generateProjectTypes(config: InlineConfig): Promise<void> {
  const resolved = await resolveConfig({
    ...config,
    plugins: [...(config.plugins ?? []), {
      name: 'memoized-dom:types',
      enforce: 'post',
      config: { order: 'post', handler(userConfig) {
        // Override explicit application optimizer includes as well. This must
        // happen before Vite creates its resolver, not after config resolution.
        userConfig.optimizeDeps = { ...userConfig.optimizeDeps, noDiscovery: true, include: [] };
        userConfig.environments ??= {};
        userConfig.environments.client ??= {};
        const client = userConfig.environments.client;
        client.optimizeDeps = { ...client.optimizeDeps, noDiscovery: true, include: [] };
      } },
    }],
  }, 'serve', 'development');
  const plugin = resolved.plugins.find(candidate => candidate.name === 'memoized-dom');
  if (plugin === undefined) {
    throw new Error('memoized-dom: types requires the memoizedDom() Vite plugin');
  }
  const environment = new DevEnvironment('client', resolved, { hot: false });
  try {
    await environment.init();
    await environment.pluginContainer.buildStart();
    // The compiler's plugin builds on demand, so it is asked to build and write them.
    await (plugin.api as FullstackPluginApi | undefined)?.writeDeclarations?.();
  } finally {
    await environment.close();
  }
}
