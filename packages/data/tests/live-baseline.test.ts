import { describe, expect, it } from 'bun:test';
import { LiveBaseline, liveSequence } from '../src/live-baseline';
import { LivePatchBaselineError, StreamProtocolError } from '../src/stream-frames';

describe('one live read baseline, shared by the direct and the shared stream', () => {
  it('replaces with full values and moves on with patches in sequence', () => {
    const baseline = new LiveBaseline();
    expect(baseline.replace({ count: 1, tags: ['a'] }, 1)).toBe(false);
    baseline.patch(1, 2, [{ op: 'replace', path: '/count', value: 2 }]);
    expect(baseline.sequence).toBe(2);
    expect(baseline.current()).toEqual({ count: 2, tags: ['a'] });
    // A full value right after the last one shows the reader caught up.
    expect(baseline.replace({ count: 3, tags: [] }, 3)).toBe(true);
    expect(baseline.replace({ count: 9, tags: [] }, 9)).toBe(false);
  });

  it('delivers copies, so a reader changing its value leaves the baseline alone', () => {
    const baseline = new LiveBaseline();
    baseline.replace({ rows: [1] }, 1);
    const delivered = baseline.current() as { rows: number[] };
    delivered.rows.push(2);
    baseline.patch(1, 2, [{ op: 'replace', path: '/rows/0', value: 5 }]);
    expect(baseline.current()).toEqual({ rows: [5] });
  });

  it('refuses a patch made against another baseline, and malformed sequences or operations', () => {
    const baseline = new LiveBaseline();
    expect(() => baseline.patch(1, 2, [])).toThrow(LivePatchBaselineError);
    baseline.replace({ count: 1 }, 4);
    expect(() => baseline.patch(3, 4, [])).toThrow(LivePatchBaselineError);
    expect(() => baseline.patch(4, 6, [])).toThrow(StreamProtocolError);
    expect(() => baseline.patch(4, 5, 'not operations')).toThrow('Invalid live patch operations');
    expect(baseline.sequence).toBe(4);
    baseline.reset();
    expect(baseline.sequence).toBeUndefined();
    expect(() => baseline.patch(4, 5, [])).toThrow(LivePatchBaselineError);
    for (const wrong of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => liveSequence(wrong)).toThrow('Invalid live patch sequence');
    }
  });
});
