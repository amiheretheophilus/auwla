import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse } from 'node:path';
import { resolvableFile, type DiscoveredPackageArtifact } from './package-artifacts';
import type { GraphPluginContext } from './collector';

function incompatible(packageName: string, message: string): never {
  throw new Error(`memo-dom: package compatibility check failed for '${packageName}': ${message}; install a compatible runtime or rebuild the package with a compatible compiler`);
}

/** Inspect the actual host-resolved runtime, never import/execute its code. */
export async function verifyPackageRuntimeCompatibility(
  discovered: DiscoveredPackageArtifact,
  importer: string,
  runtimePath: string,
  context: GraphPluginContext,
  cache: Map<string, Promise<string>>,
): Promise<readonly string[]> {
  const required = discovered.artifact.compatibility?.runtime;
  if (required === undefined) return [];
  const packageName = Object.keys(discovered.artifact.entries).join(', ');
  const check = (specifier: string, from: string): Promise<string> => {
    const key = JSON.stringify([specifier, from, required.abi]);
    let pending = cache.get(key);
    if (pending !== undefined) return pending;
    pending = (async () => {
      const resolution = await context.resolve(specifier, from, { skipSelf: true });
      if (resolution !== null && !isAbsolute(resolution.id) && resolution.id !== specifier) {
        incompatible(packageName, `runtime '${specifier}' from '${from}' resolves to an unverifiable virtual/non-file module '${resolution.id}'`);
      }
      const file = resolution === null ? undefined : resolvableFile(
        resolution.id === specifier ? resolution.id : resolution.id.replace(/[?#].*$/, ''), specifier, from);
      if (file === undefined) incompatible(packageName, `cannot resolve runtime '${specifier}' from '${from}' (requires ABI ${required.abi})`);
      let actual: string;
      try { actual = await realpath(file); }
      catch { return incompatible(packageName, `cannot inspect resolved runtime '${file}' from '${from}' (requires ABI ${required.abi})`); }
      let directory = dirname(actual);
      const root = parse(directory).root;
      while (directory !== root) {
        const manifestFile = join(directory, 'package.json');
        if (existsSync(manifestFile)) {
          context.addWatchFile(manifestFile);
          const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
            name?: string; version?: string; 'memoized-dom'?: { runtimeABI?: unknown };
          };
          const supported = manifest['memoized-dom']?.runtimeABI;
          if (!Array.isArray(supported) || supported.length === 0 ||
              !supported.every(abi => Number.isSafeInteger(abi) && abi > 0) || !supported.includes(required.abi)) {
            incompatible(packageName, `runtime '${specifier}' resolved from '${from}' to '${manifestFile}' (${manifest.name ?? 'unnamed'}@${manifest.version ?? 'unknown'}) does not declare support for ABI ${required.abi}`);
          }
          return manifestFile;
        }
        directory = dirname(directory);
      }
      return incompatible(packageName, `runtime '${specifier}' from '${from}' has no owning package.json declaring ABI ${required.abi}`);
    })();
    cache.set(key, pending);
    return pending;
  };
  // Every finalized chunk may resolve a different nested dependency copy.
  // Unsealed artifacts can only establish their entry's resolution context.
  const packageImporters = discovered.verifiedFiles.length > 0 ? discovered.verifiedFiles : [discovered.resolvedFile];
  return [...new Set(await Promise.all([
    ...packageImporters.map(from => check(required.specifier, from)),
    check(runtimePath, importer),
  ]))];
}
