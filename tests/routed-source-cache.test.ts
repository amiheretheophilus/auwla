import { describe, expect, it } from 'bun:test';
import { analyzeServerFunctionModule, compileModules, generateServerFunctionClient } from '@memoized-dom/compiler';
import { createDataRuntime, $read } from '@memoized-dom/data';
import * as dataInternal from '@memoized-dom/data/internal';
import {
  createRouteRuntime, prepareInitialRoutedRuntime, registerRoutedPreparation,
  restoreRoutedPreparationState, serializeRoutedPreparationState,
} from '@memoized-dom/router/internal';
import { createMemoryRouteHistory } from '@memoized-dom/router';
import type { RoutedPreparationDefinition } from '../packages/router/src/preparation';

function compiledPreparation(body: string): RoutedPreparationDefinition {
  const functions = analyzeServerFunctionModule(`export const getExpeditions = define.function({ async get() { return []; } });`,
    { moduleId: '/app/server/functions/expeditions.ts' });
  const output = compileModules({
    './functions.ts': generateServerFunctionClient(functions),
    './Page.tsx': `import { getExpeditions } from './functions';
      import { $fetch, $read } from '@memoized-dom/data';
      export function Page() {
        const expeditions = $routed(({ routeState, params }) => { ${body} });
        return <main route="/items/:id">{expeditions.map(e => <p>{e.name}</p>)}</main>;
      }`,
  })['./Page.tsx']!;
  let definition: RoutedPreparationDefinition | undefined;
  const runtime = createDataRuntime({ fetch: async () => Response.json([{ id: 'one', name: 'First' }]) });
  const code = output.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const noop = () => {};
  new Function('_MD', '_MR', '_MDD', 'getExpeditions', '$fetch', '$read', code)(
    new Proxy({}, { get: () => noop }),
    { registerRoutedPreparation(value: RoutedPreparationDefinition) { definition = value; },
      createPreparedRouteMatcher: noop, replacePreparedRouteResolver: noop, ensureRouterConnected: noop },
    dataInternal, () => runtime.$fetch('/_fn/expeditions/getExpeditions'),
    runtime.$fetch, $read,
  );
  if (!definition) throw new Error('Expected an extracted preparation');
  // The runtime remains reusable; the callback owns each later source invocation.
  runtime.clear();
  return definition;
}

describe('compiled routed cache hydration', () => {
  it('transfers server-function caches as payloads and reads them on client revisits', async () => {
    const definition = compiledPreparation(`
      if (routeState.expeditions) return routeState.expeditions;
      const result = getExpeditions();
      routeState.expeditions = result;
      return result;
    `);
    registerRoutedPreparation(definition);
    const options = {
      environment: {},
      routes: [{ id: 'items', pattern: '/items/:id', metadata: { preparations: [definition.id] } }],
    };
    const server = createRouteRuntime({ ...options, routeHistory: createMemoryRouteHistory({ initialEntries: ['/items/one'] }) });
    const client = createRouteRuntime({ ...options, routeHistory: createMemoryRouteHistory({ initialEntries: ['/items/one'] }) });
    try {
      await prepareInitialRoutedRuntime(server);
      const payload = JSON.parse(JSON.stringify(serializeRoutedPreparationState(server)));
      expect(payload.entries[0].data).toEqual([{ id: 'one', name: 'First' }]);
      expect(payload.entries[0].state).toEqual({ expeditions: [{ id: 'one', name: 'First' }] });
      restoreRoutedPreparationState(client, payload);
      await prepareInitialRoutedRuntime(client, { reusePrepared: true });
      // A later preparation reruns the authored callback and reads the hydrated cache.
      await prepareInitialRoutedRuntime(client);
      expect(serializeRoutedPreparationState(client)!.entries[0]!.data).toEqual([{ id: 'one', name: 'First' }]);
    } finally { server.dispose(); client.dispose(); }
  });

  it('evaluates fetch/read-derived payloads before caching instead of leaking wrappers', async () => {
    const definition = compiledPreparation(`
      const result = $fetch('/api/items');
      const suffix = $read(Promise.resolve('!'));
      routeState.expeditions = result.map(e => ({ ...e, name: e.name + suffix }));
      return routeState.expeditions;
    `);
    registerRoutedPreparation(definition);
    const route = createRouteRuntime({ environment: {},
      routes: [{ id: 'items', pattern: '/items/:id', metadata: { preparations: [definition.id] } }],
      routeHistory: createMemoryRouteHistory({ initialEntries: ['/items/one'] }),
    });
    try {
      await prepareInitialRoutedRuntime(route);
      const payload = serializeRoutedPreparationState(route)!;
      expect(payload.entries[0]!.data).toEqual([{ id: 'one', name: 'First!' }]);
      expect(payload.entries[0]!.state.expeditions).toEqual(payload.entries[0]!.data);
    } finally { route.dispose(); }
  });
});
