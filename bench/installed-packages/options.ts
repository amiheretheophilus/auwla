import { parseArgs } from 'node:util';

export function benchmarkOptions(args: string[]) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    smoke: { type: 'boolean' }, samples: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' },
  } });
  const samples = values.samples === undefined ? (values.smoke ? 1 : 7) : Number(values.samples);
  if (!Number.isInteger(samples) || samples < 1 || samples > 51) throw new Error('samples must be an integer in 1..51');
  return { samples, smoke: values.smoke ?? false, output: values.output, help: values.help ?? false };
}

export function summary(values: number[]) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid samples');
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => {
    const position = (sorted.length - 1) * fraction, low = Math.floor(position), weight = position - low;
    return sorted[low]! * (1 - weight) + sorted[Math.ceil(position)]! * weight;
  };
  return { median: percentile(0.5), p25: percentile(0.25), p75: percentile(0.75), samples: values };
}

export type CacheEntry = { name: string; key: string; files: { path: string; sha256: string; bytes: number; mtimeMs: number }[] };
export function verifyCache(mode: 'opaque' | 'compiled', cold: CacheEntry[], warm: CacheEntry[], edited: CacheEntry[]) {
  if (mode === 'opaque') {
    if (cold.length || warm.length || edited.length) throw new Error('Opaque build unexpectedly compiled a package');
    return;
  }
  if (cold.length !== 2 || cold.filter(entry => entry.name === 'dset').length !== 1 || cold.filter(entry => entry.name === 'throttle-debounce').length !== 1) {
    throw new Error('Expected exactly one cache entry each for dset and throttle-debounce');
  }
  if (JSON.stringify(cold) !== JSON.stringify(warm)) throw new Error('Warm build rewrote or replaced the persistent package cache');
  if (edited.length !== cold.length + 1) throw new Error('Source edit did not create exactly one new package cache entry');
  const added = edited.filter(entry => !cold.some(previous => previous.key === entry.key));
  if (added.length !== 1 || added[0]!.name !== 'dset') throw new Error('Source edit invalidated the wrong package');
  for (const entry of cold) {
    if (JSON.stringify(entry) !== JSON.stringify(edited.find(candidate => candidate.key === entry.key))) {
      throw new Error('Source edit unexpectedly changed an existing immutable cache entry');
    }
  }
}
