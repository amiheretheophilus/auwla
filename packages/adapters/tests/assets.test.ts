import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'bun:test';
import { createAssetHandler as bunAssets } from '../src/bun';
import { createAssetHandler as nodeAssets } from '../src/node';

describe.each([['bun', bunAssets], ['node', nodeAssets]] as const)('%s production assets', (_runtime, createAssets) => {
  it('serves only build assets, respects base paths and HEAD, and rejects missing chunks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memoized-assets-'));
    try {
      await mkdir(join(directory, 'chunks'));
      await writeFile(join(directory, 'chunks/app-12345678.js'), 'export const ready = true;');
      await writeFile(join(directory, 'robots.txt'), 'User-agent: *');
      await writeFile(join(directory, 'index.html'), '<main>private document template</main>');
      await writeFile(join(directory, '.env'), 'private');
      const assets = createAssets(pathToFileURL(directory + '/'), {
        base: '/site/', assetsDir: 'chunks',
        files: ['chunks/app-12345678.js', 'chunks/deleted.js', 'robots.txt', 'index.html', '.env'],
      });
      const request = (path: string, method = 'GET') => assets(new Request('http://localhost' + path, { method }));
      const response = (await request('/site/chunks/app-12345678.js'))!;
      expect(await response.text()).toBe('export const ready = true;');
      expect(response.headers.get('content-type')).toContain('javascript');
      expect(response.headers.get('cache-control')).toContain('immutable');
      const head = (await request('/site/chunks/app-12345678.js', 'HEAD'))!;
      expect(await head.text()).toBe('');
      expect(Number(head.headers.get('content-length'))).toBe(26);
      expect((await request('/site/chunks/deleted.js'))!.status).toBe(404);
      expect((await request('/site/chunks/unknown.js'))!.status).toBe(404);
      expect((await request('/site/robots.txt'))!.headers.get('cache-control')).toBe('no-cache');
      expect((await request('/site/chunks/%2e%2e%2f.env'))!.status).toBe(404);
      for (const path of ['/site/index.html', '/site/.env', '/chunks/app-12345678.js', '/site/page']) {
        expect(await request(path)).toBeUndefined();
      }
      expect(await request('/site/robots.txt', 'POST')).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
