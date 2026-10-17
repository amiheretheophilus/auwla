import type { LibraryConfig } from '@memoized-dom/vite';

export default {
  entry: './src/index.ts',
  declarations: { tsconfig: './tsconfig.build.json' },
  runtimeOwnedState: true,
  // This opaque runtime function consumes holder identity, not its payload.
  // Ordinary component/helper packages do not need runtime boundary declarations.
  boundaries: {
    '@memoized-dom/data/internal': {
      protectLiveSources: { source: [0] },
    },
  },
} satisfies LibraryConfig;
