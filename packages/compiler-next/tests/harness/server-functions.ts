/**
 * Server function fixtures: the client module an app imports from
 * `#server-functions`, generated from a real `define.function` file by the
 * framework's own generator. A case adds it under `modules` and imports it by a
 * relative path. The reference and the compiled run get the same module text.
 */
import { analyzeServerFunctionModule, generateServerFunctionClient } from '@memoized-dom/compiler';

/** The client module for `server/functions/<name>.ts`, whose source is `definitions`. */
export function serverFunctionClient(name: string, definitions: string): string {
  const module = analyzeServerFunctionModule(definitions, {
    moduleId: `server/functions/${name}.ts`,
    functionsRoot: 'server/functions',
  });
  return generateServerFunctionClient(module);
}
