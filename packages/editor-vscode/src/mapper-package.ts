import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Installed adapters use the project's mapper; development hosts have a fallback. */
export function findMapperPackage(workspaceDirectories: readonly string[], extensionDirectory: string): string {
  for (const directory of [...workspaceDirectories, extensionDirectory]) {
    const require = createRequire(join(directory, 'package.json'));
    try {
      return dirname(require.resolve('@memoized-dom/jsx-plus/package.json'));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  }
  throw new Error('Open a project with @memoized-dom/jsx-plus installed so Auwla can locate its shared mapper.');
}
