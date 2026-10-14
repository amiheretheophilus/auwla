import { describe, expect, it } from 'bun:test';
import { LiveProtection } from '../src/live-protocol';

const stamp = (revision: number) => ({ epoch: 'server', key: '["notes"]', revision });
describe('optimistic live delivery boundaries', () => {
  it('applies mutation cursors to parent and child sources, but not siblings', () => {
    const overview: unknown[] = [], detail: unknown[] = [], sibling: unknown[] = [];
    const parentStamp = (revision: number) => ({ ...stamp(revision), key: '["notes"]' });
    const childStamp = (revision: number) => ({ ...stamp(revision), key: '["notes","one"]' });
    const otherStamp = (revision: number) => ({ ...stamp(revision), key: '["notes","two"]' });
    const parent = new LiveProtection(value => overview.push(value));
    const child = new LiveProtection(value => detail.push(value));
    const other = new LiveProtection(value => sibling.push(value));
    parent.receive(0, parentStamp(0)); child.receive(0, childStamp(0)); other.receive(0, otherStamp(0));
    const releaseParent = parent.protect(), releaseChild = child.protect(), releaseOther = other.protect();
    parent.receive(1, parentStamp(1)); child.receive(1, childStamp(1)); other.receive(1, otherStamp(1));
    releaseParent([childStamp(3)]); releaseChild([childStamp(3)]); releaseOther([childStamp(3)]);
    expect(overview).toEqual([0]); expect(detail).toEqual([0]); expect(sibling).toEqual([0, 1]);
    parent.receive(3, parentStamp(3)); child.receive(3, childStamp(3));
    expect(overview).toEqual([0, 3]); expect(detail).toEqual([0, 3]);
    const family = child.protect();
    child.receive(4, childStamp(4));
    family([parentStamp(5)]);
    expect(detail).toEqual([0, 3]);
    child.receive(5, childStamp(5));
    expect(detail).toEqual([0, 3, 5]);
  });

  it('folds child acknowledgements received before the first overview snapshot into its newest boundary', () => {
    const values: unknown[] = [];
    const source = new LiveProtection(value => values.push(value));
    source.protect()([
      { ...stamp(2), key: '["notes","one"]' },
      { ...stamp(3), key: '["notes","two"]' },
      { ...stamp(99), key: '["users"]' },
    ]);
    source.receive(2, stamp(2));
    expect(values).toEqual([]);
    source.receive(3, stamp(3));
    expect(values).toEqual([3]);
  });

  it('does not confuse string prefixes or numeric and string identifiers', () => {
    for (const [key, unrelated] of [
      ['["notes","one"]', '["notes","one-more"]'],
      ['["notes",1]', '["notes","1"]'],
      ['["notes"]', '["notes-extra"]'],
    ]) {
      const values: unknown[] = [];
      const source = new LiveProtection(value => values.push(value));
      source.receive(0, { ...stamp(0), key: key! });
      const release = source.protect();
      source.receive(1, { ...stamp(1), key: key! });
      release([{ ...stamp(99), key: unrelated! }]);
      expect(values).toEqual([0, 1]);
    }
  });

  it('remembers mutation acknowledgements before the first browser snapshot arrives', () => {
    const values: unknown[] = [];
    const source = new LiveProtection(value => values.push(value));
    const release = source.protect();
    release([stamp(2), { ...stamp(20), key: '["unrelated"]' }]);
    source.receive(['stale'], stamp(1));
    expect(values).toEqual([]);
    source.receive(['current'], stamp(2));
    expect(values).toEqual([['current']]);
  });
  it('holds snapshots until every operation settles and rejects snapshots older than mutation acknowledgements', () => {
    const values: unknown[] = [];
    const source = new LiveProtection(value => values.push(value));
    source.receive(['A'], stamp(0));
    const first = source.protect(), second = source.protect();
    source.receive(['A', 'D'], stamp(1));
    first([stamp(2)]);
    expect(values).toEqual([['A']]);
    second([stamp(3)]);
    expect(values).toEqual([['A']]);
    source.receive(['A', 'D', 'C', 'E'], stamp(3));
    expect(values.at(-1)).toEqual(['A', 'D', 'C', 'E']);
    source.receive(['old'], stamp(2));
    expect(values).toHaveLength(2);
    second();
    expect(values).toHaveLength(2);
  });
  it('releases failed operations without inventing acknowledgements and accepts fresh server epochs', () => {
    const values: unknown[] = [];
    const source = new LiveProtection(value => values.push(value));
    source.receive(0, stamp(0));
    const release = source.protect();
    source.receive(1, stamp(1));
    release();
    expect(values).toEqual([0, 1]);
    const pending = source.protect();
    pending([stamp(10)]);
    source.receive(2, { ...stamp(0), epoch: 'new-server' });
    expect(values.at(-1)).toBe(2);
  });
});
