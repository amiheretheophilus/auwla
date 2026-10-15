import { describe, expect, it, spyOn } from 'bun:test';
import { applyLivePatch, type LiveJsonValue } from '@memoized-dom/data/internal';
import { encodeLiveFrame, LivePatchEncoder } from '../src/live-patch';

const stamp = (revision: number) => ({ epoch: 'server', key: '["notes"]', revision });
const padding = '🪐'.repeat(300);
function decode(bytes: Uint8Array) {
  const lines = new TextDecoder().decode(bytes).split('\n');
  return { event: lines[0]!.slice(7), data: JSON.parse(lines[1]!.slice(6)) };
}

describe('automatic live GET patch encoding', () => {
  const page = (html: string, count = 0, id = 'board', key = 'contract') => ({
    $mmd: 'page', version: 1, id, html, binding: { key, inputs: [count] },
  });

  it('negotiates compact HTML edits while keeping a complete exact baseline for later mounts', () => {
    const html = (count: number) => `<section>${padding}<p>${count}</p>${padding}</section>`;
    const encoder = new LivePatchEncoder(true);
    const initial = decode(encoder.encode(page(html(0)), stamp(0)));
    expect(initial.event).toBe('value');
    let baseline = initial.data.value;
    for (let count = 1; count < 12; count++) {
      const next = page(html(count), count);
      const bytes = encoder.encode(next, stamp(count));
      const update = decode(bytes);
      expect(update.event).toBe('patch');
      expect(update.data.patch.some((op: { op: string; path: string }) => op.op === 'text' && op.path === '/html')).toBe(true);
      baseline = applyLivePatch(baseline, update.data.patch);
      expect(baseline).toEqual(next);
      expect(bytes.byteLength).toBeLessThan(400);
    }
    expect(decode(new LivePatchEncoder(true).encode(baseline, stamp(12))).data.value).toEqual(baseline);
    const legacy = new LivePatchEncoder(); legacy.encode(page(html(0)), stamp(0));
    const legacyUpdate = decode(legacy.encode(page(html(1), 1), stamp(1)));
    expect(legacyUpdate.data.patch?.some((op: { op: string }) => op.op === 'text') ?? false).toBe(false);
    expect(legacyUpdate.event === 'value' ? legacyUpdate.data.value : applyLivePatch(initial.data.value, legacyUpdate.data.patch)).toEqual(page(html(1), 1));
  });

  it('uses full HTML for other contracts, noninteractive pages and ordinary JSON', () => {
    for (const [before, after] of [
      [page(padding + 'old'), page(padding + 'new', 1, 'different')],
      [page(padding + 'old'), page(padding + 'new', 1, 'board', 'different')],
      [{ $mmd: 'page', version: 1, id: 'static', html: padding + 'old' }, { $mmd: 'page', version: 1, id: 'static', html: padding + 'new' }],
      [{ html: padding + 'old' }, { html: padding + 'new' }],
    ]) {
      const encoder = new LivePatchEncoder(true); encoder.encode(before, stamp(0));
      const update = decode(encoder.encode(after, stamp(1)));
      expect(update.event === 'value' ? update.data.value : applyLivePatch(before as LiveJsonValue, update.data.patch)).toEqual(after);
      expect(update.data.patch?.some((op: { op: string }) => op.op === 'text') ?? false).toBe(false);
    }
  });

  it('round-trips Unicode, changing branches and text edit size fallbacks', () => {
    let seed = 31;
    const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const characters = ['a', '中', '🌍', '🚀', '\ud800', '\udc00', '"', '\n', '/', '~'];
    const encoder = new LivePatchEncoder(true);
    let current = page(padding) as LiveJsonValue; encoder.encode(current, stamp(0));
    for (let revision = 1; revision <= 500; revision++) {
      const text = Array.from({ length: random() % 60 }, () => characters[random() % characters.length]).join('');
      const next = page(`<section>${padding}${revision % 2 ? `<p>${text}</p>` : `<ul><li>${text}</li></ul>`}${padding}</section>`, revision);
      const update = decode(encoder.encode(next, stamp(revision)));
      current = update.event === 'patch' ? applyLivePatch(current, update.data.patch) : update.data.value;
      expect(current).toEqual(next);
    }
    // The comparison budget still bounds long strings.
    const huge = new LivePatchEncoder(true); huge.encode(page('x'.repeat(60_000)), stamp(0));
    expect(decode(huge.encode(page('x'.repeat(60_000) + 'a'), stamp(1))).event).toBe('value');
  });

  it('serializes the payload once and never encodes the discarded full snapshot when a small patch wins', () => {
    const encoder = new LivePatchEncoder();
    const before = { rows: Array.from({ length: 5000 }, (_, id) => ({ id, text: `Note ${id}` })) };
    encoder.encode(before, stamp(0));
    const after = structuredClone(before); after.rows[2500]!.text = 'edited';
    const serialization = spyOn(JSON, 'stringify');
    const encoding = spyOn(TextEncoder.prototype, 'encode');
    let bytes: Uint8Array;
    try {
      bytes = encoder.encode(after, stamp(1));
      const serialized = serialization.mock.calls.map(call => call[0]);
      const encoded = encoding.mock.calls.map(call => call[0]);
      expect(serialized.filter(value => value === after)).toHaveLength(1);
      expect(serialized.some(value => value !== null && typeof value === 'object' &&
        Object.hasOwn(value, 'value') && Object.hasOwn(value, 'seq'))).toBe(false);
      expect(encoded).toHaveLength(1);
      expect(encoded[0]!.startsWith('event: patch\n')).toBe(true);
    } finally { serialization.mockRestore(); encoding.mockRestore(); }
    const update = decode(bytes!);
    expect(applyLivePatch(before, update.data.patch)).toEqual(after);
  });

  it('selects the strictly smaller UTF-8 frame across Unicode size boundaries and exact ties', () => {
    let unicodeWins = 0, ties = 0;
    for (const character of ['a', 'é', '中', '🪐', '\ud800', '\udc00', '"\n\\']) {
      for (let length = 0; length < 100; length++) {
        const encoder = new LivePatchEncoder();
        const before = { count: 0, padding: character.repeat(length) };
        const after = { ...before, count: 1 };
        const cursor = { epoch: 'server🪐', key: '["nœtes","中文"]', revision: 1 };
        encoder.encode(before, stamp(0));
        const snapshot = encodeLiveFrame('value', { value: after, stamp: cursor, seq: 2 });
        const patch = encodeLiveFrame('patch', { base: 1, seq: 2,
          patch: [{ op: 'replace', path: '/count', value: 1 }], stamp: cursor });
        if (patch.byteLength === snapshot.byteLength) ties++;
        if (patch.byteLength < snapshot.byteLength && new TextDecoder().decode(patch).length >=
          new TextDecoder().decode(snapshot).length) unicodeWins++;
        const actual = encoder.encode(after, cursor);
        expect(actual).toEqual(patch.byteLength < snapshot.byteLength ? patch : snapshot);
      }
    }
    expect(unicodeWins).toBeGreaterThan(0);
    expect(ties).toBeGreaterThan(0);
  });

  it('preserves one-pass JSON normalization when snapshotting getters, toJSON, and escaped values', () => {
    const encoder = new LivePatchEncoder();
    let reads = 0, conversions = 0;
    const value = {
      toJSON(key: string) {
        conversions++; expect(key).toBe('');
        return { get count() { reads++; return reads; }, padding, omitted: undefined,
          date: new Date('2026-01-01'), numbers: [NaN, Infinity, -0], text: '🪐\ud800\n"\\' };
      },
    };
    const initial = decode(encoder.encode(value, stamp(0)));
    expect(conversions).toBe(1); expect(reads).toBe(1);
    expect(initial.event).toBe('value');
    expect(initial.data.value).toEqual({ count: 1, padding, date: '2026-01-01T00:00:00.000Z',
      numbers: [null, null, 0], text: '🪐\ud800\n"\\' });
    const update = decode(encoder.encode(value, stamp(1)));
    expect(conversions).toBe(2); expect(reads).toBe(2);
    expect(update.event).toBe('patch');
    expect(applyLivePatch(initial.data.value, update.data.patch)).toEqual({ ...initial.data.value, count: 2 });
  });

  it('starts full and sends only a changed overview field when smaller', () => {
    const encoder = new LivePatchEncoder();
    const before = [{ id: 'one', notes: 0, description: padding }, { id: 'two', notes: 2, description: padding }];
    const initial = decode(encoder.encode(before, stamp(0)));
    expect(initial.event).toBe('value');
    expect(initial.data).toEqual({ value: before, stamp: stamp(0), seq: 1 });
    const after = structuredClone(before); after[0]!.notes++;
    const update = decode(encoder.encode(after, stamp(1)));
    expect(update.event).toBe('patch');
    expect(update.data).toEqual({ base: 1, seq: 2, patch: [{ op: 'replace', path: '/0/notes', value: 1 }], stamp: stamp(1) });
    expect(applyLivePatch(initial.data.value, update.data.patch)).toEqual(after);
  });

  it('retains JSON snapshots rather than aliasing mutable service results', () => {
    const encoder = new LivePatchEncoder();
    const value = { notes: [{ text: 'first' }], padding, date: new Date('2026-01-01'), omitted: undefined };
    const initial = decode(encoder.encode(value, stamp(0)));
    value.notes[0]!.text = 'changed'; value.notes.push({ text: 'added' });
    const update = decode(encoder.encode(value, stamp(1)));
    expect(update.event).toBe('patch');
    expect(initial.data.value.notes).toEqual([{ text: 'first' }]);
    expect(applyLivePatch(initial.data.value, update.data.patch)).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('patches one changed field in a thousand-row overview within the comparison budget', () => {
    const encoder = new LivePatchEncoder();
    const before = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), name: `Expedition ${id}`, notes: 0 }));
    encoder.encode(before, stamp(0));
    const after = structuredClone(before); after[888]!.notes = 1;
    const bytes = encoder.encode(after, stamp(1));
    expect(decode(bytes).data.patch).toEqual([{ op: 'replace', path: '/888/notes', value: 1 }]);
    expect(bytes.byteLength).toBeLessThan(250);
    expect(JSON.stringify(after).length).toBeGreaterThan(40_000);
  });

  it('keeps append, prepend, removal and middle edits compact for five thousand rows', () => {
    const rows = Array.from({ length: 5000 }, (_, id) => ({ id: `n${id}`, text: `field note number ${id} with some body text`, by: 'user' }));
    const added = { id: 'new', text: 'A new note', by: 'user' };
    for (const [after, expected] of [
      [[...rows, added], [{ op: 'add', path: '/5000', value: added }]],
      [[added, ...rows], [{ op: 'add', path: '/0', value: added }]],
      [rows.slice(1), [{ op: 'remove', path: '/0' }]],
      [rows.map((row, index) => index === 2500 ? { ...row, text: 'edited' } : row), [{ op: 'replace', path: '/2500/text', value: 'edited' }]],
      [[...rows.slice(0, 2500), added, ...rows.slice(2500)], [{ op: 'add', path: '/2500', value: added }]],
      [[...rows.slice(0, 2500), ...rows.slice(2501)], [{ op: 'remove', path: '/2500' }]],
    ] as const) {
      const encoder = new LivePatchEncoder(); encoder.encode(rows, stamp(0));
      const bytes = encoder.encode(after, stamp(1));
      const update = decode(bytes);
      expect(update.event).toBe('patch'); expect(update.data.patch).toEqual(expected);
      expect(bytes.byteLength).toBeLessThan(300);
      expect(applyLivePatch(rows, update.data.patch)).toEqual(after);
    }
  });

  it('preserves duplicate rows, nested arrays and observable key order when aligning array edges', () => {
    for (const [before, after] of [
      [[1, 1, 2, 2], [1, 2, 2]],
      [[1, 1, 2, 2], [1, 1, 1, 2, 2]],
      [[1, 2, 3, 4], [1, 8, 9, 10, 4]],
      [[1, 2, 3, 4], [1, 8, 4]],
      [[1, 2], []], [[], [1, 2]],
      [[{ first: 1, second: 2 }], [{ second: 2, first: 1 }]],
      [[[1, 2], [3, 4]], [[1, 2], [0, 3, 4]]],
    ] as [LiveJsonValue, LiveJsonValue][]) {
      const encoder = new LivePatchEncoder(); encoder.encode({ rows: before, padding }, stamp(0));
      const update = decode(encoder.encode({ rows: after, padding }, stamp(1)));
      const actual = update.event === 'patch' ? applyLivePatch({ rows: before, padding }, update.data.patch) : update.data.value;
      expect(JSON.stringify(actual)).toBe(JSON.stringify({ rows: after, padding }));
    }
  });

  it('sends confirmation cursors even for unchanged large values', () => {
    const encoder = new LivePatchEncoder();
    encoder.encode({ count: 1, padding }, stamp(0));
    const update = decode(encoder.encode({ count: 1, padding }, stamp(3)));
    expect(update).toEqual({ event: 'patch', data: { base: 1, seq: 2, patch: [], stamp: stamp(3) } });
  });

  it('preserves observable object key order instead of treating reordered members as unchanged', () => {
    const encoder = new LivePatchEncoder();
    const before = { row: { first: 1, second: 2 }, padding };
    encoder.encode(before, stamp(0));
    const after = { row: { second: 2, added: 3, first: 1 }, padding };
    const update = decode(encoder.encode(after, stamp(1)));
    expect(update.event).toBe('patch');
    const reconstructed = applyLivePatch(before, update.data.patch) as typeof after;
    expect(Object.keys(reconstructed.row)).toEqual(Object.keys(after.row));
    expect(reconstructed).toEqual(after);
  });

  it('falls back when a patch is larger, then patches against the new full baseline', () => {
    const encoder = new LivePatchEncoder();
    encoder.encode(0, stamp(0));
    expect(decode(encoder.encode(1, stamp(1)))).toEqual({ event: 'value', data: { value: 1, stamp: stamp(1), seq: 2 } });
    expect(decode(encoder.encode({ count: 0, padding }, stamp(2))).event).toBe('value');
    const update = decode(encoder.encode({ count: 1, padding }, stamp(3)));
    expect(update.event).toBe('patch'); expect(update.data.base).toBe(3);
  });

  it('falls back for excessive operations, work or depth instead of emitting invalid patches', () => {
    for (const [before, after] of [
      [Array.from({ length: 200 }, (_, count) => ({ count, padding })), Array.from({ length: 200 }, (_, count) => ({ count: count + 1, padding }))],
      [Array.from({ length: 50_100 }, () => 0), Array.from({ length: 50_100 }, () => 0)],
    ]) {
      const encoder = new LivePatchEncoder(); encoder.encode(before, stamp(0));
      expect(decode(encoder.encode(after, stamp(1))).event).toBe('value');
    }
    const nested = (leaf: number) => {
      let value: LiveJsonValue = { padding, leaf };
      for (let index = 0; index < 65; index++) value = { nested: value };
      return value;
    };
    const encoder = new LivePatchEncoder(); encoder.encode(nested(0), stamp(0));
    expect(decode(encoder.encode(nested(1), stamp(1))).event).toBe('value');
  });

  it('round-trips insertions, deletions, reorderings, escaped keys and changing JSON shapes', () => {
    let seed = 19;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const encoder = new LivePatchEncoder();
    let current: LiveJsonValue = { rows: [], padding };
    decode(encoder.encode(current, stamp(0)));
    for (let revision = 1; revision <= 200; revision++) {
      const rows = Array.from({ length: random() % 12 }, () => ({ id: random() % 8, 'a/b~': random() % 20 }));
      const next: LiveJsonValue = revision % 7 === 0 ? [padding, ...rows] : { rows, padding, ...(revision % 3 ? { extra: null } : {}) };
      const update = decode(encoder.encode(next, stamp(revision)));
      current = update.event === 'patch' ? applyLivePatch(current, update.data.patch) : update.data.value;
      expect(current).toEqual(next);
    }
  });

  it('rejects non-serializable values rather than corrupting the baseline', () => {
    const encoder = new LivePatchEncoder();
    encoder.encode({ padding, count: 0 }, stamp(0));
    expect(() => encoder.encode(undefined, stamp(1))).toThrow('JSON serializable');
    expect(() => encoder.encode(1n, stamp(1))).toThrow();
    expect(decode(encoder.encode({ padding, count: 1 }, stamp(2))).data.base).toBe(1);
  });
});
