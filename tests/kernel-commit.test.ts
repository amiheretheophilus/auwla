/**
 * `commit()` is the kernel's public flush-now API: with a capturing scheduler, nothing renders
 * until it is called. Kept from the M5.6 suite, whose other parts tested the old compiler's
 * access table and list region (deleted 2026-11-18).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { _internals, commit, markDirty, register, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

describe('public commit() flush', () => {
  afterEach(() => {
    resetScheduler();
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('with a capturing scheduler, nothing renders until commit()', () => {
    let scheduledFn: (() => void) | null = null;
    setScheduler((fn) => {
      scheduledFn = fn;
    });

    let renders = 0;
    register({
      id: 'App',
      parent: null,
      render: () => {
        renders++;
      },
    });
    markDirty('App');
    expect(renders).toBe(0); // only scheduled
    expect(scheduledFn).not.toBeNull();

    commit();
    expect(renders).toBe(1); // flushed synchronously
  });

  it('commit() with an empty dirty set is a no-op', () => {
    expect(() => commit()).not.toThrow();
  });
});
