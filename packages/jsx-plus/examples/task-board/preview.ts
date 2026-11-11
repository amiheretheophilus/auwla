import { fileURLToPath } from 'node:url';
import { compile } from '../../src';

const entrypoint = fileURLToPath(new URL('./main.ts', import.meta.url));
const runtime = fileURLToPath(new URL('../../../runtime/src/index.ts', import.meta.url));

// This example-only loader compiles the single authored UI module. Production
// Vite/multi-module integration remains separate work in the prototype plan.
const build = await Bun.build({
  entrypoints: [entrypoint],
  target: 'browser',
  plugins: [{
    name: 'auwla-example',
    setup(builder) {
      builder.onLoad({ filter: /\.auwla$/ }, async ({ path }) => ({
        contents: compile(await Bun.file(path).text(), { moduleId: path }),
        loader: 'js',
      }));
      // Use this checkout's browser runtime, independent of stale dist output
      // or the package's server-side default export condition.
      builder.onResolve({ filter: /^@memoized-dom\/runtime$/ }, () => ({ path: runtime }));
    },
  }],
});

if (!build.success) {
  throw new AggregateError(build.logs, 'The task-board example did not build');
}

const javascript = await build.outputs[0]!.text();
if (process.argv.includes('--build')) {
  console.log(`Task board built: ${javascript.length} JavaScript characters`);
} else {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: Number(process.env.AUWLA_EXAMPLE_PORT ?? 3030),
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/') {
        return new Response(Bun.file(new URL('./index.html', import.meta.url)));
      }
      if (path === '/style.css') {
        return new Response(Bun.file(new URL('./style.css', import.meta.url)));
      }
      if (path === '/app.js') {
        return new Response(javascript, { headers: { 'Content-Type': 'text/javascript' } });
      }
      return new Response('Not found', { status: 404 });
    },
  });
  console.log(`Task-board preview: ${server.url}`);
}
