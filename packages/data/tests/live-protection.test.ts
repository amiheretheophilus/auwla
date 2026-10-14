import { describe, expect, it } from 'bun:test';
import { LiveProtection } from '../src/live-protocol';

const stamp = (revision: number) => ({ epoch: 'server', key: '["notes"]', revision });
describe('optimistic live delivery boundaries', () => {
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
