/**
 * The compiler's build: plain JavaScript in `dist/` for Node, which cannot load the TypeScript
 * sources (their imports leave out the extension). Bun keeps loading `src/` directly, through the
 * `bun` export condition (`package.json`), so tests and previews need no build.
 *
 * The public entries only: the root (`index.ts`) and `./analysis`. The Bun plugin and the command
 * line (`src/project/bun.ts`, `cli.ts`) are Bun programs, imported from `src/` by what uses them.
 */
import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    analysis: './src/analysis/index.ts',
  },
  platform: 'node',
  transform: { target: 'node24' },
  // Only bare specifiers (dependencies) are external. Resolved ids arrive as absolute paths, which
  // on Windows look like "C:/..." rather than "/...", so `isAbsolute()` decides, not a leading slash.
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    format: 'esm',
    minify: true,
    sourcemap: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
