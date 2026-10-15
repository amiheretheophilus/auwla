import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  appType: 'custom',
  server: { host: '127.0.0.1', port: 3100, strictPort: true },
  plugins: [memoizedDom({
    clientEntry: 'main.ts',
    serverEntry: 'server.ts',
    server: 'server',
    runtime: 'bun',
  })],
});
