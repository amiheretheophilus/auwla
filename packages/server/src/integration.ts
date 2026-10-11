import type { ServerApplication } from './serve';
import type { ServerRoute } from './http-router';

/** Host-supplied frontend delivery. The server core never opens a listener. */
export interface ServerIntegration {
  readonly routes: readonly ServerRoute[];
  readonly document: (request: Request) => string | undefined | Promise<string | undefined>;
  readonly assets: (request: Request, platform?: unknown) => Response | undefined | Promise<Response | undefined>;
}

/** Used by generated backend integrations, including applications mounted in another router. */
export function integrateApplication<L extends object, P, S extends object>(
  application: ServerApplication<L, P, S>,
  integration: ServerIntegration,
): ServerApplication<L, P, S> {
  const installable = application as ServerApplication<L, P, S> & {
    installServerFunctions(routes: readonly ServerRoute[]): void;
    installIntegration(integration: ServerIntegration): void;
  };
  installable.installServerFunctions(integration.routes);
  installable.installIntegration(integration);
  return application;
}
