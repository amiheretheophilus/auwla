/**
 * JSX+'s build: plain JavaScript in `dist/` for Node, which cannot load the TypeScript sources
 * (their imports leave out the extension). Bun keeps loading `src/` directly, through the `bun`
 * export condition (`package.json`), so tests, previews and the editor need no build.
 *
 * Two entries share one copy of the language: the root (`index.ts`) and `./language`, which
 * the compiler's project layer imports to read `.auwla` by default
 * (`compiler/src/project/languages.ts`). The editor and checking entries are bundled by the
 * editor extension itself.
 */
import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    language: './src/language.ts',
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
