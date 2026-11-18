/**
 * `.memoized/server-config.d.ts` (`wiki/compiler/server.md`, "Server types"): what the server
 * folder's `define.ts` and services tell TypeScript about every request. With it, a server
 * function's context, a middleware's and a server-backed `$routed` callback's read `state`,
 * `platform` and `services` with the types the app gave them, with no annotation at each use.
 *
 * - `state` and `platform` come from the `define` that `define.ts` exports
 *   (`createDefine<State, Platform>()`).
 * - `services` has each `export const x = define.service('name', …)` of the folder, by its name.
 *
 * The file registers them in `@memoized-dom/server/router`'s and `@memoized-dom/router`'s type
 * registries. Ported from the old Vite plugin (`packages/vite/src/server-config.ts`), without its
 * file system: the application gives the modules.
 */
import { relativeModule } from '../core/resolve/imports';
import type { ServerService } from './registry';

/** Where the file is, as a project path: its imports are relative to it. */
export const SERVER_CONFIG_DECLARATIONS = './.memoized/server-config.d.ts';

/**
 * The declarations for the server folder's `define` module (a project path) and its services, or
 * null when the folder has no `define` module: then there is nothing to register.
 */
export function serverConfigDeclarations(define: string | null, services: readonly ServerService[]): string | null {
  if (define === null) return null;
  const specifier = (path: string) => JSON.stringify(typeSpecifier(path));

  const imports = [`import type { define as __MemoizedDomDefinition } from ${specifier(define)};`];
  const fields: string[] = [];
  services.forEach((service, index) => {
    imports.push(`import type { ${service.exported} as __MemoizedDomService${index} } from ${specifier(service.path)};`);
    fields.push(`${JSON.stringify(service.name)}: import('@memoized-dom/server').ServiceValue<typeof __MemoizedDomService${index}>;`);
  });

  return `${imports.join('\n')}

type __MemoizedDomServerTypes = {
  state: import('@memoized-dom/server').DefinitionState<typeof __MemoizedDomDefinition>;
  platform?: import('@memoized-dom/server').DefinitionPlatform<typeof __MemoizedDomDefinition>;
  services: {${fields.map((field) => `\n    ${field}`).join('')}
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
}

/** A module's specifier from the declaration file, without its extension, as TypeScript resolves it. */
function typeSpecifier(path: string): string {
  return relativeModule(SERVER_CONFIG_DECLARATIONS, path.replace(/\.[^./]+$/, ''));
}
