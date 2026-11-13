/**
 * A compiled route table (`installRouteTable`) and the runtimes it reaches: it is replayed onto
 * every runtime activated after it installs, unless the runtime has routes of its own, and a table
 * installed again gives the current route its own metadata.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createRouteRuntime, setActiveRouteRuntime, type RouteRuntime } from '../src/index';
import { installRouteTable } from '../src/internal';

const runtimes: RouteRuntime[] = [];

function activate(runtime: RouteRuntime): RouteRuntime {
  runtimes.push(runtime);
  setActiveRouteRuntime(runtime);
  return runtime;
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  setActiveRouteRuntime(null);
});

const at = (href: string) => ({ environment: { location: { href } as Location } });

function table(metadata: Record<string, unknown>) {
  return [{ id: 'page', pattern: '/page', fullPattern: '/page', ownParamNames: [], chain: [0], metadata }];
}

describe('a compiled route table', () => {
  it('reaches a runtime activated after it, as a server request\'s is', () => {
    activate(createRouteRuntime(at('http://localhost/page')));
    installRouteTable(table({ title: 'compiled' }));

    const request = activate(createRouteRuntime(at('http://localhost/page')));
    expect(request.route.matches.map((match) => match.id)).toEqual(['page']);
  });

  it('leaves a runtime created with routes of its own to them', () => {
    activate(createRouteRuntime(at('http://localhost/page')));
    installRouteTable(table({ title: 'compiled' }));

    const own = activate(createRouteRuntime({ ...at('http://localhost/mine'), routes: [{ id: 'mine', pattern: '/mine' }] }));
    expect(own.route.matches.map((match) => match.id)).toEqual(['mine']);
  });

  it('installed again, gives the current route the new table\'s metadata', () => {
    const runtime = activate(createRouteRuntime(at('http://localhost/page')));
    installRouteTable(table({ version: 1 }));
    expect(runtime.route.matches[0]!.metadata).toEqual({ version: 1 });

    // The same routes, so nothing a route read sees changes; a hot update or a fresh app.
    installRouteTable(table({ version: 2 }));
    expect(runtime.route.matches[0]!.metadata).toEqual({ version: 2 });
  });
});
