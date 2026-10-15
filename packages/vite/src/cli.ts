#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import type { InlineConfig, PluginOption } from 'vite';
import type { FullstackPluginApi } from './fullstack';

async function applicationPlugin(options: PluginOption[]): Promise<FullstackPluginApi | undefined> {
  for (const option of options) {
    const plugin = await option;
    if (Array.isArray(plugin)) {
      const api = await applicationPlugin(plugin);
      if (api) return api;
    } else if (plugin && plugin.name === 'memoized-dom' && 'api' in plugin) {
      return plugin.api as FullstackPluginApi;
    }
  }
  return undefined;
}

/** Transfer execution without changing the user's arguments or working directory. */
async function launchHost(runtime: 'bun' | 'node', runtimeChild = true): Promise<void> {
  const executable = runtime === 'node' && !process.versions.bun ? process.execPath : runtime;
  await new Promise<void>((done, reject) => {
    const args = process.argv.slice(2);
    if (runtimeChild && !args.includes('--runtime-child')) args.push('--runtime-child');
    const child = spawn(executable, [process.argv[1]!, ...args], {
      stdio: 'inherit', windowsHide: true,
    });
    const interrupt = () => { child.kill('SIGINT'); };
    const terminate = () => { child.kill('SIGTERM'); };
    const release = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', error => {
      release();
      reject(new Error(`memoized-dom: could not launch ${runtime}; install it and make it available on PATH`, { cause: error }));
    });
    child.once('exit', (code, signal) => {
      release();
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
      done();
    });
  });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' }, root: { type: 'string' }, port: { type: 'string' },
      // Private handoff marker, not an application runtime override.
      'runtime-child': { type: 'boolean' },
    },
  });
  const command = positionals[0] ?? 'dev';
  if (!['dev', 'build', 'types'].includes(command) || positionals.length > 1) {
    throw new Error('Usage: memoized-dom [dev|build|types] [--config path] [--root path] [--port number]');
  }
  if (values.port !== undefined && (!Number.isInteger(Number(values.port)) || Number(values.port) < 0 || Number(values.port) > 65535)) {
    throw new Error('memoized-dom: --port must be an integer between 0 and 65535');
  }
  // Read configuration under Node so Worker tooling never has to initialize in Bun.
  if (process.versions.bun && !values['runtime-child']) {
    await launchHost('node', false);
    return;
  }
  const config: InlineConfig = {
    configFile: values.config,
    root: values.root,
    ...(values.port === undefined ? {} : { server: { port: Number(values.port) } }),
  };
  if (command === 'types') {
    await (await import('./typegen')).generateProjectTypes(config);
    console.log('Memoized DOM: project types generated');
    return;
  }
  const { createBuilder, createServer, loadConfigFromFile } = await import('vite');
  if (command === 'build') {
    await (await createBuilder(config)).buildApp();
    return;
  }
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, values.config, values.root);
  const api = await applicationPlugin(loaded?.config.plugins ?? []);
  const host = api?.serverEntry && api.runtime === 'bun' ? 'bun' : 'node';
  const currentHost = process.versions.bun ? 'bun' : 'node';
  if (host !== currentHost) {
    if (values['runtime-child']) throw new Error('memoized-dom: configured runtime changed during launch; restart development');
    await launchHost(host);
    return;
  }
  const server = api?.serverEntry
    ? await (await import('./dev')).createDevServer(config)
    : await createServer(config);
  await ('origin' in server ? Promise.resolve() : server.listen());
  const origin = 'origin' in server ? server.origin : server.resolvedUrls?.local[0];
  if (!origin) { await server.close(); throw new Error('memoized-dom: missing development address'); }
  console.log(`Memoized DOM (${'runtime' in server ? server.runtime : 'browser'}): ${origin}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

await main();
