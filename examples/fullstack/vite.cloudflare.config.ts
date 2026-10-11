import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import { cloudflare } from '@memoized-dom/vite/cloudflare';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    memoizedDom({ clientEntry: 'main.ts', serverEntry: 'server.ts', server: 'server', runtime: 'cloudflare' }),
    cloudflare(),
  ],
});
