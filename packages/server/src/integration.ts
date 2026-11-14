import type { ServerApplication } from './serve';
import type { ServerRoute } from './http-router';
import type { RouteStyles } from './route-styles';

/** Host-supplied frontend delivery. The server core never opens a listener. */
export interface ServerIntegration {
  readonly routes: readonly ServerRoute[];
  readonly document: (request: Request) => string | undefined | Promise<string | undefined>;
  readonly assets: (request: Request, platform?: unknown) => Response | undefined | Promise<Response | undefined>;
  /**
   * The stylesheet URLs each lazily loaded route component's chunk brings, by component key, as
   * the tool's browser build found them. A page the server renders links those of its routes in
   * its head (`route-styles.ts`). Absent: the chunks load their styles when they run.
   */
  readonly routeStyles?: RouteStyles;
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
