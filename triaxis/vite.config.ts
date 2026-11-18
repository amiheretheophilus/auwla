import { resolve } from 'node:path';
import { defineConfig, loadEnv, normalizePath } from 'vite';
import auwla from '@memoized-dom/vite';

const root = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const { TRIAXIS_DESK_DB } = loadEnv(mode, root, 'TRIAXIS_DESK_DB');
  const configuredPath = TRIAXIS_DESK_DB?.trim();
  const databaseFiles = configuredPath && configuredPath !== ':memory:'
    ? ['', '-wal', '-shm', '-journal'].map(suffix => normalizePath(resolve(root, configuredPath) + suffix))
    : [];

  return {
    root,
    appType: 'custom',
    server: {
      host: '127.0.0.1',
      port: 3070,
      strictPort: true,
      fs: {
        // Keep the normal Vite exclusions and also protect the analyst database.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          '**/.local/**',
          ...databaseFiles,
        ],
      },
    },
    plugins: [
      auwla({
        clientEntry: 'src/main.ts',
        serverEntry: 'server.ts',
        server: 'server',
        runtime: 'bun',
      }),
    ],
  };
});
