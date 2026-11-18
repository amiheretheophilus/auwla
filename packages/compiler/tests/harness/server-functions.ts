/**
 * Server function fixtures: the client module an app imports from
 * `#server-functions`, generated from a real `define.function` file by the
 * application's own generator (`src/server/generate.ts`). A case adds it under `modules` and
 * imports it by a relative path. The reference and the compiled run get the same module text.
 */
import { analyzeServerFunctions } from '../../src/server/functions';
import { serverFunctionClient as generateClient } from '../../src/server/generate';

/** The client module for `server/functions/<name>.ts`, whose source is `definitions`. */
export function serverFunctionClient(name: string, definitions: string): string {
  return generateClient(analyzeServerFunctions(`server/functions/${name}.ts`, definitions));
}
