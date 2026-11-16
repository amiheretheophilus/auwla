/**
 * A local preview of the server pages example. Compiler-next's own Bun plugin builds the browser's
 * bundle and the server, with `.auwla` as a source language; nothing here compiles anything. The
 * built server answers every request except the bundle and its stylesheet.
 *
 * It also writes `.memoized/server-functions.d.ts`, which types `#server-functions` for TypeScript
 * in the editor (`tsconfig.json`). `--build` builds, writes it, reports the bundle and exits.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Compiler-next has no package export for this yet.
import { memoizedDomApplication } from '../../../compiler-next/src/project/bun';
import { auwla } from '../../src';
import { checkoutPackagesFor } from '../../tools/checkout';

const root = fileURLToPath(new URL('./', import.meta.url));
const outdir = fileURLToPath(new URL('../../../../.cache/server-pages-preview/', import.meta.url));
const SERVER = { entry: './server.ts', folder: './server' };
/**
 * The page around the app; the server renders the app into its outlet. The shell's styles come
 * from `app.css`; each server page brings its own with its HTML.
 */
const DELIVERY = `export default {
  document: () => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Projects</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/app.js"></script></body></html>',
  assets: () => undefined,
};`;
/** The browser's entry: the root component's own file, which mounts it. */
const CLIENT = './src/App.auwla';

rmSync(outdir, { recursive: true, force: true });

// One application, compiled once, for the declarations below, the browser's bundle and the server.
const app = memoizedDomApplication({ client: CLIENT, server: SERVER, delivery: DELIVERY, root, languages: [auwla] });
const application = await app.build();
if (application.declarations !== null) {
  mkdirSync(join(root, '.memoized'), { recursive: true });
  writeFileSync(join(root, '.memoized', 'server-functions.d.ts'), application.declarations);
}

const client = await Bun.build({
  entrypoints: [join(root, CLIENT)],
  target: 'browser',
  outdir: join(outdir, 'client'),
  minify: true,
  // `app.js`, and `app.css` with the shell's styles.
  naming: { entry: 'app.[ext]' },
  plugins: [app.plugin('client'), checkoutPackagesFor('browser')],
});
const server = await Bun.build({
  entrypoints: [join(root, 'server.ts')],
  target: 'bun',
  outdir: join(outdir, 'server'),
  plugins: [app.plugin('server'), checkoutPackagesFor('server')],
});
for (const [name, result] of [['client', client], ['server', server]] as const) {
  if (!result.success) throw new AggregateError(result.logs, `The server pages ${name} did not build`);
}

if (process.argv.includes('--build')) {
  const script = await Bun.file(join(outdir, 'client', 'app.js')).text();
  console.log(`Server pages built: app.js ${script.length} bytes (${Bun.gzipSync(script).length} gzipped); .memoized/server-functions.d.ts written`);
} else {
  const app = (await import(pathToFileURL(join(outdir, 'server', 'server.js')).href)).default as { fetch(request: Request): Promise<Response> };
  const files: Record<string, { file: string; type: string }> = {
    '/app.js': { file: join(outdir, 'client', 'app.js'), type: 'text/javascript' },
    '/app.css': { file: join(outdir, 'client', 'app.css'), type: 'text/css' },
  };
  const listening = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? 3038),
    fetch(request) {
      const built = files[new URL(request.url).pathname];
      if (built !== undefined) return new Response(Bun.file(built.file), { headers: { 'Content-Type': built.type } });
      return app.fetch(request);
    },
  });
  console.log(`Server pages preview: ${listening.url}`);
}
