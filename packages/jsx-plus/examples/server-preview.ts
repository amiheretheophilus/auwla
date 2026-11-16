/**
 * A local preview of an example rendered on the server (`directory/`, `server-pages/`).
 * Compiler-next's own Bun plugin builds the browser's bundle and the server from one application,
 * with `.auwla` as a source language; nothing here compiles anything. The built server answers
 * every request except the browser's files.
 *
 * It also writes `.memoized/server-functions.d.ts`, which types `#server-functions` for TypeScript
 * in the editor (the example's `tsconfig.json`), as the Vite plugin does.
 *
 * It stays running: a saved change builds both programs again, loads the new server and reloads
 * the open pages (`watch.ts`). The server's in-memory data starts over with it. `--build` builds,
 * writes the declarations, reports the browser's script and exits.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BuildArtifact, BuildOutput } from 'bun';
// Compiler-next has no package export for this yet.
import { memoizedDomApplication } from '../../compiler-next/src/project/bun';
import { checkoutPackagesFor } from '../tools/checkout';
import { liveReload, watchFolder } from './watch';

/** Both examples keep their server in `server.ts` and their server-only code in `server/`. */
const SERVER = { entry: './server.ts', folder: './server' };

export interface ServerPreviewOptions {
  /** The browser's entry, relative to the folder. */
  readonly client: string;
  /** The built browser entry's name: the delivery's document loads `/<entryName>.js`. */
  readonly entryName: string;
  /**
   * The source of the module that gives the page around the app (`document`, `assets`); the
   * server renders the app into its outlet.
   */
  readonly delivery: string;
  /** Minify the browser's bundle. */
  readonly minify?: boolean;
}

interface Served {
  /** The browser's files, by the URL the page asks for. */
  readonly assets: Map<string, BuildArtifact>;
  readonly server: { fetch(request: Request): Promise<Response> };
}

export async function serverPreview(folder: URL, name: string, defaultPort: number, options: ServerPreviewOptions): Promise<void> {
  const root = fileURLToPath(folder);
  const outdir = fileURLToPath(new URL(`../../../.cache/${name.toLowerCase().replaceAll(' ', '-')}-preview/`, import.meta.url));
  rmSync(outdir, { recursive: true, force: true });

  // One application, compiled once per change, for the declarations, the browser and the server.
  const app = memoizedDomApplication({ client: options.client, server: SERVER, delivery: options.delivery, root });
  /**
   * Each build's server goes to a folder of its own (`server/1/`, `server/2/`, ...): Bun keeps
   * a module it has loaded by its path, also when the URL has a different query.
   */
  let builds = 0;

  /** Builds both programs from the application's current build; undefined when one failed. */
  const build = async (): Promise<Served | undefined> => {
    const application = await app.build();
    if (application.declarations !== null) {
      mkdirSync(join(root, '.memoized'), { recursive: true });
      writeFileSync(join(root, '.memoized', 'server-functions.d.ts'), application.declarations);
    }
    const client = await Bun.build({
      entrypoints: [join(root, options.client)],
      target: 'browser',
      outdir: join(outdir, 'client'),
      minify: options.minify === true,
      naming: { entry: `${options.entryName}.[ext]` },
      plugins: [app.plugin('client'), checkoutPackagesFor('browser')],
      // A failed build is reported in its result, so a rebuild can keep serving the last good one.
      throw: false,
    });
    if (!report(name, client, 'browser bundle')) return undefined;
    const serverFolder = join(outdir, 'server', String(builds + 1));
    const server = await Bun.build({
      entrypoints: [join(root, SERVER.entry)],
      target: 'bun',
      outdir: serverFolder,
      plugins: [app.plugin('server'), checkoutPackagesFor('server')],
      throw: false,
    });
    if (!report(name, server, 'server')) return undefined;

    const loaded = await import(pathToFileURL(join(serverFolder, 'server.js')).href);
    // The last build's server is loaded already; its folder is not needed.
    rmSync(join(outdir, 'server', String(builds)), { recursive: true, force: true });
    builds++;
    const assets = new Map(client.outputs.map((output) => [`/${relative(join(outdir, 'client'), output.path).replaceAll('\\', '/')}`, output]));
    return { assets, server: loaded.default };
  };

  const first = await build();
  if (first === undefined) {
    throw new Error(`The ${name} example did not build`);
  }
  if (process.argv.includes('--build')) {
    const script = await first.assets.get(`/${options.entryName}.js`)!.text();
    console.log(`${name} built: ${options.entryName}.js ${script.length} bytes (${Bun.gzipSync(script).length} gzipped); .memoized/server-functions.d.ts written`);
    return;
  }

  let served = first;
  const pages = liveReload();
  const listening = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? defaultPort),
    // The reload stream stays open while its page does.
    idleTimeout: 0,
    async fetch(request) {
      const reload = pages.answer(request);
      if (reload !== undefined) return reload;
      const asset = served.assets.get(new URL(request.url).pathname);
      if (asset !== undefined) return new Response(asset, { headers: { 'Content-Type': asset.type } });
      return pages.withScript(await served.server.fetch(request));
    },
  });
  console.log(`${name} preview: ${listening.url} (rebuilds when a file in the folder changes)`);

  watchFolder(root, async (changed) => {
    const started = performance.now();
    await app.rebuild(changed);
    const next = await build();
    if (next === undefined) {
      console.error(`${name}: the preview still serves the last build.`);
      return;
    }
    served = next;
    pages.reload();
    console.log(`${name} rebuilt in ${Math.round(performance.now() - started)} ms`);
  });
}

/** True for a build that succeeded; a failed one prints its errors. */
function report(name: string, result: BuildOutput, program: string): boolean {
  if (result.success) return true;
  console.error(`${name}: the ${program} did not build.`);
  for (const log of result.logs) console.error(log);
  return false;
}
