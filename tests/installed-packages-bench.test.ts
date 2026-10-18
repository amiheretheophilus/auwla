import { expect, it } from 'bun:test';
import { benchmarkOptions, summary, verifyCache, type CacheEntry } from '../bench/installed-packages/options';

it('validates benchmark options without silently accepting a typo', () => {
  expect(benchmarkOptions([]).samples).toBe(7);
  expect(benchmarkOptions(['--smoke']).samples).toBe(1);
  expect(benchmarkOptions(['--samples', '3']).samples).toBe(3);
  for (const value of ['', '0', '-1', '2.5', 'NaN', '52']) expect(() => benchmarkOptions(['--samples', value])).toThrow();
  expect(() => benchmarkOptions(['--typo'])).toThrow();
});
it('reports interpolated quantiles and retains original samples', () => {
  expect(summary([4, 1, 3, 2])).toEqual({ median: 2.5, p25: 1.75, p75: 3.25, samples: [4, 1, 3, 2] });
  expect(() => summary([])).toThrow(); expect(() => summary([NaN])).toThrow();
});
it('requires persistent reuse and single-package invalidation, not merely successful builds', () => {
  const entry = (key: string, name = key === 'b' ? 'throttle-debounce' : 'dset'): CacheEntry => ({ name, key, files: [{ path: 'index.js', sha256: key, bytes: 1, mtimeMs: 1 }] });
  const cold = [entry('a'), entry('b')], edited = [...cold, entry('c')];
  expect(() => verifyCache('compiled', cold, structuredClone(cold), edited)).not.toThrow();
  expect(() => verifyCache('opaque', [], [], [])).not.toThrow();
  expect(() => verifyCache('opaque', cold, cold, edited)).toThrow();
  expect(() => verifyCache('compiled', [], [], [])).toThrow();
  expect(() => verifyCache('compiled', cold, [...cold, entry('c')], edited)).toThrow();
  const rewritten = structuredClone(cold); rewritten[0]!.files[0]!.mtimeMs++;
  expect(() => verifyCache('compiled', cold, rewritten, edited)).toThrow();
  expect(() => verifyCache('compiled', cold, cold, cold)).toThrow();
  expect(() => verifyCache('compiled', cold, cold, [...cold, entry('c', 'throttle-debounce')])).toThrow();
  expect(() => verifyCache('compiled', [entry('a'), entry('b', 'dset')], cold, edited)).toThrow();
  expect(() => verifyCache('compiled', cold, cold, [entry('a'), entry('c'), entry('d')])).toThrow();
});
