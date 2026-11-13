/**
 * A local preview of the directory example, rendered on the server. Compiler-next's own Bun plugin
 * builds the browser's bundle and the server, with `.auwla` as a source language; nothing here
 * compiles anything. The built server answers every request except the bundle itself.
 *
 * It also writes `.memoized/server-functions.d.ts`, which types `#server-functions` for TypeScript
 * in the editor (`tsconfig.json`), as the Vite plugin does. `--build` builds, writes it and exits.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Compiler-next has no package export for these yet.
import { memoizedDom } from '../../../compiler-next/src/project/bun';
import { fileSystemHost } from '../../../compiler-next/src/project';
import { createApplication } from '../../../compiler-next/src/server/application';
import { auwla } from '../../src';
import { checkoutPackagesFor } from '../checkout';

const root = fileURLToPath(new URL('./', import.meta.url));
const outdir = fileURLToPath(new URL('../../../../.cache/directory-preview/', import.meta.url));
const SERVER = { entry: './server.ts', folder: './server' };
/** The page around the app; the server renders the app into its outlet. */
const DELIVERY = `export default {
  document: () => '<!doctype html><html><head><meta charset="utf-8"><title>Directory</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/main.js"></script></body></html>',
  assets: () => undefined,
};`;

rmSync(outdir, { recursive: true, force: true });

const declarations = await createApplication({ client: './src/main.ts', server: SERVER, host: fileSystemHost(root), languages: [auwla] }).build();
if (declarations.declarations !== null) {
  mkdirSync(join(root, '.memoized'), { recursive: true });
  writeFileSync(join(root, '.memoized', 'server-functions.d.ts'), declarations.declarations);
}

const client = await Bun.build({
  entrypoints: [join(root, 'src/main.ts')],
  target: 'browser',
  outdir: join(outdir, 'client'),
  naming: { entry: 'main.js' },
  plugins: [memoizedDom({ client: './src/main.ts', server: SERVER, root, languages: [auwla] }), checkoutPackagesFor('browser')],
});
const server = await Bun.build({
  entrypoints: [join(root, 'server.ts')],
  target: 'bun',
  outdir: join(outdir, 'server'),
  plugins: [
    memoizedDom({ client: './src/main.ts', server: SERVER, target: 'server', delivery: DELIVERY, root, languages: [auwla] }),
    checkoutPackagesFor('server'),
  ],
});
for (const [name, result] of [['client', client], ['server', server]] as const) {
  if (!result.success) throw new AggregateError(result.logs, `The directory ${name} did not build`);
}

if (process.argv.includes('--build')) {
  console.log(`Directory built: ${client.outputs.length + server.outputs.length} files; .memoized/server-functions.d.ts written`);
} else {
  const app = (await import(pathToFileURL(join(outdir, 'server', 'server.js')).href)).default as { fetch(request: Request): Promise<Response> };
  const bundle = Bun.file(join(outdir, 'client', 'main.js'));
  const listening = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? 3033),
    fetch(request) {
      if (new URL(request.url).pathname === '/main.js') {
        return new Response(bundle, { headers: { 'Content-Type': 'text/javascript' } });
      }
      return app.fetch(request);
    },
  });
  console.log(`Directory preview: ${listening.url}`);
}
