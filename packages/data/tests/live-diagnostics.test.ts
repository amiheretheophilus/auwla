import { describe, expect, it, spyOn } from 'bun:test';
import { LiveProtection } from '../src/live-protocol';

const stamp = (revision: number, epoch = 'server', key = '["notes"]') => ({ revision, epoch, key });

describe('live delivery diagnostics', () => {
  it('explains pending holds, stale confirmations, unrelated keys, new epochs, and successful delivery without logging payloads', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    const values: unknown[] = [];
    try {
      const protection = new LiveProtection(value => values.push(value));
      protection.receive('private payload', stamp(0));
      const release = protection.protect();
      protection.receive('buffered payload', stamp(1));
      release([stamp(3), stamp(9, 'server', '["users"]')]);
      expect(values).toEqual(['private payload']);
      protection.receive('confirmed payload', stamp(3));
      protection.receive('older payload', stamp(2));
      protection.receive('new instance payload', stamp(0, 'new-instance'));
      expect(values).toEqual(['private payload', 'confirmed payload', 'new instance payload']);
      const calls = debug.mock.calls;
      expect(calls).toContainEqual(['[memoized-dom:live] snapshot-held', {
        reason: 'optimistic-pending', stamp: stamp(1), pending: 1,
      }]);
      expect(calls).toContainEqual(['[memoized-dom:live] snapshot-held', {
        reason: 'awaiting-mutation-confirmation', stamp: stamp(1), required: stamp(3),
      }]);
      expect(calls).toContainEqual(['[memoized-dom:live] confirmation-ignored', {
        reason: 'unrelated-key', queryKey: '["notes"]', mutationKey: '["users"]',
      }]);
      expect(calls.some(call => call[0] === '[memoized-dom:live] snapshot-rejected')).toBe(true);
      expect(calls.some(call => call[0] === '[memoized-dom:live] confirmation-epoch-changed')).toBe(true);
      expect(calls.at(-1)).toEqual(['[memoized-dom:live] snapshot-applied', { stamp: stamp(0, 'new-instance') }]);
      expect(JSON.stringify(calls)).not.toContain('payload');
    } finally {
      debug.mockRestore();
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    }
  });

  it('does not let a throwing diagnostic console prevent delivery or release', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const debug = spyOn(console, 'debug').mockImplementation(() => { throw new Error('Console extension failed'); });
    const values: unknown[] = [];
    try {
      const protection = new LiveProtection(value => values.push(value));
      const release = protection.protect();
      protection.receive(1, stamp(1));
      release(); release();
      expect(values).toEqual([1]);
    } finally {
      debug.mockRestore();
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    }
  });

  it.each(['production', 'test', undefined])('does not log outside development (%s)', environment => {
    const previous = process.env.NODE_ENV;
    if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
    const debug = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const protection = new LiveProtection(() => {});
      protection.receive(0, stamp(0));
      const release = protection.protect();
      protection.receive(1, stamp(1));
      release([stamp(2)]);
      protection.receive(2, stamp(2));
      expect(debug).not.toHaveBeenCalled();
    } finally {
      debug.mockRestore();
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    }
  });
});
