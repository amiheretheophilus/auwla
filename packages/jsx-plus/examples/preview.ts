/**
 * A local preview for an example folder. Compiler-next's own Bun plugin builds the app, with
 * `.auwla` as a source language: the same path a `.tsx` app takes. Nothing here compiles anything.
 *
 * The folder's `index.html` loads `/main.ts`, as Vite expects; the preview answers that path with
 * the bundle, and serves the folder's other files as they are. `--build` builds and exits.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Compiler-next's Bun plugin has no package export yet.
import { memoizedDom } from '../../compiler-next/src/project/bun';
import { auwla } from '../src';

export async function preview(folder: URL, name: string, defaultPort: number): Promise<void> {
  const root = fileURLToPath(folder);
  const runtime = fileURLToPath(new URL('../../runtime/src/index.ts', import.meta.url));
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL('./main.ts', folder))],
    target: 'browser',
    plugins: [
      memoizedDom({ client: './main.ts', root, languages: [auwla] }),
      {
        // This checkout's browser runtime, independent of stale dist output or the package's
        // server-side default export condition. Example-only.
        name: 'example-runtime',
        setup(builder) {
          builder.onResolve({ filter: /^@memoized-dom\/runtime$/ }, () => ({ path: runtime }));
        },
      },
    ],
  });
  if (!build.success) {
    throw new AggregateError(build.logs, `The ${name} example did not build`);
  }

  const javascript = await build.outputs[0]!.text();
  if (process.argv.includes('--build')) {
    console.log(`${name} built: ${javascript.length} JavaScript characters`);
    return;
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? defaultPort),
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/main.ts') {
        return new Response(javascript, { headers: { 'Content-Type': 'text/javascript' } });
      }
      const file = new URL(`.${path === '/' ? '/index.html' : path}`, folder);
      // Only files inside the example folder.
      if (file.href.startsWith(folder.href) && existsSync(file)) {
        return new Response(Bun.file(file));
      }
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`${name} preview: ${server.url}`);
}
