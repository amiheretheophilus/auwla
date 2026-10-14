import { describe, expect, it } from 'bun:test';
import { LiveHub } from '../src/live';

describe('hierarchical live keys', () => {
  it('notifies ancestors, exact matches, and descendants once, without waking siblings or unrelated families', () => {
    const hub = new LiveHub();
    const calls = { overview: 0, one: 0, summary: 0, two: 0, other: 0 };
    const stop = [
      hub.subscribe(hub.key(['notes']), () => calls.overview++),
      hub.subscribe(hub.key(['notes', 'one']), () => calls.one++),
      hub.subscribe(hub.key(['notes', 'one', 'summary']), () => calls.summary++),
      hub.subscribe(hub.key(['notes', 'two']), () => calls.two++),
      hub.subscribe(hub.key(['users']), () => calls.other++),
    ];
    try {
      expect(hub.invalidate(['notes', 'one'])).toMatchObject({ key: '["notes","one"]', revision: 1 });
      expect(calls).toEqual({ overview: 1, one: 1, summary: 1, two: 0, other: 0 });
      expect(hub.stamp(hub.key(['notes'])).revision).toBe(1);
      expect(hub.stamp(hub.key(['notes', 'one', 'summary'])).revision).toBe(1);
      expect(hub.stamp(hub.key(['notes', 'two'])).revision).toBe(0);
      hub.invalidate(['notes']);
      expect(calls).toEqual({ overview: 2, one: 2, summary: 2, two: 1, other: 0 });
      // A deeper write still affects broader reads even without an exact subscriber.
      hub.invalidate(['notes', 'one', 'missing']);
      expect(calls).toEqual({ overview: 3, one: 3, summary: 2, two: 1, other: 0 });
    } finally { for (const cancel of stop) cancel(); }
  });

  it('matches complete, typed segments rather than textual prefixes', () => {
    const hub = new LiveHub();
    const calls = { one: 0, extended: 0, number: 0, string: 0, otherFamily: 0 };
    const stop = [
      hub.subscribe(hub.key(['notes', 'one']), () => calls.one++),
      hub.subscribe(hub.key(['notes', 'one-more']), () => calls.extended++),
      hub.subscribe(hub.key(['notes', 1]), () => calls.number++),
      hub.subscribe(hub.key(['notes', '1']), () => calls.string++),
      hub.subscribe(hub.key(['notes-extra']), () => calls.otherFamily++),
    ];
    try {
      hub.invalidate(['notes', 'one']);
      hub.invalidate(['notes', 1]);
      expect(calls).toEqual({ one: 1, extended: 0, number: 1, string: 0, otherFamily: 0 });
      hub.invalidate(['notes']);
      expect(calls).toEqual({ one: 2, extended: 1, number: 2, string: 1, otherFamily: 0 });
    } finally { for (const cancel of stop) cancel(); }
  });

  it('keeps shared query indices until final release and makes cancellation idempotent across resubscriptions', () => {
    const hub = new LiveHub();
    const activity: boolean[] = [];
    hub.onActivity = active => activity.push(active);
    const calls: string[] = [];
    const key = hub.key(['notes', 'one']);
    const first = hub.subscribe(key, () => calls.push('first'));
    const second = hub.subscribe(key, () => calls.push('second'));
    first();
    hub.invalidate(['notes']);
    expect(calls).toEqual(['second']);
    second();
    hub.invalidate(['notes']);
    expect(calls).toEqual(['second']);
    const replacement = hub.subscribe(key, () => calls.push('replacement'));
    first(); second();
    hub.invalidate(['notes']);
    expect(calls).toEqual(['second', 'replacement']);
    replacement();
    expect(activity).toEqual([true, false, true, false]);
    // Prefix sets must not retain retired keys or listeners.
    expect(Reflect.get(hub, 'descendants').size).toBe(0);
  });
});
