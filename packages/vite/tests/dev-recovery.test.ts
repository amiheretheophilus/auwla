import { expect, it } from 'bun:test';
import type { ViteDevServer } from 'vite';
import { isDocumentRequest, recoveryDocument } from '../src/dev-recovery';

it('limits document recovery to document GET/HEAD requests, not function or asset requests', () => {
  expect(isDocumentRequest(new Request('http://localhost/', { headers: { 'sec-fetch-dest': 'document' } }))).toBe(true);
  expect(isDocumentRequest(new Request('http://localhost/', { method: 'HEAD', headers: { accept: 'text/html' } }))).toBe(true);
  expect(isDocumentRequest(new Request('http://localhost/_fn/example', { headers: { accept: '*/*' } }))).toBe(false);
  expect(isDocumentRequest(new Request('http://localhost/_fn/example', { headers: { accept: 'text/html', 'sec-fetch-dest': 'empty' } }))).toBe(false);
  expect(isDocumentRequest(new Request('http://localhost/app.js', { headers: { 'sec-fetch-dest': 'script' } }))).toBe(false);
  expect(isDocumentRequest(new Request('http://localhost/', { method: 'POST', headers: { accept: 'text/html' } }))).toBe(false);
});

it('makes error documents uncached and independent of the failing backend, escaping inline errors', async () => {
  const reports: string[] = [];
  const vite = { config: { base: '/demo/', logger: { error: (message: string) => reports.push(message) } } } as unknown as ViteDevServer;
  const response = recoveryDocument(vite, 'http://127.0.0.1:4321', new Error('</script><script>bad()</script>'));
  const html = await response.text();
  expect(response.status).toBe(500);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(html).toContain('http://127.0.0.1:4321/demo/@vite/client');
  expect(html).toContain('memoized-dom:server-update');
  expect(html).not.toContain('<script>bad()');
  expect(reports).toHaveLength(1);
});
