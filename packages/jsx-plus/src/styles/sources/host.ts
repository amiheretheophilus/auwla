/** File access belongs to the editor host; this contract has no editor/runtime API. */
export interface CssSourceHost {
  readFile(uri: string): string | undefined | Promise<string | undefined>;
  readDirectory(uri: string): readonly CssDirectoryEntry[] | Promise<readonly CssDirectoryEntry[]>;
  /** An injected resolver may handle aliases. Undefined defers unsupported specifiers. */
  resolve?(specifier: string, importer: string): string | undefined | Promise<string | undefined>;
}

export interface CssDirectoryEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

/** Untitled/opaque URIs have no directory from which relative imports can resolve. */
export function sourceDirectory(uri: string): string | undefined {
  const address = new URL(uri);
  return address.pathname.startsWith('/') ? new URL('./', address).href : undefined;
}

/** Encode path segments, so a literal #, % or space remains a filename character. */
export function relativeSourceUri(specifier: string, importer: string): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return undefined;
  }
  if (sourceDirectory(importer) === undefined) {
    return undefined;
  }
  const path = specifier.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return new URL(path, importer).href;
}
