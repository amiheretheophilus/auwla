/**
 * A local preview for an example folder. Compiler-next's own Bun plugin builds the app, with
 * `.auwla` as a source language: the same path a `.tsx` app takes. Nothing here compiles anything.
 *
 * The folder's `index.html` loads `/main.ts`, as Vite expects; the preview answers that path with
 * the bundle, and serves the folder's other files as they are. `--build` builds and exits.
 */
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
// Compiler-next's Bun plugin has no package export yet.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { auwla } from '../src';
import { checkoutPackages } from './checkout';

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
  const build = await Bun.build({
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
    plugins: [memoizedDom({ client: './main.ts', root, languages: [auwla] }), checkoutPackages],
  });
  if (!build.success) {
    throw new AggregateError(build.logs, `The ${name} example did not build`);
  }

  // Built files by the URL the page asks for: the entry answers `/main.ts`, as Vite serves it.
  const assets = new Map(build.outputs.map((output) => {
    const path = `/${relative(outdir, output.path).replaceAll('\\', '/')}`;
    return [options.html !== true && path === '/main.js' ? '/main.ts' : path, output];
  }));
  if (process.argv.includes('--build')) {
    // What the browser downloads: the JavaScript, not the maps beside it.
    const scripts = build.outputs.filter((output) => output.path.endsWith('.js'));
    const texts = await Promise.all(scripts.map((output) => output.text()));
    const raw = texts.reduce((total, text) => total + text.length, 0);
    const gzipped = texts.reduce((total, text) => total + Bun.gzipSync(text).length, 0);
    console.log(`${name} built: ${scripts.length} scripts, ${raw} bytes (${gzipped} gzipped), with source maps`);
    return;
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? defaultPort),
    fetch(request) {
      const path = new URL(request.url).pathname;
      const asset = assets.get(options.html === true && path === '/' ? '/index.html' : path);
      if (asset !== undefined) {
        return new Response(asset, { headers: { 'Content-Type': asset.type } });
      }
      const answered = path.startsWith('/api/') ? options.api?.(request) : undefined;
      if (answered !== undefined) return answered;
      const file = new URL(`.${path === '/' ? '/index.html' : path}`, folder);
      // Only files inside the example folder.
      if (file.href.startsWith(folder.href) && existsSync(file)) {
        return new Response(Bun.file(file));
      }
      if (options.routes === true && !path.includes('.')) {
        return new Response(Bun.file(new URL('./index.html', folder)));
      }
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`${name} preview: ${server.url}`);
}
