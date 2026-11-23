import type { LibraryConfig } from '@memoized-dom/vite';

export default {
  entry: './src/index.ts',
  declarations: { tsconfig: './tsconfig.build.json' },
  // The app's compiler builds this source in its own graph. It hands `optimistic` the live
  // requests in `source` themselves, not their payloads (compiler `features/sources/classify.ts`,
  // `optimisticSource`), which the old compiler needed a `boundaries` entry to know.
  source: true,
} satisfies LibraryConfig;
