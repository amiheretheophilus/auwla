import { describe, expect, it } from 'bun:test';
import { createAssetHandler } from '../src/cloudflare';

describe('Worker asset binding', () => {
  it('resolves the configured base, keeps native binding responses, and supports Worker-imported chunks', async () => {
    const paths: string[] = [];
    const assets = createAssetHandler(() => ({ async fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === '/assets/redirect-12345678.js') return new Response(null, { status: 302, headers: { location: '/next' } });
      if (path === '/assets/imported-12345678.svg') return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      if (path === '/assets/app-12345678.js') return new Response('ready', { headers: { 'content-length': '5' } });
      return new Response('missing', { status: 404 });
    } }), { base: '/site/', files: ['assets/app-12345678.js', 'assets/redirect-12345678.js'] });
    const request = (path: string, method = 'GET') => assets(new Request('https://worker.test' + path, { method }));
    const response = (await request('/site/assets/app-12345678.js'))!;
    expect(await response.text()).toBe('ready');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await (await request('/site/assets/app-12345678.js', 'HEAD'))!.text()).toBe('');
    expect((await request('/site/assets/redirect-12345678.js'))!.status).toBe(302);
    expect((await request('/site/assets/imported-12345678.svg'))!.headers.get('content-type')).toBe('image/svg+xml');
    expect((await request('/site/assets/missing.js'))!.status).toBe(404);
    expect((await request('/site/assets/%2e%2e%2f.env'))!.status).toBe(404);
    expect(await request('/site/index.html')).toBeUndefined();
    expect(await request('/site/.env')).toBeUndefined();
    expect(await request('/site/assets/app-12345678.js', 'POST')).toBeUndefined();
    expect(paths.every(path => !path.startsWith('/site/'))).toBe(true);
    expect(paths).not.toContain('/assets/../.env');
  });
});
