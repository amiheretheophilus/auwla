import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: { index: './src/index.ts', dev: './src/dev.ts', cli: './src/cli.ts', cloudflare: './src/cloudflare.ts' },
  platform: 'browser',
  transform: { target: 'node24' },
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    format: 'esm',
    minify: true,
  },
});
