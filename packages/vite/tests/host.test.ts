import { expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { viteHost } from '../src/host';

// The browser environment can resolve a server import (`hono`) to its own pre-bundled copy,
// which lives inside the project. Compiled as a project module, it became a second copy of the
// package in the server program, and a Worker's Hono met objects from the other copy.
it('treats a pre-bundled dependency in the cache folder as a package, and a project file as a module', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memoized-dom-host-'));
  try {
    const answers: Record<string, string> = {
      hono: join(root, '.vite/deps/hono.js') + '?v=1a2b',
      '@/lib/format': join(root, 'src/lib/format.ts'),
    };
    const host = viteHost(root, () => async (specifier) => answers[specifier] ?? null, undefined, join(root, '.vite'));
    expect(await host.resolve!('hono', 'server.ts')).toBe(false);
    expect(await host.resolve!('@/lib/format', 'src/App.tsx')).toBe('./src/lib/format.ts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
