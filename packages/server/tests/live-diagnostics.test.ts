import { expect, it, spyOn } from 'bun:test';
import { LiveHub, liveResponse } from '../src/live';

it('shows mismatched invalidation keys and matched subscriber counts without treating an empty match as an error', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  const hub = new LiveHub();
  let deliveries = 0;
  const cancel = hub.subscribe(hub.key(['notes', 'one']), () => deliveries++);
  try {
    hub.invalidate(['notez', 'one']);
    expect(deliveries).toBe(0);
    expect(debug.mock.calls).toContainEqual(['[memoized-dom:live] invalidate', {
      key: '["notez","one"]', revision: 1, epoch: hub.epoch, matchedKeys: [], subscribers: 0, reason: 'no-active-match',
    }]);
    hub.invalidate(['notes']);
    expect(deliveries).toBe(1);
    expect(debug.mock.calls).toContainEqual(['[memoized-dom:live] invalidate', {
      key: '["notes"]', revision: 2, epoch: hub.epoch, matchedKeys: ['["notes","one"]'], subscribers: 1, reason: 'matched',
    }]);
    cancel(); hub.invalidate(['notes']);
    expect(deliveries).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    expect(() => hub.invalidate([])).toThrow('nonempty arrays');
  } finally {
    cancel(); debug.mockRestore(); warn.mockRestore();
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

it('explains a discarded in-flight query while leaving SSE frames unchanged', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  const hub = new LiveHub(), key = hub.key(['notes']);
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const reader = liveResponse(hub, key, new Request('https://app.test/_fn/notes/get?secret=not-logged'), async () => {
    if (++calls === 1) await gate.promise;
    return 'private result';
  }).body!.getReader();
  try {
    const pending = reader.read();
    await Promise.resolve();
    hub.invalidate(['notes']); gate.resolve();
    const result = new TextDecoder().decode((await pending).value);
    expect(result).toContain('event: value\n');
    expect(result).not.toContain('diagnostic');
    expect(calls).toBe(2);
    expect(debug.mock.calls).toContainEqual(['[memoized-dom:live] query-discarded', {
      reason: 'invalidated-during-read', path: '/_fn/notes/get',
      stamp: { key, epoch: hub.epoch, revision: 0 }, current: { key, epoch: hub.epoch, revision: 1 },
    }]);
    const logs = JSON.stringify(debug.mock.calls);
    expect(logs).not.toContain('private result'); expect(logs).not.toContain('not-logged');
  } finally {
    gate.resolve(); await reader.cancel(); debug.mockRestore();
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

it('keeps production invalidations quiet and still notifies subscribers', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const debug = spyOn(console, 'debug').mockImplementation(() => {});
  const hub = new LiveHub();
  let deliveries = 0;
  const cancel = hub.subscribe(hub.key(['notes']), () => deliveries++);
  try { hub.invalidate(['notes']); expect(deliveries).toBe(1); expect(debug).not.toHaveBeenCalled(); }
  finally {
    cancel(); debug.mockRestore();
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
