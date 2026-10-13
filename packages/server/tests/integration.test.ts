import { describe, expect, it, vi } from 'bun:test';
import { createDefine, integrateApplication, serve } from '../src';
import { createServerFunctionRoutes } from '../src/http-router';
import { compileFixture } from './parity-harness';

describe('host delivery integration', () => {
  it('keeps API routes independent of document transforms and ahead of frontend assets', async () => {
    const { serverModule } = await compileFixture('integration-api', 'export function App() { return <p>Ready</p>; }');
    const document = vi.fn(() => { throw new Error('Broken frontend document'); });
    const assets = vi.fn(() => new Response('frontend asset'));
    const app = integrateApplication(serve<Record<string, never>, { port: number }>({
      define: createDefine<Record<string, never>, { port: number }>(),
      onError: error => new Response(String(error), { status: 500 }),
    }), {
      routes: createServerFunctionRoutes([{ id: 'native', method: 'GET', path: '/_fn/native', parameters: [],
        handler: context => ({ port: context.platform!.port }) }]),
      document, assets,
    });
    app.get('/api/native.json', context => ({ port: context.platform!.port }));
    app.ssr(serverModule.App);
    for (const path of ['/api/native.json', '/_fn/native']) {
      const response = await app.fetch(new Request('https://app.test' + path), { platform: { port: 3000 } });
      expect(await response.json()).toEqual({ port: 3000 });
    }
    expect(document).not.toHaveBeenCalled();
    expect(assets).not.toHaveBeenCalled();
    expect(await (await app.fetch(new Request('https://app.test/assets/app.js'))).text()).toBe('frontend asset');
    expect(document).not.toHaveBeenCalled();
  });

  it('keeps concurrent request documents separate and reports preparation errors through application middleware', async () => {
    const { serverModule } = await compileFixture('integration-documents', 'export function App() { return <p>Ready</p>; }');
    let fail = false;
    const app = integrateApplication(serve({
      define: createDefine(),
      onError: error => new Response(String(error), { status: 503 }),
    }), {
      routes: [], assets: () => undefined,
      async document(request) {
        if (fail) throw new Error('Document unavailable');
        const title = new URL(request.url).searchParams.get('title');
        await new Promise<void>(done => setTimeout(done, title === 'first' ? 25 : 0));
        return '<!doctype html><html><head><title>' + title + '</title></head><body><!--ssr-outlet--></body></html>';
      },
    });
    app.ssr(serverModule.App);
    const responses = await Promise.all(['first', 'second'].map(title => app.fetch(new Request('https://app.test/?title=' + title))));
    const html = await Promise.all(responses.map(response => response.text()));
    expect(html[0]).toContain('<title>first</title>');
    expect(html[1]).toContain('<title>second</title>');
    for (const source of html) expect(source).toContain('<p>Ready</p>');
    fail = true;
    expect((await app.fetch(new Request('https://app.test/'))).status).toBe(503);
  });
});
