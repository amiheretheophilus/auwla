/**
 * Module state in server renders (`wiki/compiler/server.md`, "Request isolation"). One server
 * process renders every request with the same module instances, so module state written while
 * rendering one request must not be what the next request reads: with real users, that is one
 * user's data on another user's page. Each server render gets its own copy of the state it writes
 * (`features/state/request-dom.ts`; `wiki/decisions.md`, 2026-11-14).
 */
import { afterAll, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoizedDom } from '../project/bun';

// Inside the package, so a build finds the workspace's packages as an app finds its own.
const root = mkdtempSync(join(import.meta.dir, '../../.request-state-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, text: string): void {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

write('src/main.ts', `import { mount } from '@memoized-dom/runtime';\nimport { Page } from './Page';\nmount('root', Page);\n`);
// A counter, an object store and a value derived from both, written through a helper while the
// page renders.
write('src/session.ts', `export let visits = 0;
export const cart = { items: [] as string[] };
export const total = cart.items.length + visits;
export function visit(item: string) { visits++; cart.items.push(item); }
`);
// State whose setup waits: each request builds it before the page renders.
write('src/greeting.ts', `let greeting = await Promise.resolve('Hello');
export function greet() { greeting += '!'; return greeting; }
`);
write('src/Page.tsx', `import { cart, total, visit, visits } from './session';
import { greet } from './greeting';
export function Page() { visit('apple'); return <main><p>visits {visits}, items {cart.items.length}, total {total}</p><p>{greet()}</p></main>; }
`);
write('server.ts', `import { serve } from '@memoized-dom/server';\nimport { Page } from './src/Page';\nimport { define } from '#server/define';\nconst app = serve({ define });\napp.ssr(Page);\nexport default app;\n`);
write('server/define.ts', `import { createDefine } from '@memoized-dom/server';\nexport const define = createDefine();\n`);

const DELIVERY = `export default { document: () => '<div id="root"><!--ssr-outlet--></div>', assets: () => undefined };`;

it('gives each server request its own module state', async () => {
  const result = await Bun.build({
    entrypoints: [join(root, 'server.ts')],
    outdir: join(root, 'dist'),
    target: 'bun',
    plugins: [memoizedDom({
      client: './src/main.ts', server: { entry: './server.ts', folder: './server' }, target: 'server', delivery: DELIVERY, root,
    })],
  });
  expect(result.success).toBe(true);
  const { default: app } = await import(pathToFileURL(join(root, 'dist', 'server.js')).href) as {
    default: { fetch(request: Request): Promise<Response> };
  };

  const shown = async () => (await (await app.fetch(new Request('http://localhost/'))).text())
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*$/, '');
  // Each request starts from the authored values, so each one shows exactly its own visit.
  for (let request = 0; request < 3; request++) {
    const page = await shown();
    expect(page).toContain('<p>visits 1, items 1, total 2</p>');
    expect(page).toContain('<p>Hello!</p>');
  }
});
