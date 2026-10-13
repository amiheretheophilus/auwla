import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ResolvedAdapterOptions } from './options';
import { normalizeFile } from './paths';

const configExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;
const serverSourceExtensions = new Set<string>([...configExtensions, '.tsrx']);

export function serverRoot(
  root: string,
  options: ResolvedAdapterOptions,
): string {
  const configured = options.server ?? 'server';
  return normalizeFile(isAbsolute(configured)
    ? configured
    : resolve(root, configured));
}

export function resolveServerAlias(
  root: string,
  specifier: string,
  options: ResolvedAdapterOptions,
): string {
  const prefix = '#server/';
  if (!specifier.startsWith(prefix)) {
    throw new TypeError(`memo-dom: invalid server alias '${specifier}'`);
  }
  const base = serverRoot(root, options);
  const candidate = normalizeFile(resolve(base, specifier.slice(prefix.length)));
  const fromBase = relative(base, candidate);
  if (
    fromBase === '..' ||
    fromBase.startsWith(`..${sep}`) ||
    isAbsolute(fromBase)
  ) {
    throw new TypeError(
      `memo-dom: server alias '${specifier}' escapes the configured server root`,
    );
  }
  return candidate;
}

export function serverConfigSource(
  root: string,
  options: ResolvedAdapterOptions,
): string | null {
  const base = resolve(serverRoot(root, options), 'define');
  const matches = configExtensions
    .map(extension => normalizeFile(`${base}${extension}`))
    .filter(file => existsSync(file));
  if (matches.length > 1) {
    throw new Error(
      `memo-dom: server definition has multiple source files: ${matches.join(', ')}`,
    );
  }
  return matches[0] ?? null;
}

export function isServerConfigFile(
  root: string,
  file: string,
  options: ResolvedAdapterOptions,
): boolean {
  const base = normalizeFile(resolve(serverRoot(root, options), 'define'));
  const clean = normalizeFile(file);
  return configExtensions.some(extension => clean === `${base}${extension}`);
}

/** Whether a source file belongs to the configured server-only root. */
export function isServerSourceFile(
  root: string,
  file: string,
  options: ResolvedAdapterOptions,
): boolean {
  const base = serverRoot(root, options);
  const clean = normalizeFile(file);
  const fromBase = relative(base, clean).replaceAll('\\', '/');
  return serverSourceExtensions.has(
    clean.slice(clean.lastIndexOf('.')),
  ) &&
    !clean.endsWith('.d.ts') &&
    fromBase !== '..' &&
    !fromBase.startsWith('../') &&
    !isAbsolute(fromBase);
}

export function serverConfigDeclarationFile(root: string): string {
  return resolve(root, '.memoized', 'server-config.d.ts');
}

function typeSpecifier(root: string, source: string): string {
  const declarationDirectory = dirname(serverConfigDeclarationFile(root));
  const withoutExtension = source.replace(/\.[^.]+$/, '');
  const value = relative(declarationDirectory, withoutExtension)
    .replaceAll('\\', '/');
  return value.startsWith('.') ? value : `./${value}`;
}

export async function writeServerConfigDeclaration(
  root: string,
  options: ResolvedAdapterOptions,
  services: readonly {
    readonly file: string;
    readonly exported: string;
    readonly name: string;
  }[] = [],
): Promise<string | null> {
  const output = serverConfigDeclarationFile(root);
  const source = serverConfigSource(root, options);
  if (source === null) {
    if (existsSync(output)) await unlink(output);
    return null;
  }
  const serviceImports = services.map((service, index) =>
    `import type { ${service.exported} as __MemoizedDomService${index} } from ${JSON.stringify(typeSpecifier(root, service.file))};`
  ).join('\n');
  const serviceFields = services.map((service, index) =>
    `${JSON.stringify(service.name)}: import('@memoized-dom/server').ServiceValue<typeof __MemoizedDomService${index}>;`
  ).join('\n      ');
  const content = `import type { define as __MemoizedDomDefinition } from ${JSON.stringify(typeSpecifier(root, source))};
${serviceImports}

type __MemoizedDomServerTypes = {
  state: import('@memoized-dom/server').DefinitionState<typeof __MemoizedDomDefinition>;
  platform?: import('@memoized-dom/server').DefinitionPlatform<typeof __MemoizedDomDefinition>;
  services: {
      ${serviceFields}
  };
};

declare module '@memoized-dom/server/router' {
  interface ServerTypeRegistry {
    application: __MemoizedDomServerTypes;
  }
}

declare module '@memoized-dom/router' {
  interface RoutedTypeRegistry {
    application: __MemoizedDomServerTypes;
  }
}

export {};
`;
  const previous = await readFile(output, 'utf8').catch(() => undefined);
  if (previous !== content) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content);
  }
  return source;
}
