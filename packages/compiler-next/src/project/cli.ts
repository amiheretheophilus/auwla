#!/usr/bin/env bun
/**
 * The command line (`wiki/compiler/project.md`, "Command line"), on Bun:
 *
 *   bun packages/compiler-next/src/project/cli.ts check src/main.ts [--server server.ts --server-folder server]
 *   bun packages/compiler-next/src/project/cli.ts build src/main.ts --out dist [--minify] [--server … --server-folder …]
 *   bun packages/compiler-next/src/project/cli.ts package [--root packages/kit]
 *
 * `package` publishes a native package's source from its `.lib.config.ts` (`packages/package.ts`).
 * `check` compiles the application and reports the first error. `build` bundles it with `Bun.build`
 * and the plugin (`bun.ts`), with source maps beside each file. With a server, the client goes to
 * `<out>/client` and the server to `<out>/server.js`, which serves the built page and its files:
 * `bun dist/server.js` with a server entry that default-exports its application.
 */
import { existsSync, rmSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { BuildOutput, BunPlugin } from 'bun';
import { createApplication, type ServerOptions } from '../server/application';
import { deliveryModule, workerConfig, type ServerRuntime } from '../server/delivery';
import { memoizedDom } from './bun';
import { fileSystemHost, normalizeProjectPath } from './host';
import { packageLibrary } from './packages/package';

type Command = ApplicationCommand | PackageCommand;

interface ApplicationCommand {
  readonly name: 'check' | 'build';
  readonly client: string;
  readonly server?: ServerOptions;
  /** Where a built server runs (`server/delivery.ts`). Default `bun`. */
  readonly runtime: ServerRuntime;
  readonly root: string;
  readonly out: string;
  readonly minify: boolean;
}

/** `package`: a native package's source, published from its `.lib.config.ts` (`packages/package.ts`). */
interface PackageCommand {
  readonly name: 'package';
  readonly root: string;
  readonly config?: string;
}

const USAGE = `usage:
  cli.ts check <client entry> [--root <folder>] [--server <entry> [--server-folder <folder>]]
  cli.ts build <client entry> [--root <folder>] [--out <folder>] [--minify] [--server <entry> [--server-folder <folder>] [--runtime bun|cloudflare]]
  cli.ts package [--root <folder>] [--config <file>]`;

/** The command the arguments describe, or a message saying what is wrong with them. */
export function parseArguments(args: readonly string[], cwd: string): Command | string {
  if (args[0] === 'package') return parsePackage(args.slice(1), cwd);
  const [name, client, ...rest] = args;
  if ((name !== 'check' && name !== 'build') || client === undefined || client.startsWith('--')) return USAGE;

  let root = cwd;
  let out = 'dist';
  let minify = false;
  let serverEntry: string | undefined;
  let serverFolder: string | undefined;
  let runtime: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === '--minify') {
      minify = true;
    } else if (value !== undefined && (flag === '--root' || flag === '--out' || flag === '--server' || flag === '--server-folder' || flag === '--runtime')) {
      index++;
      if (flag === '--root') root = resolve(cwd, value);
      else if (flag === '--out') out = value;
      else if (flag === '--server') serverEntry = value;
      else if (flag === '--runtime') runtime = value;
      else serverFolder = value;
    } else {
      return `unknown or incomplete option: ${flag}\n${USAGE}`;
    }
  }
  if (serverFolder !== undefined && serverEntry === undefined) return `--server-folder needs --server\n${USAGE}`;
  if (runtime !== undefined && serverEntry === undefined) return `--runtime needs --server\n${USAGE}`;
  if (runtime !== undefined && runtime !== 'bun' && runtime !== 'cloudflare') return `--runtime is bun or cloudflare\n${USAGE}`;
  const server = serverEntry === undefined ? undefined : {
    entry: normalizeProjectPath(serverEntry),
    ...(serverFolder === undefined ? {} : { folder: normalizeProjectPath(serverFolder) }),
  };
  return {
    name, client: normalizeProjectPath(client), ...(server === undefined ? {} : { server }),
    runtime: (runtime ?? 'bun') as ServerRuntime, root, out: resolve(root, out), minify,
  };
}

function parsePackage(rest: readonly string[], cwd: string): PackageCommand | string {
  let root = cwd;
  let config: string | undefined;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined || (flag !== '--root' && flag !== '--config')) return `unknown or incomplete option: ${flag}\n${USAGE}`;
    if (flag === '--root') root = resolve(cwd, value);
    else config = value;
  }
  return { name: 'package', root, ...(config === undefined ? {} : { config }) };
}

/** Runs a command; the exit code. */
export async function run(command: Command, log: (line: string) => void): Promise<number> {
  if (command.name === 'package') {
    await packageLibrary({ root: command.root, ...(command.config === undefined ? {} : { config: command.config }), log });
    return 0;
  }
  return command.name === 'check' ? check(command, log) : build(command, log);
}

async function check(command: ApplicationCommand, log: (line: string) => void): Promise<number> {
  const application = createApplication({
    client: command.client,
    ...(command.server === undefined ? {} : { server: command.server }),
    host: fileSystemHost(command.root),
  });
  const result = await application.build();
  for (const [side, program] of [['client', result.client], ['server', result.server]] as const) {
    if (program === undefined) continue;
    if (!program.ok) {
      log(program.error.message);
      return 1;
    }
    log(`ok: ${side}, ${program.modules.length} modules compiled`);
  }
  return 0;
}

