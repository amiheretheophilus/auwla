/** A region's identity is worked out once per matches array, and follows a new array. */
import { describe, expect, it } from 'bun:test';
import { routeRegionIdentity } from '../src/region-identity';
import type { RouteMatch, RouteState } from '../src/types';

function routeWith(matches: readonly RouteMatch[]): RouteState {
  return { matches } as unknown as RouteState;
}

function match(id: string, pathname: string): RouteMatch {
  return Object.freeze({ id, pattern: pathname, pathname, params: Object.freeze({}), metadata: undefined }) as RouteMatch;
}

describe('route region identity', () => {
  it('gives the same string for the same matches, and null for a region not matched', () => {
    const route = routeWith(Object.freeze([match('posts', '/posts/7')]));
    const first = routeRegionIdentity(route, 'posts');

    expect(first).toBe(JSON.stringify(['posts', '/posts/7']));
    expect(routeRegionIdentity(route, 'posts')).toBe(first);
    expect(routeRegionIdentity(route, 'about')).toBeNull();
    expect(routeRegionIdentity(route, 'about')).toBeNull();
  });

  it('follows a navigation, which freezes a new matches array', () => {
    const before = routeWith(Object.freeze([match('posts', '/posts/7')]));
    const after = routeWith(Object.freeze([match('posts', '/posts/8')]));

    expect(routeRegionIdentity(before, 'posts')).toBe(JSON.stringify(['posts', '/posts/7']));
    expect(routeRegionIdentity(after, 'posts')).toBe(JSON.stringify(['posts', '/posts/8']));
    expect(routeRegionIdentity(routeWith(Object.freeze([])), 'posts')).toBeNull();
  });
});
