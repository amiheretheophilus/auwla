import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExperimentalPackageArtifact } from '@memoized-dom/compiler';

/** Artifacts that the Vite host discovers automatically in real applications. */
export const utilsPackageArtifact = JSON.parse(readFileSync(join(
  import.meta.dirname,
  '..',
  'packages',
  'utils',
  'dist',
  'memoized-dom.package.json',
), 'utf8')) as ExperimentalPackageArtifact;

export const utilsPackageArtifacts = {
  experimentalPackageArtifacts: [utilsPackageArtifact],
} as const;
