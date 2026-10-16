import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  definePackageBoundaries,
  experimentalCompilePackage,
} from '@memoized-dom/compiler';

const root = join(import.meta.dirname, '..');
const names = ['index.ts', 'optimistic.ts', 'request-state.ts'] as const;
const modules = Object.fromEntries(await Promise.all(names.map(async name => [
  `./${name}`,
  await readFile(join(root, 'src', name), 'utf8'),
])));

// This runtime boundary consumes holder identity without reading the holder's
// resolved payload. Package compilation carries that fact through ordinary
// helpers which call it; applications never need to know about this contract.
const dataInternalArtifact = definePackageBoundaries({
  '@memoized-dom/data/internal': {
    protectLiveSources: {
      source: [0],
    },
  },
});

const { artifact } = experimentalCompilePackage(modules, {
  experimentalPackageArtifacts: [dataInternalArtifact],
  packageEntries: {
    '@memoized-dom/utils': {
      moduleId: './index.ts',
      exports: ['error', 'optimistic', 'pending', 'refreshing', 'status', 'streaming'],
      runtimeOwnedState: true,
    },
  },
});

await writeFile(
  join(root, 'dist', 'memoized-dom.package.json'),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
