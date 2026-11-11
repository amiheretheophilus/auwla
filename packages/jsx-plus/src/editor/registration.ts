import manifest from '../../package.json';

/** Shared editor metadata. No editor SDK or compiler facade is loaded here. */
export const auwlaLanguage = {
  id: 'auwla',
  aliases: ['Auwla', 'auwla'],
  extensions: ['.auwla'],
  scopeName: 'source.auwla',
} as const;

/**
 * TypeScript content-mapper registration for a local installation of this
 * package. Editors supply its directory; the mapper runs from that directory,
 * just as it does when TypeScript reads the package's contentMapper manifest.
 * This object contains protocol data, not an editor-specific URI instance.
 */
export function createMapperContribution(packageDirectory: string) {
  return {
    extensions: auwlaLanguage.extensions,
    inferredProjectContribution: {
      manifest: {
        name: manifest.name,
        version: manifest.version,
        ...manifest.typescript.contentMapper,
        cwd: { scheme: 'file', fsPath: packageDirectory },
      },
    },
  };
}
