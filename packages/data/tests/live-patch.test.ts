import { describe, expect, it } from 'bun:test';
import { applyLivePatch, LIVE_PATCH_MAX_DEPTH, LIVE_PATCH_MAX_OPERATIONS } from '../src/live-patch';

describe('internal live patch application', () => {
  it('reconstructs text edits exactly using UTF-16 offsets without mutating the old HTML', () => {
    const before = { html: '<p>🌍中文\ud800old</p>', inputs: [0] };
    const start = before.html.indexOf('old');
    expect(applyLivePatch(before, [
      { op: 'text', path: '/html', start, deleteCount: 3, value: '🚀new' },
      { op: 'replace', path: '/inputs/0', value: 1 },
    ])).toEqual({ html: '<p>🌍中文\ud800🚀new</p>', inputs: [1] });
    expect(before.inputs).toEqual([0]);
    expect(before.html).toEndWith('old</p>');
    expect(applyLivePatch('😀', [{ op: 'text', path: '', start: 1, deleteCount: 1, value: '\ude80' }])).toBe('🚀');
    expect(applyLivePatch(['abc'], [{ op: 'text', path: '/0', start: 3, deleteCount: 0, value: 'd' }])).toEqual(['abcd']);
  });

  it('rejects malformed text edits atomically', () => {
    const before = { html: 'abc', count: 0 };
    for (const edit of [
      { start: -1, deleteCount: 0, value: '' }, { start: 4, deleteCount: 0, value: '' },
      { start: 0, deleteCount: 4, value: '' }, { start: 0.5, deleteCount: 0, value: '' },
      { start: 0, deleteCount: -1, value: '' }, { start: 0, deleteCount: 0.5, value: '' },
      { start: 0, deleteCount: 0, value: 3 }, { start: 0, value: '' },
    ]) expect(() => applyLivePatch(before, [
      { op: 'replace', path: '/count', value: 1 }, { op: 'text', path: '/html', ...edit },
    ])).toThrow();
    expect(() => applyLivePatch(before, [{ op: 'text', path: '/count', start: 0, deleteCount: 0, value: '' }])).toThrow();
    expect(before).toEqual({ html: 'abc', count: 0 });
  });

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
