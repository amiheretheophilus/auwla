import { expect, it } from 'bun:test';
import { benchmarkOptions, summary } from '../bench/third-party-runtime/options';
import { fixture } from '../bench/third-party-runtime/fixtures';
import { compileModulesDetailed } from '@memoized-dom/compiler';

it('uses a small smoke profile and accepts reproducible explicit benchmark settings', () => {
  expect(benchmarkOptions([])).toMatchObject({ samples: 7, sizes: [1, 32, 128], operations: 100, frames: 120, warmups: 2 });
  expect(benchmarkOptions(['--smoke'])).toMatchObject({ samples: 3, sizes: [1, 8], operations: 20, frames: 20, warmups: 1 });
  expect(benchmarkOptions(['--samples', '9', '--sizes', '1,32', '--operations', '100', '--frames', '200', '--warmups', '2']))
    .toMatchObject({ samples: 9, sizes: [1, 32], operations: 100, frames: 200, warmups: 2 });
});

it.each(['local', 'shared', 'fetch'] as const)('compiles the authored %s fixture without package metadata', scenario => {
  const app = compileModulesDetailed(fixture(scenario, 2));
  expect(app.output['./App.tsx']).toContain('function App');
  expect(app.output['./Tile.tsx']).toContain('dset');
});

it.each([
  ['--samples', '0'], ['--samples', 'NaN'], ['--samples', '2.5'], ['--operations', '-1'],
  ['--frames', 'Infinity'], ['--sizes', ''], ['--sizes', '1,1'], ['--sizes', '1,'],
  ['--sizes', '0'], ['--sizes', '100000'], ['--warmups', '21'], ['--unknown'],
])('rejects invalid benchmark options %j', (...args) => {
  expect(() => benchmarkOptions(args)).toThrow();
});

it('reports actual median/IQR and raw samples without changing their order', () => {
  const samples = [9, 1, 5, 3, 7];
  expect(summary(samples)).toEqual({ medianMs: 5, p25Ms: 3, p75Ms: 7, samplesMs: [9, 1, 5, 3, 7] });
  expect(samples).toEqual([9, 1, 5, 3, 7]);
  expect(summary([2, 4]).medianMs).toBe(3);
  expect(() => summary([])).toThrow(); expect(() => summary([NaN])).toThrow();
});

it('keeps package imports ordinary in all benchmark scenarios', () => {
  for (const scenario of ['local', 'shared', 'fetch'] as const) {
    const modules = fixture(scenario, 64);
    expect(modules['./Tile.tsx']).toContain("import {dset} from 'dset'");
    expect(modules['./App.tsx']).toContain('61,62,63]');
    expect(Object.values(modules).join('')).not.toContain('notifyResolvedValueMutation');
  }
});
