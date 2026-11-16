/**
 * A local preview for an example folder. Compiler-next's own Bun plugin builds the app, with
 * `.auwla` as a source language: the same path a `.tsx` app takes. Nothing here compiles anything.
 *
 * The folder's `index.html` loads `/main.ts`, as Vite expects; the preview answers that path with
 * the bundle, and serves the folder's other files as they are. It stays running: a saved change
 * builds the app again and reloads the open pages (`watch.ts`). `--build` builds and exits.
 */
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildArtifact, BuildOutput } from 'bun';
// Compiler-next's Bun plugin has no package export yet.
import { memoizedDomApplication } from '../../compiler-next/src/project/bun';
import { checkoutPackages } from '../tools/checkout';
import { liveReload, watchFolder } from './watch';

export interface PreviewOptions {
  /** Let Bun build the HTML entry and write its CSS/script links itself. */
  readonly html?: boolean;
  /** Answers the app's API requests (`/api/...`); others fall through to the folder's files. */
  readonly api?: (request: Request) => Response | undefined;
  /**
   * Routes a page URL to `index.html` when no file matches, so a deep link (`/people/2`) loads
   * the app, which then shows that route.
   */
  readonly routes?: boolean;
}

export async function preview(folder: URL, name: string, defaultPort: number, options: PreviewOptions = {}): Promise<void> {
  const root = fileURLToPath(folder);
  const outdir = fileURLToPath(new URL(`../../../.cache/${name.toLowerCase().replaceAll(' ', '-')}-preview/`, import.meta.url));
  // One application for the whole session; a saved change reads only the files that changed.
  const app = memoizedDomApplication({ client: './main.ts', root });
  const bundle = (): Promise<BuildOutput> => Bun.build({
    entrypoints: [fileURLToPath(new URL(options.html === true ? './index.html' : './main.ts', folder))],
    target: 'browser',
    outdir,
    // A page imported only for its route loads as its own chunk (`wiki/compiler/routes.md`).
    splitting: true,
    // Shipped as a real app would be; the linked maps still show the `.auwla` source in devtools.
    // Unminified, the team example measured 365 kB instead of 165 kB (82 and 56 kB gzipped).
    minify: true,
    sourcemap: 'linked',
    naming: { entry: options.html === true ? '[name].[ext]' : 'main.js', chunk: 'chunks/[name]-[hash].[ext]' },
    plugins: [app.plugin('client'), checkoutPackages],
    // A failed build is reported in its result, so a rebuild can keep serving the last good one.
    throw: false,
  });

  // Built files by the URL the page asks for: the entry answers `/main.ts`, as Vite serves it.
  const assetsOf = (build: BuildOutput): Map<string, BuildArtifact> => new Map(build.outputs.map((output) => {
    const path = `/${relative(outdir, output.path).replaceAll('\\', '/')}`;
    return [options.html !== true && path === '/main.js' ? '/main.ts' : path, output];
  }));

  const first = await bundle();
  if (!first.success) {
    throw new AggregateError(first.logs, `The ${name} example did not build`);
  }
  if (process.argv.includes('--build')) {
    // What the browser downloads: the JavaScript, not the maps beside it.
    const scripts = first.outputs.filter((output) => output.path.endsWith('.js'));
    const texts = await Promise.all(scripts.map((output) => output.text()));
    const raw = texts.reduce((total, text) => total + text.length, 0);
    const gzipped = texts.reduce((total, text) => total + Bun.gzipSync(text).length, 0);
    console.log(`${name} built: ${scripts.length} scripts, ${raw} bytes (${gzipped} gzipped), with source maps`);
    return;
  }

  let assets = assetsOf(first);
  const pages = liveReload();
  const html = async (file: Blob): Promise<Response> => new Response(pages.page(await file.text()), {
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? defaultPort),
    // The reload stream stays open while its page does.
    idleTimeout: 0,
    fetch(request) {
      const reload = pages.answer(request);
      if (reload !== undefined) return reload;
      const path = new URL(request.url).pathname;
      const asset = assets.get(options.html === true && path === '/' ? '/index.html' : path);
      if (asset !== undefined) {
        return asset.type.startsWith('text/html') ? html(asset) : new Response(asset, { headers: { 'Content-Type': asset.type } });
      }
      const answered = path.startsWith('/api/') ? options.api?.(request) : undefined;
      if (answered !== undefined) return answered;
      const file = new URL(`.${path === '/' ? '/index.html' : path}`, folder);
      // Only files inside the example folder.
      if (file.href.startsWith(folder.href) && existsSync(file)) {
        return file.pathname.endsWith('.html') ? html(Bun.file(file)) : new Response(Bun.file(file));
      }
      if (options.routes === true && !path.includes('.')) {
        return html(Bun.file(new URL('./index.html', folder)));
      }
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`${name} preview: ${server.url} (rebuilds when a file in the folder changes)`);

  watchFolder(root, async (changed) => {
    const started = performance.now();
    await app.rebuild(changed);
    const build = await bundle();
    if (!build.success) {
      console.error(`${name}: the build failed; the preview still serves the last one.`);
      for (const log of build.logs) console.error(log);
      return;
    }
    assets = assetsOf(build);
    pages.reload();
    console.log(`${name} rebuilt in ${Math.round(performance.now() - started)} ms`);
  });
}
