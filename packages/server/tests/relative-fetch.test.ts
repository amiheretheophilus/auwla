/**
 * A relative `$fetch` during a server render: `serve()` answers it from its own routes in memory,
 * and `render()` hands its `fetch` the target as written. Moved from `initial-request.test.ts`,
 * which tested them through the old compiler's initial delivery (deleted 2026-11-17).
 */
import { describe, expect, it } from 'bun:test';
import { createDefine, render, serve } from '../src/index';
import { compileFixture } from './parity-harness';

type FetchStub = typeof globalThis.fetch;

describe('a relative $fetch on the server', () => {
  it('is answered by serve() routes in memory', async () => {
    const { serverModule } = await compileFixture('relative-serve',
      `export function App(){const user=$fetch('/api/user');return <main><h1>{user?.name}</h1></main>;}`,
      { routedEnvironment: 'server' });
    const application = serve({ define: createDefine() });
    application.get('/api/user', () => ({ name: 'Ada' }));
    application.ssr(serverModule.App, { mode: 'resolve', delivery: 'stream', timeout: 20 });
    (application as unknown as { installDocumentTemplate(template: string): void }).installDocumentTemplate(
      '<html><head></head><body><div id="root"><!--ssr-outlet--></div></body></html>');

    const response = await application.fetch(new Request('https://app.test/'));

    expect(response.status).toBe(200);
    expect((await response.text()).replace(/<!--[\s\S]*?-->/g, '')).toContain('<main><h1>Ada</h1></main>');
  });

  it('reaches render()\'s fetch as written', async () => {
    const { serverModule } = await compileFixture('relative-render',
      `export function App(){const user=$fetch('/api/user');return <h1>{user?.name}</h1>;}`,
      { routedEnvironment: 'server' });
    const requested: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return Response.json({ name: 'Grace' });
    }) as FetchStub;

    const result = await render(serverModule.App, { mode: 'resolve', fetch });

    expect(requested).toEqual(['/api/user']);
    expect(result.html).toBe('<h1>Grace</h1>');
  });
});
