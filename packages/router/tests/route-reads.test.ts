/**
 * Route reads that compiled code follows (`src/route-reads.ts`): each field of `route`, and each
 * route region, wakes its readers only when its own value changes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createComputation } from '@memoized-dom/runtime';
import { createRouteRuntime, route, setActiveRouteRuntime, type RouteRuntime } from '../src/index';
import { installRouteTable, registerRoutedPreparation, routeRegion } from '../src/internal';

let runtime: RouteRuntime;

beforeEach(() => {
  runtime = createRouteRuntime({ environment: { location: { href: 'http://localhost/story/1' } as Location } });
  setActiveRouteRuntime(runtime);
  installRouteTable([
    { id: 'story', pattern: '/story/:id', fullPattern: '/story/:id', ownParamNames: ['id'], chain: [0] },
    { id: 'about', pattern: '/about', fullPattern: '/about', ownParamNames: [], chain: [1] },
  ]);
});

afterEach(() => {
  runtime.dispose();
  setActiveRouteRuntime(null);
});

/** How many times a computation reading `read` is told something it read changed. */
function follow(read: () => unknown): { readonly count: number } {
  const counter = { count: 0 };
  const computation = createComputation(() => {
    counter.count++;
  });
  computation.begin(true);
  read();
  computation.end(true);
  return counter;
}

describe('route reads', () => {
  it('wake a field\'s readers only when that field changes', () => {
    const params = follow(() => route.params.id);
    const query = follow(() => route.query.get('tab'));
    const hash = follow(() => route.hash);

    runtime.navigate('/story/:id', { params: { id: '1' }, hash: 'top' });
    expect([params.count, query.count, hash.count]).toEqual([0, 0, 1]);

    runtime.navigate('/story/:id', { params: { id: '1' }, query: { tab: 'new' } });
    expect([params.count, query.count]).toEqual([0, 1]);

    runtime.navigate('/story/:id', { params: { id: '2' }, query: { tab: 'new' } });
    expect([params.count, query.count]).toEqual([1, 1]);
  });

  it('wake a region\'s readers when it opens, closes or matches another path', () => {
    const story = follow(() => routeRegion('story'));
    const about = follow(() => routeRegion('about'));
    expect(routeRegion('story')).not.toBeNull();

    runtime.navigate('/story/:id', { params: { id: '1' }, query: { tab: 'x' } });
    expect([story.count, about.count]).toEqual([0, 0]);

    runtime.navigate('/story/:id', { params: { id: '2' } });
    expect([story.count, about.count]).toEqual([1, 0]);

    runtime.navigate('/about');
    expect([story.count, about.count]).toEqual([2, 1]);
    expect(routeRegion('story')).toBeNull();
  });

  it('set nothing up for a read outside a computation', () => {
    expect(route.pathname).toBe('/story/1');
    expect(routeRegion('about')).toBeNull();
  });

  it('wake readers of pending and next as a navigation starts and stops waiting', async () => {
    let release!: (value: string) => void;
    registerRoutedPreparation({
      id: 'reads-waiting', server: false,
      prepare: () => new Promise<string>((resolve) => { release = resolve; }),
    });
    const waiting = createRouteRuntime({ environment: {}, routes: [
      { id: 'home', pattern: '/' },
      { id: 'slow', pattern: '/slow', metadata: { preparations: ['reads-waiting'] } },
    ] });
    setActiveRouteRuntime(waiting);
    const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      const pending = follow(() => route.pending);
      const next = follow(() => route.next);
      const pathname = follow(() => route.pathname);

      const result = waiting.navigate('/slow');
      if (result.status !== 'preparing') throw new Error('Expected preparation');
      await settled();
      // Waiting changes only what is waiting: the page shown is the same.
      expect([pending.count, next.count, pathname.count]).toEqual([1, 1, 0]);

      release('slow');
      await result.finished;
      await settled();
      expect([pending.count, next.count, pathname.count]).toEqual([2, 2, 1]);
    } finally {
      waiting.dispose();
      setActiveRouteRuntime(runtime);
    }
  });
});
