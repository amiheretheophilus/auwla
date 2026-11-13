#!/usr/bin/env bun
/**
 * The command line (`wiki/compiler/project.md`, "Command line"), on Bun:
 *
 *   bun packages/compiler-next/src/project/cli.ts check src/main.ts [--server server.ts --server-folder server]
 *   bun packages/compiler-next/src/project/cli.ts build src/main.ts --out dist [--minify] [--server … --server-folder …]
 *
 * `check` compiles the application and reports the first error. `build` bundles it with `Bun.build`
 * and the plugin (`bun.ts`), with source maps beside each file. With a server, the client goes to
 * `<out>/client` and the server to `<out>/server.js`, which serves the built page and its files:
 * `bun dist/server.js` with a server entry that default-exports its application.
 */
import { existsSync, rmSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { BuildOutput } from 'bun';
import { createApplication, type ServerOptions } from '../server/application';
import { memoizedDom } from './bun';
import { fileSystemHost, normalizeProjectPath } from './host';

interface Command {
  readonly name: 'check' | 'build';
  readonly client: string;
  readonly server?: ServerOptions;
  readonly root: string;
  readonly out: string;
  readonly minify: boolean;
}

const USAGE = `usage:
  cli.ts check <client entry> [--root <folder>] [--server <entry> [--server-folder <folder>]]
  cli.ts build <client entry> [--root <folder>] [--out <folder>] [--minify] [--server <entry> [--server-folder <folder>]]`;

/** The command the arguments describe, or a message saying what is wrong with them. */
export function parseArguments(args: readonly string[], cwd: string): Command | string {
  const [name, client, ...rest] = args;
  if ((name !== 'check' && name !== 'build') || client === undefined || client.startsWith('--')) return USAGE;

  let root = cwd;
  let out = 'dist';
  let minify = false;
  let serverEntry: string | undefined;
  let serverFolder: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag === '--minify') {
      minify = true;
    } else if (value !== undefined && (flag === '--root' || flag === '--out' || flag === '--server' || flag === '--server-folder')) {
      index++;
      if (flag === '--root') root = resolve(cwd, value);
      else if (flag === '--out') out = value;
      else if (flag === '--server') serverEntry = value;
      else serverFolder = value;
    } else {
      return `unknown or incomplete option: ${flag}\n${USAGE}`;
    }
  }
  if (serverFolder !== undefined && serverEntry === undefined) return `--server-folder needs --server\n${USAGE}`;
  const server = serverEntry === undefined ? undefined : {
    entry: normalizeProjectPath(serverEntry),
    ...(serverFolder === undefined ? {} : { folder: normalizeProjectPath(serverFolder) }),
  };
  return { name, client: normalizeProjectPath(client), ...(server === undefined ? {} : { server }), root, out: resolve(root, out), minify };
}

/** Runs a command; the exit code. */
export async function run(command: Command, log: (line: string) => void): Promise<number> {
  return command.name === 'check' ? check(command, log) : build(command, log);
}

async function check(command: Command, log: (line: string) => void): Promise<number> {
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

async function build(command: Command, log: (line: string) => void): Promise<number> {
  const { root, server } = command;
  const clientOut = server === undefined ? command.out : resolve(command.out, 'client');
  const page = resolve(root, 'index.html');
  // The page, when there is one, so Bun writes it with the bundled script and styles in it.
  const entry = existsSync(page) ? page : resolve(root, command.client);
  const shared = { client: command.client, ...(server === undefined ? {} : { server }), root };

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
  const delivery = `import { createAssetHandler } from '@memoized-dom/adapters/bun';
const page = ${JSON.stringify(document)};
export default {
  document: () => page,
  assets: createAssetHandler(new URL('./client/', import.meta.url), { files: ${JSON.stringify(files)} }),
};
`;
  const backend = await Bun.build({
    entrypoints: [resolve(root, server.entry)],
    outdir: command.out,
    target: 'bun',
    sourcemap: 'linked',
    minify: command.minify,
    plugins: [memoizedDom({ ...shared, target: 'server', delivery })],
    throw: false,
  });
  return report(backend, log) ? 0 : 1;
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
