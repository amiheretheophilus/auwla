import { describe, expect, it } from 'bun:test';
import { applyLivePatch, LIVE_PATCH_MAX_DEPTH, LIVE_PATCH_MAX_OPERATIONS } from '../src/live-patch';

describe('internal live patch application', () => {
  it('copies changed paths without mutating the baseline', () => {
    const before = { rows: [{ count: 0 }], unchanged: { value: true } };
    const after = applyLivePatch(before, [{ op: 'replace', path: '/rows/0/count', value: 1 }]);
    expect(after).toEqual({ rows: [{ count: 1 }], unchanged: { value: true } });
    expect(before.rows[0]!.count).toBe(0);
    expect((after as typeof before).unchanged).toBe(before.unchanged);
  });

  it('supports array insertion, append, removal, replacement and root replacement', () => {
    expect(applyLivePatch(['A', 'C'], [
      { op: 'add', path: '/1', value: 'B' },
      { op: 'add', path: '/-', value: 'D' },
      { op: 'remove', path: '/0' },
      { op: 'replace', path: '/1', value: 'changed' },
    ])).toEqual(['B', 'changed', 'D']);
    expect(applyLivePatch({ before: true }, [{ op: 'replace', path: '', value: null }])).toBeNull();
  });

  it('handles escaped and empty keys without traversing prototypes or invoking prototype setters', () => {
    const before = JSON.parse('{"__proto__":{"safe":0},"constructor":1,"a/b":{"~":2},"":3}');
    const after = applyLivePatch(before, [
      { op: 'replace', path: '/__proto__/safe', value: 1 },
      { op: 'replace', path: '/constructor', value: 2 },
      { op: 'replace', path: '/a~1b/~0', value: 3 },
      { op: 'remove', path: '/' },
    ]);
    expect(JSON.stringify(after)).toBe('{"__proto__":{"safe":1},"constructor":2,"a/b":{"~":3}}');
    expect(Object.getPrototypeOf(after)).toBe(Object.prototype);
    expect(Object.hasOwn({}, 'safe')).toBe(false);
    expect(() => applyLivePatch({}, [{ op: 'add', path: '/__proto__/polluted', value: true }])).toThrow('Missing live patch property');
  });

  it('does not partially mutate the baseline when a later operation fails', () => {
    const before = { count: 0 };
    expect(() => applyLivePatch(before, [
      { op: 'replace', path: '/count', value: 1 },
      { op: 'remove', path: '/missing' },
    ])).toThrow();
    expect(before).toEqual({ count: 0 });
  });

  it('rejects invalid paths, operations, missing parents and out-of-range array indices', () => {
    for (const patch of [
      null, {}, [{ op: 'move', path: '/0' }], [{ op: 'replace', path: '/0' }],
      [{ op: 'replace', path: '0', value: 1 }], [{ op: 'replace', path: '/~2', value: 1 }],
      [{ op: 'replace', path: '/01', value: 1 }], [{ op: 'replace', path: '/-1', value: 1 }],
      [{ op: 'replace', path: '/1', value: 1 }], [{ op: 'remove', path: '' }],
      [{ op: 'add', path: '/2', value: 1 }], [{ op: 'replace', path: '/0/x', value: 1 }],
    ]) expect(() => applyLivePatch([0], patch)).toThrow();
  });

  it('bounds operation count and path depth', () => {
    expect(() => applyLivePatch(0, Array.from({ length: LIVE_PATCH_MAX_OPERATIONS + 1 }, () =>
      ({ op: 'replace', path: '', value: 1 })))).toThrow();
    expect(() => applyLivePatch({}, [{ op: 'add', path: '/x'.repeat(LIVE_PATCH_MAX_DEPTH + 1), value: 1 }])).toThrow('too deep');
    expect(applyLivePatch([1], [])).toEqual([1]);
  });
});
