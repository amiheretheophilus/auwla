import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { DepOptimizationMetadata } from 'vite';
import {
  experimentalPackageArtifactInstance,
  validateExperimentalPackageArtifact,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';

interface PackageManifest {
  readonly name?: string;
  readonly 'memoized-dom'?: {
    readonly artifact?: string;
  };
}

/** Semantic discovery follows Vite's real package entry, not its cache wrapper. */
export function packageArtifactSource(id: string, metadata?: Pick<DepOptimizationMetadata, 'depInfoList'>): string {
  const file = id.replace(/[?#].*$/, '').replaceAll('\\', '/');
  return metadata?.depInfoList.find(info => info.src && info.file.replaceAll('\\', '/') === file)?.src ?? id;
}

function packageName(specifier: string): string | undefined {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.includes(':')
  ) return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined
    : parts[0];
}

export interface DiscoveredPackageArtifact {
  readonly artifact: ExperimentalPackageArtifact;
  readonly instance: string;
  readonly artifactFile: string;
  readonly manifestFile: string;
}

function resolvableFile(
  resolvedId: string,
  specifier: string,
  importer: string,
): string | undefined {
  if (isAbsolute(resolvedId)) return resolvedId;
  const require = createRequire(importer);
  try {
    return require.resolve(specifier);
  } catch {
    // SSR may externalize an import-only ESM entry as a bare specifier. A
    // require-condition lookup cannot resolve it, and package.json itself may
    // also be hidden by exports. Locate its owning manifest using the same
    // importer-relative package search, without inventing an executable entry.
    if (resolvedId !== specifier) return undefined;
    const name = packageName(specifier);
    if (name === undefined) return undefined;
    for (const directory of require.resolve.paths(specifier) ?? []) {
      const manifest = join(directory, name, 'package.json');
      if (existsSync(manifest)) return manifest;
    }
    return undefined;
  }
}

/** Find package-owned semantic metadata without admitting package source to the app graph. */
export async function discoverPackageArtifact(
  resolvedId: string,
  specifier: string,
  importer: string,
): Promise<DiscoveredPackageArtifact | undefined> {
  const expectedPackage = packageName(specifier);
  if (expectedPackage === undefined) return undefined;
  const resolvedFile = resolvableFile(resolvedId, specifier, importer);
  if (resolvedFile === undefined) return undefined;
  let directory = dirname(resolvedFile);
  const root = parse(directory).root;
  while (directory !== root) {
    const manifestFile = join(directory, 'package.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(
        await readFile(manifestFile, 'utf8'),
      ) as PackageManifest;
      if (manifest.name !== expectedPackage) return undefined;
      const declared = manifest['memoized-dom']?.artifact;
      if (declared === undefined) return undefined;
      const artifactFile = resolve(directory, declared);
      const artifactRelative = relative(directory, artifactFile);
      if (
        artifactRelative === '' ||
        artifactRelative === '..' ||
        artifactRelative.startsWith(`..${sep}`) ||
        isAbsolute(artifactRelative)
      ) {
        throw new Error(
          `memo-dom: package '${expectedPackage}' declares an artifact outside its package directory`,
        );
      }
      const artifact = validateExperimentalPackageArtifact(JSON.parse(
        await readFile(artifactFile, 'utf8'),
      ));
      return {
        artifact,
        instance: experimentalPackageArtifactInstance(artifact),
        artifactFile,
        manifestFile,
      };
    }
    directory = dirname(directory);
  }
  return undefined;
}
