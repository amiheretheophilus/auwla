#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createBuilder } from 'vite';
import { createDevServer } from './dev';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { config: { type: 'string' }, root: { type: 'string' }, port: { type: 'string' } },
});
const config = {
  configFile: values.config,
  root: values.root,
  ...(values.port === undefined ? {} : { server: { port: Number(values.port) } }),
};
switch (positionals[0] ?? 'dev') {
  case 'dev': {
    const server = await createDevServer(config);
    console.log(`Memoized DOM (${server.runtime}): ${server.origin}`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await server.close();
      process.exit(0);
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    break;
  }
  case 'build': {
    await (await createBuilder(config)).buildApp();
    break;
  }
  default: throw new Error('Usage: memoized-dom [dev|build] [--config path] [--root path] [--port number]');
}
