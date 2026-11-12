/**
 * `$routed` callbacks that make sources (`routed.ts`): each source is settled where it is made, so
 * what the callback computes, caches in `routeState` and returns is data, which a server can send
 * and a later visit can read again. The reference has its own `$fetch`, which the router cannot
 * settle, so this is checked on compiled output against known values (the old compiler's
 * `tests/routed-source-cache.test.ts`, which evaluated that compiler's text).
 */
import { afterEach, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { createMemoryRouteHistory, createRouteRuntime, setActiveRouteRuntime, type RouteRuntime } from '@memoized-dom/router';
import { prepareInitialRoutedRuntime, restoreRoutedPreparationState, serializeRoutedPreparationState } from '@memoized-dom/router/internal';
import { compileModules } from '../../pipeline';

let sequence = 0;
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A route runtime at `/items/one`, active while the case runs, with a data runtime answering every request. */
function runtimes(): RouteRuntime {
  const data = createDataRuntime({ fetch: async () => Response.json([{ id: 'one', name: 'First' }]) });
  const previous = setActiveDataRuntime(data);
  const route = createRouteRuntime({ environment: {}, routeHistory: createMemoryRouteHistory({ initialEntries: ['/items/one'] }) });
  setActiveRouteRuntime(route);
  cleanups.push(() => {
    route.dispose();
    setActiveRouteRuntime(null);
    data.clear();
    setActiveDataRuntime(previous);
  });
  return route;
}

/** Compile a page whose `$routed` callback is `body`, and load it so it registers its preparation and route. */
async function load(body: string): Promise<void> {
  const directory = join(import.meta.dirname, '../../../tests/out/routed-sources');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `case-${sequence++}.js`);
  writeFileSync(file, compileModules({
    './App.tsx': `
      import { $fetch, $read } from '@memoized-dom/data';
      export function App() {
        const items = $routed(({ routeState, params }) => { ${body} });
        return <main route="/items/:id">{items.map((item) => <p>{item.name}</p>)}</main>;
      }`,
  }, { runtimePath: '@memoized-dom/runtime/testing', routedEnvironment: 'server' })['./App.tsx']!);
  await import(pathToFileURL(file).href);
}

it('settles fetched and read values before the callback derives and caches from them', async () => {
  const route = runtimes();
  await load(`
    const result = $fetch('/api/items');
    const suffix = $read(Promise.resolve('!'));
    routeState.items = result.map((item) => ({ ...item, name: item.name + suffix }));
    return routeState.items;`);

  await prepareInitialRoutedRuntime(route);
  const payload = serializeRoutedPreparationState(route)!;
  expect(payload.entries[0]!.data).toEqual([{ id: 'one', name: 'First!' }]);
  expect(payload.entries[0]!.state.items).toEqual(payload.entries[0]!.data);
});

it('caches a payload a later visit reads again from the delivered state', async () => {
  const server = runtimes();
  await load(`
    if (routeState.items) return routeState.items;
    const result = $fetch('/api/items');
    routeState.items = result;
    return result;`);

  await prepareInitialRoutedRuntime(server);
  const payload = JSON.parse(JSON.stringify(serializeRoutedPreparationState(server)));
  expect(payload.entries[0].data).toEqual([{ id: 'one', name: 'First' }]);
  expect(payload.entries[0].state).toEqual({ items: [{ id: 'one', name: 'First' }] });

  const client = createRouteRuntime({ environment: {}, routeHistory: createMemoryRouteHistory({ initialEntries: ['/items/one'] }) });
  setActiveRouteRuntime(client);
  cleanups.push(() => client.dispose());
  restoreRoutedPreparationState(client, payload);
  await prepareInitialRoutedRuntime(client, { reusePrepared: true });
  // A later preparation runs the callback again, which reads the delivered cache.
  await prepareInitialRoutedRuntime(client);
  expect(serializeRoutedPreparationState(client)!.entries[0]!.data).toEqual([{ id: 'one', name: 'First' }]);
});