async function build(command: ApplicationCommand, log: (line: string) => void): Promise<number> {
  const { root, server } = command;
  const clientOut = server === undefined ? command.out : resolve(command.out, 'client');
  const page = resolve(root, 'index.html');
  // The page, when there is one, so Bun writes it with the bundled script and styles in it.
  const entry = existsSync(page) ? page : resolve(root, command.client);
  // The runtime shapes the server's wrapper: a Worker calls it as `fetch(request, env, ctx)`.
  const shared = { client: command.client, ...(server === undefined ? {} : { server: { ...server, runtime: command.runtime } }), root };

  const client = await Bun.build({
    entrypoints: [entry],
    outdir: clientOut,
    target: 'browser',
    // A route's lazy component (`import()` in the route table) becomes its own chunk.
    splitting: true,
    sourcemap: 'linked',
    minify: command.minify,
    plugins: [memoizedDom({ ...shared, target: 'client' })],
    throw: false,
  });
  if (!report(client, log)) return 1;
  await dropEmptyScripts(client);
  if (server === undefined) return 0;

  const document = await documentOf(client, clientOut);
  const files = client.outputs.map((output) => relative(clientOut, output.path).replaceAll('\\', '/'));
  const delivery = deliveryModule({ runtime: command.runtime, document, files });
  const plugins = [memoizedDom({ ...shared, target: 'server', delivery })];

  if (command.runtime === 'cloudflare') return buildWorker(command, server, plugins, log);
  const backend = await Bun.build({
    entrypoints: [resolve(root, server.entry)],
    outdir: command.out,
    target: 'bun',
    sourcemap: 'linked',
    minify: command.minify,
    plugins,
    throw: false,
  });
  return report(backend, log) ? 0 : 1;
}

/**
 * The server as a Cloudflare Worker: `<out>/worker.js`, bundled for workerd, beside `<out>/client`
 * and a `wrangler.json` that uploads the client as the Worker's assets (`server/delivery.ts`). The
 * Worker's own modules (`cloudflare:workers`) and Node's built-ins, which `nodejs_compat` provides,
 * stay imports.
 */
async function buildWorker(command: ApplicationCommand, server: ServerOptions, plugins: BunPlugin[], log: (line: string) => void): Promise<number> {
  const worker = await Bun.build({
    entrypoints: [resolve(command.root, server.entry)],
    outdir: command.out,
    naming: { entry: 'worker.[ext]' },
    target: 'browser',
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:*', 'node:*'],
    sourcemap: 'linked',
    minify: command.minify,
    plugins,
    throw: false,
  });
  if (!report(worker, log)) return 1;
  const config = workerConfig({ name: basename(command.root), main: './worker.js', assets: './client' });
  const file = resolve(command.out, 'wrangler.json');
  await Bun.write(file, `${JSON.stringify(config, null, 2)}\n`);
  log(`wrote ${file}`);
  return 0;
}

/**
 * The document the server renders into: the built page, or one that loads the client's script.
 * Either way it needs the `<!--ssr-outlet-->` marker where the app goes (`docs/09-ssr.md`).
 */
async function documentOf(client: BuildOutput, clientOut: string): Promise<string> {
  const html = client.outputs.find((output) => output.path.endsWith('.html'));
  if (html !== undefined) return html.text();
  const script = client.outputs.find((output) => output.kind === 'entry-point')!;
  const src = `/${relative(clientOut, script.path).replaceAll('\\', '/')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${basename(src)}</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="${src}"></script></body></html>`;
}

/**
 * Bun gives an HTML page a script even when it has none, as an empty file. A page that ships as
 * HTML (`page.ts`) must load no script at all, so the empty file and its tag are removed.
 */
async function dropEmptyScripts(client: BuildOutput): Promise<void> {
  const empty = new Set<string>();
  for (const output of client.outputs) {
    // Empty but for Bun's comments (`//# debugId=…`, `//# sourceMappingURL=…`).
    const code = (await output.text()).replace(/^\/\/#.*$/gm, '').trim();
    if (output.path.endsWith('.js') && code === '') empty.add(output.path);
  }
  if (empty.size === 0) return;
  for (const page of client.outputs.filter((output) => output.path.endsWith('.html'))) {
    let html = await page.text();
    for (const file of empty) {
      const name = basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`<script[^>]*\\ssrc="(?:\\./)?${name}"[^>]*></script>`, 'g'), '');
    }
    await Bun.write(page.path, html);
  }
  for (const file of empty) {
    rmSync(file, { force: true });
    rmSync(`${file}.map`, { force: true });
  }
}

function report(result: BuildOutput, log: (line: string) => void): boolean {
  for (const message of result.logs) log(String(message.message));
  if (!result.success) return false;
  for (const output of result.outputs) log(`wrote ${output.path}`);
  return true;
}

if (import.meta.main) {
  const command = parseArguments(process.argv.slice(2), process.cwd());
  if (typeof command === 'string') {
    console.error(command);
    process.exit(2);
  }
  process.exit(await run(command, (line) => console.log(line)));
}
