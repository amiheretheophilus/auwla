/**
 * An application mounted below a prefix (`/app`): the compiler's `base` option gives it to
 * `installRouteTable`, which mounts the runtime already made and every one activated later.
 * Its own file: a base, once declared, belongs to the process, as the table does.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createMemoryRouteHistory, createRouteRuntime, setActiveRouteRuntime, type RouteRuntime } from '../src/index';
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

const TABLE = [
  { id: 'home', pattern: '/', fullPattern: '/', ownParamNames: [], chain: [0], metadata: {} },
  { id: 'project', pattern: '/projects/:projectId', fullPattern: '/projects/:projectId', ownParamNames: ['projectId'], chain: [1], metadata: {} },
];

describe('a base path', () => {
  it('is read again from the current URL when a runtime is given one', () => {
    const history = createMemoryRouteHistory({ initialEntries: ['/app/projects/one?tab=a'] });
    const runtime = createRouteRuntime({ routeHistory: history, routes: [{ id: 'project', pattern: '/projects/:projectId' }] });
    expect(runtime.route.matches).toEqual([]);

    const seen: string[] = [];
    const stop = runtime.subscribeSelected((route) => route.pathname, (pathname) => seen.push(pathname));
    runtime.replaceBasePath('/app/');
    expect(runtime.route.pathname).toBe('/projects/one');
    expect(runtime.route.params).toEqual({ projectId: 'one' });
    expect(runtime.route.search).toBe('?tab=a');
    // The first is the value on subscribing, below no base.
    expect(seen).toEqual(['/app/projects/one', '/projects/one']);

    // Navigation writes the base in front of an application path.
    runtime.navigate('/projects/two');
    expect(new URL(history.location.href).pathname).toBe('/app/projects/two');
    stop();
    history.destroy();
    runtimes.push(runtime);
  });

  it('that the current URL is outside is refused, and the runtime keeps its base', () => {
    const runtime = createRouteRuntime(at('http://localhost/elsewhere'));
    runtimes.push(runtime);
    expect(() => runtime.replaceBasePath('/app')).toThrow("URL pathname '/elsewhere' is outside router basePath '/app'");
    expect(runtime.route.pathname).toBe('/elsewhere');
    expect(() => runtime.replaceBasePath('/:tenant')).toThrow('basePath must be static');
  });

  // A server bundle installs its table when it loads, before any request: its default runtime has
  // no page and no history, so its `/` is only a fallback. Found by the Vite acceptance run.
  it('moves a runtime with no location yet to its root, until a location is set', () => {
    const runtime = createRouteRuntime({ environment: {} });
    runtimes.push(runtime);
    runtime.replaceBasePath('/app');
    expect(runtime.route.pathname).toBe('/');

    // Once a location is set it is a real one, and one outside the base is refused again.
    runtime.setLocation('/app/projects/one');
    expect(runtime.route.pathname).toBe('/projects/one');
    expect(() => runtime.replaceBasePath('/other')).toThrow("URL pathname '/app/projects/one' is outside router basePath '/other'");
  });

  it('given with a compiled table mounts the active runtime and every one activated later', () => {
    const browser = activate(createRouteRuntime(at('http://localhost/app/projects/one')));
    installRouteTable(TABLE, '/app');
    expect(browser.route.pathname).toBe('/projects/one');
    expect(browser.route.matches.map((match) => match.id)).toEqual(['project']);

    // A server request's runtime, made from the request's full URL.
    const request = activate(createRouteRuntime(at('http://localhost/app')));
    expect(request.route.pathname).toBe('/');
    expect(request.route.matches.map((match) => match.id)).toEqual(['home']);

    // A runtime with routes of its own keeps its own base too.
    const own = activate(createRouteRuntime({ ...at('http://localhost/mine'), routes: [{ id: 'mine', pattern: '/mine' }] }));
    expect(own.route.pathname).toBe('/mine');
  });
});
