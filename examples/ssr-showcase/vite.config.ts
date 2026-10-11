/**
 * SSR showcase — fullstack Vite config.
 *
 * The native launcher owns the public listener and runs the backend in Bun.
 * Vite supplies compiled modules, CSS, and browser hot updates.
 */
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  appType: 'custom',
  plugins: [memoizedDom({
    clientEntry: 'main.ts',
    serverEntry: 'server.ts',
    server: 'server',
  })],
});
