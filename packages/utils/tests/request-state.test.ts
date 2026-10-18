import { afterEach, describe, expect, it } from 'bun:test';
import {
  $fetch,
  $track,
  clearDataRuntime,
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';
import { error, pending, refreshing, status, streaming } from '@memoized-dom/utils';
import { waitFor } from '../../../test-support/helpers';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

afterEach(() => clearDataRuntime());

describe('request state projections', () => {
  it('projects the current tracker state without owning another request', async () => {
    const responses = [deferred<Response>(), deferred<Response>()];
    let calls = 0;
    const runtime = createDataRuntime({ fetch: () => responses[calls++]!.promise });
    const previous = setActiveDataRuntime(runtime);
    try {
      const stories = $fetch<{ id: number }[]>('/stories');
      expect(pending(stories)).toBe(true);
      expect(refreshing(stories)).toBe(false);
      expect(streaming(stories)).toBe(false);
      expect(status(stories)).toBe('pending');
      expect(error(stories)).toBeNull();

      responses[0]!.resolve(Response.json([{ id: 1 }]));
      await waitFor(() => expect(status(stories)).toBe('success'));
      expect(pending(stories)).toBe(false);

      const refresh = $track(stories).refresh();
      expect(refreshing(stories)).toBe(true);
      expect(calls).toBe(2);
      responses[1]!.resolve(Response.json([{ id: 1 }, { id: 2 }]));
      await refresh;
      expect(refreshing(stories)).toBe(false);
      expect(status(stories)).toBe('success');
      expect(error(stories)).toBeNull();
    } finally {
      runtime.clear();
      setActiveDataRuntime(previous);
    }
  });
});
