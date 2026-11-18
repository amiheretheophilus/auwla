import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: { index: './src/index.ts', dev: './src/dev.ts', cli: './src/cli.ts', cloudflare: './src/cloudflare.ts' },
  platform: 'browser',
  transform: { target: 'node24' },
  // Every package stays external, the compiler included: it builds its own `dist` for Node, and one
  // copy of it means one `CompileError` class for it and for JSX+, which reads `.auwla` files.
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    format: 'esm',
    minify: true,
  },
});
